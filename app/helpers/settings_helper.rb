#-- copyright
# OpenProject is an open source project management software.
# Copyright (C) 2012-2022 the OpenProject GmbH
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License version 3.
#
# OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
# Copyright (C) 2006-2013 Jean-Philippe Lang
# Copyright (C) 2010-2013 the ChiliProject Team
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
#
# See COPYRIGHT and LICENSE files for more details.
#++

require 'securerandom'

module SettingsHelper
  extend self
  include OpenProject::FormTagHelper

  def system_settings_tabs
    [
      {
        name: 'general',
        controller: '/admin/settings/general_settings',
        label: :label_general
      },
      {
        name: 'display',
        controller: '/admin/settings/display_settings',
        label: :label_display
      },
      {
        name: 'projects',
        controller: '/admin/settings/projects_settings',
        label: :label_project_plural
      },
      {
        name: 'attachments',
        controller: '/admin/settings/attachments_settings',
        label: :'attributes.attachments'
      },
      {
        name: 'api',
        controller: '/admin/settings/api_settings',
        label: :label_api_access_key_type
      },
      {
        name: 'repositories',
        controller:'/admin/settings/repositories_settings',
        label: :label_repository_plural
      }
    ]
  end

  def setting_select(setting, choices, options = {})
    if blank_text = options.delete(:blank)
      choices = [[blank_text.is_a?(Symbol) ? I18n.t(blank_text) : blank_text, '']] + choices
    end

    setting_label(setting, options) +
      wrap_field_outer(options) do
        styled_select_tag("settings[#{setting}]",
                          options_for_select(choices, Setting.send(setting).to_s), options)
      end
  end

  def setting_multiselect(setting, choices, options = {})
    setting_label(setting, options) +
      content_tag(:span, class: 'form--field-container -vertical') do
        hidden_field_tag("settings[#{setting}][]", '') +
          choices.map do |choice|
            text, value, choice_options = (choice.is_a?(Array) ? choice : [choice, choice])
            choice_options = (choice_options || {}).merge(options.except(:id))
            choice_options[:id] = "#{setting}_#{value}"

            content_tag(:label, class: 'form--label-with-check-box') do
              styled_check_box_tag("settings[#{setting}][]", value,
                                   Setting.send(setting).include?(value), choice_options) + text.to_s

            end
          end.join.html_safe
      end
  end

  def settings_matrix(settings, choices, options = {})
    content_tag(:table, class: 'form--matrix') do
      content_tag(:thead, build_settings_matrix_head(settings, options)) +
        content_tag(:tbody, build_settings_matrix_body(settings, choices))
    end
  end

  def setting_text_field(setting, options = {})
    setting_field_wrapper(setting, options) do
      styled_text_field_tag("settings[#{setting}]", Setting.send(setting), options)
    end
  end

  def setting_number_field(setting, options = {})
    setting_field_wrapper(setting, options) do
      styled_number_field_tag("settings[#{setting}]", Setting.send(setting), options)
    end
  end

  def setting_time_field(setting, options = {})
    setting_field_wrapper(setting, options) do
      styled_time_field_tag("settings[#{setting}]", Setting.send(setting), options)
    end
  end

  def setting_field_wrapper(setting, options)
    unit = options.delete(:unit)
    unit_html = ''

    if unit
      unit_id = SecureRandom.uuid
      options[:'aria-describedby'] = unit_id
      unit_html = content_tag(:span,
                              unit,
                              class: 'form--field-affix',
                              'aria-hidden': true,
                              id: unit_id)
    end

    setting_label(setting, options) +
      wrap_field_outer(options) do
        yield + unit_html
      end
  end

  def setting_text_area(setting, options = {})
    setting_label(setting, options) +
      wrap_field_outer(options) do
        value = Setting.send(setting)

        if value.is_a?(Array)
          value = value.join("\n")
        end

        styled_text_area_tag("settings[#{setting}]", value, options)
      end
  end

  def setting_check_box(setting, options = {})
    setting_label(setting, options) +
      wrap_field_outer(options) do
        tag(:input, type: 'hidden', name: "settings[#{setting}]", value: 0, id: "settings_#{setting}_hidden") +
          styled_check_box_tag("settings[#{setting}]", 1, Setting.send("#{setting}?"), options)
      end
  end

  def setting_password(setting, options = {})
    setting_label(setting, options) +
      wrap_field_outer(options) do
        styled_password_field_tag("settings[#{setting}]", Setting.send(setting), options)
      end
  end

  def setting_label(setting, options = {})
    label = options[:label]
    return ''.html_safe if label == false

    styled_label_tag(
      "settings_#{setting}", I18n.t(label || "setting_#{setting}"),
      options.slice(:title)
    )
  end

  def setting_block(setting, options = {}, &block)
    setting_label(setting, options) + wrap_field_outer(options, &block)
  end

  private

  def wrap_field_outer(options, &block)
    if options[:label] != false
      content_tag(:span, class: 'form--field-container', &block)
    else
      block.call
    end
  end

  def build_settings_matrix_head(settings, options = {})
    content_tag(:tr, class: 'form--matrix-header-row') do
      content_tag(:th, I18n.t(options[:label_choices] || :label_choices),
                  class: 'form--matrix-header-cell') +
        settings.map do |setting|
          content_tag(:th, class: 'form--matrix-header-cell') do
            hidden_field_tag("settings[#{setting}][]", '') +
              I18n.t("setting_#{setting}")
          end
        end.join.html_safe
    end
  end

  def build_settings_matrix_body(settings, choices)
    choices.map do |choice|
      value = choice[:value]
      caption = choice[:caption] || value.to_s
      exceptions = Array(choice[:except]).compact
      content_tag(:tr, class: 'form--matrix-row') do
        content_tag(:td, caption, class: 'form--matrix-cell') +
          settings.map do |setting|
            content_tag(:td, class: 'form--matrix-checkbox-cell') do
              unless exceptions.include?(setting)
                styled_check_box_tag("settings[#{setting}][]", value,
                                     Setting.send(setting).include?(value),
                                     id: "#{setting}_#{value}")
              end
            end
          end.join.html_safe
      end
    end.join.html_safe
  end
end
