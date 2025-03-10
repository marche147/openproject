// -- copyright
// OpenProject is an open source project management software.
// Copyright (C) 2012-2022 the OpenProject GmbH
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See COPYRIGHT and LICENSE files for more details.
//++

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Injector,
  Input,
  OnInit,
} from '@angular/core';
import { I18nService } from 'core-app/core/i18n/i18n.service';
import { PathHelperService } from 'core-app/core/path-helper/path-helper.service';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { WorkPackageResource } from 'core-app/features/hal/resources/work-package-resource';
import { HalResourceEditingService } from 'core-app/shared/components/fields/edit/services/hal-resource-editing.service';
import { DisplayFieldService } from 'core-app/shared/components/fields/display/display-field.service';
import { DisplayField } from 'core-app/shared/components/fields/display/display-field.module';
import { QueryResource } from 'core-app/features/hal/resources/query-resource';
import { HookService } from 'core-app/features/plugins/hook-service';
import { WorkPackageChangeset } from 'core-app/features/work-packages/components/wp-edit/work-package-changeset';
import { Subject } from 'rxjs';
import { randomString } from 'core-app/shared/helpers/random-string';
import { BrowserDetector } from 'core-app/core/browser/browser-detector.service';
import { HalResourceService } from 'core-app/features/hal/services/hal-resource.service';
import idFromLink from 'core-app/features/hal/helpers/id-from-link';
import isNewResource from 'core-app/features/hal/helpers/is-new-resource';
import { UntilDestroyedMixin } from 'core-app/shared/helpers/angular/until-destroyed.mixin';
import { CurrentProjectService } from 'core-app/core/current-project/current-project.service';
import { States } from 'core-app/core/states/states.service';
import { SchemaCacheService } from 'core-app/core/schemas/schema-cache.service';
import { debugLog } from 'core-app/shared/helpers/debug_output';
import { OpInviteUserModalService } from 'core-app/features/invite-user-modal/invite-user-modal.service';
import { OpTaskTemplateService } from 'core-app/features/invite-user-modal/task-template.service';

export interface FieldDescriptor {
  name:string;
  label:string;
  field?:DisplayField;
  fields?:DisplayField[];
  spanAll:boolean;
  multiple:boolean;
}

export interface GroupDescriptor {
  name:string;
  id:string;
  members:FieldDescriptor[];
  query?:QueryResource;
  relationType?:string;
  isolated:boolean;
  type:string;
}

export interface ResourceContextChange {
  isNew:boolean;
  schema:string|null;
  project:string|null;
}

export const overflowingContainerAttribute = 'overflowingIdentifier';

@Component({
  templateUrl: './wp-single-view.html',
  selector: 'wp-single-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkPackageSingleViewComponent extends UntilDestroyedMixin implements OnInit {
  @Input() public workPackage:WorkPackageResource;

  /** Should we show the project field */
  @Input() public showProject = false;

  // Grouped fields returned from API
  public groupedFields:GroupDescriptor[] = [];

  public category:FieldDescriptor;

  // State updated when structural changes to the single view may occur.
  // (e.g., when changing the type or project context).
  public resourceContextChange = new Subject<ResourceContextChange>();

  // Project context as an indicator
  // when editing the work package in a different project
  public projectContext:{
    matches:boolean,
    href:string|null,
    field?:FieldDescriptor[]
  };

  public text = {
    attachments: {
      label: this.I18n.t('js.label_attachments'),
    },
    project: {
      required: this.I18n.t('js.project.required_outside_context'),
      context: this.I18n.t('js.project.context'),
      switchTo: this.I18n.t('js.project.click_to_switch_context'),
    },

    fields: {
      description: this.I18n.t('js.work_packages.properties.description'),
    },
    infoRow: {
      createdBy: this.I18n.t('js.label_created_by'),
      lastUpdatedOn: this.I18n.t('js.label_last_updated_on'),
    },
  };

  public isNewResource:boolean;

  protected firstTimeFocused = false;

  $element:JQuery;

  constructor(readonly I18n:I18nService,
    protected currentProject:CurrentProjectService,
    protected PathHelper:PathHelperService,
    protected states:States,
    protected halEditing:HalResourceEditingService,
    protected halResourceService:HalResourceService,
    protected displayFieldService:DisplayFieldService,
    protected schemaCache:SchemaCacheService,
    protected hook:HookService,
    protected injector:Injector,
    protected cdRef:ChangeDetectorRef,
    readonly elementRef:ElementRef,
    readonly browserDetector:BrowserDetector) {
    super();
  }

  public ngOnInit() {
    this.$element = jQuery(this.elementRef.nativeElement as HTMLElement);

    this.isNewResource = isNewResource(this.workPackage);

    //console.log(this.isNewResource);
    console.log(this.workPackage);
    const change = this.halEditing.changeFor<WorkPackageResource, WorkPackageChangeset>(this.workPackage);
    this.resourceContextChange.next(this.contextFrom(change.projectedResource));
    this.refresh(change);

    // Whenever the resource context changes in any way,
    // update the visible fields.
    this.resourceContextChange
      .pipe(
        this.untilDestroyed(),
        distinctUntilChanged<ResourceContextChange>((a, b) => _.isEqual(a, b)),
        map(() => this.halEditing.changeFor(this.workPackage)),
      )
      .subscribe((changeset:WorkPackageChangeset) => this.refresh(changeset));

    // Update the resource context on every update to the temporary resource.
    // This allows detecting a changed type value in a new work package.
    this.halEditing
      .temporaryEditResource(this.workPackage)
      .values$()
      .pipe(
        this.untilDestroyed(),
      )
      .subscribe((resource) => {
        this.resourceContextChange.next(this.contextFrom(resource));
      });
  }

  private refresh(change:WorkPackageChangeset) {
    // Prepare the fields that are required always
    const isNew = isNewResource(this.workPackage);
    const resource = change.projectedResource;

    if (!resource.project) {
      this.projectContext = { matches: false, href: null };
    } else {
      this.projectContext = {
        href: this.PathHelper.projectWorkPackagePath(idFromLink(resource.project.href), this.workPackage.id!),
        matches: resource.project.href === this.currentProject.apiv3Path,
      };
    }

    if (isNew && !this.currentProject.inProjectContext) {
      this.projectContext.field = this.getFields(change, ['project']);
    }

    const attributeGroups = this.schema(resource)._attributeGroups;
    console.log(resource);
    console.log(this.schema(resource));
    console.log(attributeGroups);
    this.groupedFields = this.rebuildGroupedFields(change, attributeGroups);
    console.log(this.groupedFields);

    this.cdRef.detectChanges();
  }

  /**
   * Returns whether a group should be hidden due to being empty
   * (e.g., consists only of CFs and none of them are active in this project.
   */
  public shouldHideGroup(group:GroupDescriptor):boolean {
    // Hide if the group is empty
    const isEmpty = group.members.length === 0;

    // Is a query in a new screen
    const queryInNew = isNewResource(this.workPackage) && !!group.query;

    const isDetails = group.name === "Details";
    const isEstimateTime = group.name === "Estimates and time";

    return isEmpty || queryInNew || isDetails || isEstimateTime;
  }

  /**
   * angular 2 doesn't support track by property any more but requires a custom function
   * https://github.com/angular/angular/issues/12969
   * @param _index
   * @param elem
   */
  public trackByName(_index:number, elem:{ name:string }):string {
    return elem.name;
  }

  /**
   * Allow other modules to register groups to insert into the single view
   */
  public prependedAttributeGroupComponents() {
    return this.hook.call('prependedAttributeGroups', this.workPackage);
  }

  public attributeGroupComponent(group:GroupDescriptor) {
    // we take the last registered group component which means that
    // plugins will have their say if they register for it.
    //console.log(group);
    console.log(this.hook.call('attributeGroupComponent', group, this.workPackage).pop());
    return this.hook.call('attributeGroupComponent', group, this.workPackage).pop() || null;
  }

  public attachmentListComponent() {
    // we take the last registered group component which means that
    // plugins will have their say if they register for it.
    return this.hook.call('workPackageAttachmentListComponent', this.workPackage).pop() || null;
  }

  public attachmentUploadComponent() {
    // we take the last registered group component which means that
    // plugins will have their say if they register for it.
    return this.hook.call('workPackageAttachmentUploadComponent', this.workPackage).pop() || null;
  }

  /*
   * Returns the work package label
   */
  public get idLabel():string {
    return `#${this.workPackage.id || ''}`;
  }

  public get projectContextText():string {
    const id = idFromLink(this.workPackage.project.href);
    const projectPath = this.PathHelper.projectPath(id);
    const project = `<a href="${projectPath}">${this.workPackage.project.name}<a>`;
    return this.I18n.t('js.project.work_package_belongs_to', { projectname: project });
  }

  showTwoColumnLayout():boolean {
    return this.$element[0].getBoundingClientRect().width > 750;
  }

  private rebuildGroupedFields(change:WorkPackageChangeset, attributeGroups:any) {
    if (!attributeGroups) {
      return [];
    }
    return attributeGroups.map((group:any) => {
      const groupId = this.getAttributesGroupId(group);

      if (group._type === 'WorkPackageFormAttributeGroup') {
        return {
          name: group.name,
          id: groupId || randomString(16),
          members: this.getFields(change, group.attributes),
          type: group._type,
          isolated: false,
        };
      }
      return {
        name: group.name,
        id: groupId || randomString(16),
        query: this.halResourceService.createHalResourceOfClass(QueryResource, group._embedded.query),
        relationType: group.relationType,
        members: [group._embedded.query],
        type: group._type,
        isolated: true,
      };
    });
  }

  /**
   * Maps the grouped fields into their display fields.
   * May return multiple fields (for the date virtual field).
   */
  private getFields(change:WorkPackageChangeset, fieldNames:string[]):FieldDescriptor[] {
    const descriptors:FieldDescriptor[] = [];

    fieldNames.forEach((fieldName:string) => {
      if (fieldName === 'date') {
        descriptors.push(this.getDateField(change));
        return;
      }

      if (!change.schema.ofProperty(fieldName)) {
        debugLog('Unknown field for current schema', fieldName);
        return;
      }

      const field:DisplayField = this.displayField(change, fieldName);
      descriptors.push({
        name: fieldName,
        label: field.label,
        multiple: false,
        spanAll: field.isFormattable,
        field,
      });
    });

    return descriptors;
  }

  /**
   * We need to discern between milestones, which have a single
   * 'date' field vs. all other types which should display a
   * combined 'start' and 'due' date field.
   */
  private getDateField(change:WorkPackageChangeset):FieldDescriptor {
    const object:FieldDescriptor = {
      name: '',
      label: this.I18n.t('js.work_packages.properties.date'),
      spanAll: false,
      multiple: false,
    };

    if (change.schema.ofProperty('date')) {
      object.field = this.displayField(change, 'date');
      object.name = 'date';
    } else {
      object.field = this.displayField(change, 'combinedDate');
      object.name = 'combinedDate';
    }

    return object;
  }

  /**
   * Get the current resource context change from the WP resource.
   * Used to identify changes in the schema or project that may result in visual changes
   * to the single view.
   *
   * @param {WorkPackage} workPackage
   * @returns {ResourceContextChange}
   */
  private contextFrom(workPackage:WorkPackageResource):ResourceContextChange {
    const schema = this.schema(workPackage);

    let schemaHref:string|null = null;
    const projectHref:string|null = workPackage.project && workPackage.project.href;

    if (schema.baseSchema) {
      schemaHref = schema.baseSchema.href;
    } else {
      schemaHref = schema.href;
    }

    return {
      isNew: workPackage.isNew,
      schema: schemaHref,
      project: projectHref,
    };
  }

  private displayField(change:WorkPackageChangeset, name:string):DisplayField {
    //console.log(name);
    //console.log(change.projectedResource);
    //console.log(change.schema.ofProperty(name));
    return this.displayFieldService.getField(
      change.projectedResource,
      name,
      change.schema.ofProperty(name),
      { container: 'single-view', injector: this.injector, options: {} },
    );
  }

  private getAttributesGroupId(group:any):string {
    const overflowingIdentifier = this.$element
      .find(`[data-group-name=\'${group.name}\']`)
      .data(overflowingContainerAttribute);

    if (overflowingIdentifier) {
      return overflowingIdentifier.replace('.__overflowing_', '');
    }
    return '';
  }

  private schema(resource:WorkPackageResource) {
    if (this.halEditing.typedState(resource).hasValue()) {
      return this.halEditing.typedState(this.workPackage).value!.schema;
    }
    return this.schemaCache.of(resource);
  }
}
