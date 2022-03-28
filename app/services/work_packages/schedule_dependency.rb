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

class WorkPackages::ScheduleDependency
  def initialize(work_packages)
    self.work_packages = Array(work_packages)
    self.dependencies = {}
    self.known_work_packages = self.work_packages

    build_dependencies
  end

  def each
    each_while_unhandled do |unhandled_by_id, scheduled, dependency|
      next unless unhandled_by_id[scheduled.id]
      next unless dependency.met?(unhandled_by_id.keys)

      yield scheduled, dependency

      unhandled_by_id.except!(scheduled.id)
    end
  end

  attr_accessor :work_packages,
                :dependencies,
                :known_work_packages,
                :known_work_packages_by_id,
                :known_work_packages_by_parent_id

  def scheduled_work_packages_by_id
    @scheduled_work_packages_by_id ||= (work_packages + dependencies.keys).group_by(&:id).transform_values(&:first)
  end

  private

  def build_dependencies
    following = load_following

    # Those variables are pure optimizations.
    # We want to reuse the already loaded work packages as much as possible
    # and we want to have them readily available as hashes.
    self.known_work_packages += following
    known_work_packages.uniq!
    self.known_work_packages_by_id = known_work_packages.group_by(&:id).transform_values(&:first)
    self.known_work_packages_by_parent_id = fetch_descendants.group_by(&:parent_id)

    add_dependencies(following)
  end

  def load_following
    WorkPackage
      .for_scheduling(work_packages)
      .includes(follows_relations: :to)
  end

  def add_dependencies(dependent_work_packages)
    added = dependent_work_packages.inject({}) do |new_dependencies, dependent_work_package|
      dependency = Dependency.new dependent_work_package, self

      new_dependencies[dependent_work_package] = dependency

      new_dependencies
    end

    moved = find_moved(added)

    moved.except(*dependencies.keys)

    dependencies.merge!(moved)
  end

  def find_moved(candidates)
    candidates.select do |following, dependency|
      dependency.ancestors.any? { |ancestor| included_in_follows?(ancestor, candidates) } ||
        dependency.descendants.any? { |descendant| included_in_follows?(descendant, candidates) } ||
        dependency.descendants.any? { |descendant| work_packages.include?(descendant) } ||
        included_in_follows?(following, candidates)
    end
  end

  def included_in_follows?(wp, candidates)
    tos = wp.follows_relations.map(&:to)

    dependencies.slice(*tos).any? ||
      candidates.slice(*tos).any? ||
      (tos & work_packages).any?
  end

  def each_while_unhandled
    unhandled_by_id = dependencies.keys.group_by(&:id).transform_values(&:last)

    while unhandled_by_id.any?
      unhandled_by_id_count_before = unhandled_by_id_count_after = unhandled_by_id.count
      dependencies.each do |scheduled, dependency|
        yield unhandled_by_id, scheduled, dependency

        unhandled_by_id_count_after = unhandled_by_id.count
      end

      raise "Circular dependency" unless unhandled_by_id_count_after < unhandled_by_id_count_before
    end
  end

  # Use a mixture of work packages that are already loaded to be scheduled themselves but also load
  # all the rest of the descendants. There are two cases in which descendants are not loaded for scheduling:
  # * manual scheduling: A descendant is either scheduled manually itself or all of its descendants are scheduled manually.
  # * sibling: the descendant is not below a work package to be scheduled (e.g. one following another) but below an ancestor of
  #            a schedule work package.
  def fetch_descendants
    descendants = known_work_packages_by_id.values

    descendants + WorkPackage
                    .with_ancestor(descendants)
                    .where.not(id: known_work_packages_by_id.keys)
  end

  class Dependency
    def initialize(work_package, schedule_dependency)
      self.schedule_dependency = schedule_dependency
      self.work_package = work_package
    end

    def ancestors
      @ancestors ||= ancestors_from_preloaded(work_package)
    end

    def descendants
      @descendants ||= descendants_from_preloaded(work_package)
    end

    def descendants_ids
      @descendants_ids ||= descendants.map(&:id)
    end

    def follows_moved
      tree = ancestors + descendants

      @follows_moved ||= moved_predecessors_from_preloaded(work_package, tree)
    end

    def follows_unmoved
      tree = ancestors + descendants

      @follows_unmoved ||= unmoved_predecessors_from_preloaded(work_package, tree)
    end

    def follows_moved_to_ids
      @follows_moved_to_ids ||= follows_moved.map(&:to).map(&:id)
    end

    attr_accessor :work_package,
                  :schedule_dependency

    def met?(unhandled_ids)
      (descendants_ids & unhandled_ids).empty? &&
        (follows_moved_to_ids & unhandled_ids).empty?
    end

    def max_date_of_followed
      (follows_moved + follows_unmoved)
        .map(&:successor_soonest_start)
        .compact
        .max
    end

    def start_date
      descendants_dates.min
    end

    def due_date
      descendants_dates.max
    end

    private

    def descendants_dates
      (descendants.map(&:due_date) + descendants.map(&:start_date)).compact
    end

    def ancestors_from_preloaded(work_package)
      if work_package.parent_id
        parent = known_work_packages_by_id[work_package.parent_id]

        if parent
          [parent] + ancestors_from_preloaded(parent)
        end
      end || []
    end

    def descendants_from_preloaded(work_package)
      children = known_work_packages_by_parent_id[work_package.id] || []

      children + children.map { |child| descendants_from_preloaded(child) }.flatten
    end

    delegate :known_work_packages,
             :known_work_packages_by_id,
             :known_work_packages_by_parent_id,
             :scheduled_work_packages_by_id, to: :schedule_dependency

    def scheduled_work_packages
      schedule_dependency.work_packages + schedule_dependency.dependencies.keys
    end

    def moved_predecessors_from_preloaded(work_package, tree)
      ([work_package] + tree)
        .map(&:follows_relations)
        .flatten
        .map do |relation|
          scheduled = scheduled_work_packages_by_id[relation.to_id]

          if scheduled
            relation.to = scheduled
            relation
          end
        end
        .compact
    end

    def unmoved_predecessors_from_preloaded(work_package, tree)
      ([work_package] + tree)
        .map(&:follows_relations)
        .flatten
        .reject do |relation|
          scheduled_work_packages_by_id[relation.to_id].present?
        end
    end
  end
end
