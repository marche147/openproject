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

import { Injectable, EventEmitter } from '@angular/core';
import { HalResource } from 'core-app/features/hal/resources/hal-resource';
import { CurrentProjectService } from 'core-app/core/current-project/current-project.service';
import { OpModalService } from 'core-app/shared/components/modal/modal.service';
import { TaskTemplateComponent } from './task-template.component';

/**
 * This service triggers user-invite modals to clicks on elements
 * with the attribute [invite-user-modal-augment] set.
 */
@Injectable()
export class OpTaskTemplateService {
  public close = new EventEmitter<HalResource|HalResource[]>();

  constructor(
    protected opModalService:OpModalService,
    protected currentProjectService:CurrentProjectService,
  ) {
  }

  public open(categoryId: HalResource) {
    const modal = this.opModalService.show(
      TaskTemplateComponent,
      'global',
      { categoryId },
    );

    modal
      .closingEvent
      .subscribe((component:TaskTemplateComponent) => {
        this.close.emit(component.data);
      });
  }
}
