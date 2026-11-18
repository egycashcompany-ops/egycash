// One department's chart (P-ORG-3 §2.1, §2.2): the department, its sections side by side, each
// section's jobs under it, and the jobs placed directly under the department in a dashed first
// column. From `sm` up it is drawn as a top-down tree whose connectors are logical borders, so they
// mirror in RTL by themselves; below `sm` the same content is an indented tree.
//
// Edit mode follows the organize board (`OrganizeApplicationsPage`): every gesture is one write, and
// dragging is never the only way — each job row also has «نقل إلى» and «إزالة من هنا», and ↑ / ↓ for
// its place in the column.
//
// TWO DRAGS, ONE GRIP. «لما باجي أشد حاجة عشان أغير ترتيبها مش بتتشد» (§5.7): dropped on a row of its
// OWN column, a job takes that row's place — above it from the row's upper half, below it from the
// lower — and the column's new order is saved. Dropped on another column, it moves there (and stands
// last until that column is ordered). The grip shows only where one of the two can happen.
import { useState } from 'react';
import {
  type Locale,
  type OrgChartDepartmentDto,
  type OrgChartJobDto,
  type OrgChartSectionDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Select } from '../../../../shared/ui/form';
import { cn } from '../../../../shared/lib/cn';
import { localized } from '../../../../shared/lib/format';
import {
  dropIndex,
  moveTargets,
  reorderedIds,
  sameOrder,
  type DepartmentColumns,
} from '../lib/chart-model';

export interface ChartActions {
  /** May place, move and remove jobs (`jobTitle.edit`). */
  canPlace: boolean;
  /** May add sections (`section.create`). */
  canAddSection: boolean;
  /** May rename and stop sections (`section.edit`). */
  canEditSection: boolean;
  /** A write is on its way: every control waits for it (§2.2). */
  busy: boolean;
  onMove: (job: OrgChartJobDto, from: string | null, to: string | null) => void;
  /** A column's jobs in a new order: the whole column (§5.7). */
  onReorder: (sectionCatalogId: string | null, jobIds: string[]) => void;
  onRemove: (job: OrgChartJobDto, sectionCatalogId: string | null) => void;
  onAddJob: (sectionCatalogId: string | null) => void;
  onAddSection: () => void;
  onRename: (section: OrgChartSectionDto) => void;
  onStop: (section: OrgChartSectionDto) => void;
}

/** The two halves of a connector above a column: one each side of its centre (classic CSS tree). */
const BRANCH =
  "relative flex flex-col items-center px-2 pt-5 before:absolute before:start-0 before:top-0 before:h-5 before:w-1/2 before:border-t before:border-slate-300 before:content-[''] after:absolute after:end-0 after:top-0 after:h-5 after:w-1/2 after:border-s after:border-t after:border-slate-300 after:content-[''] first:before:border-t-0 last:before:border-e last:after:border-0 only:before:hidden only:after:border-s only:after:border-t-0 dark:before:border-slate-700 dark:after:border-slate-700";
/** The stem from the department down to the row of columns. */
const STEM =
  "relative flex justify-center pt-5 before:absolute before:start-1/2 before:top-0 before:h-5 before:border-s before:border-slate-300 before:content-[''] dark:before:border-slate-700";

/** Where a drag over a column would put the job: before or after the row at `index`. */
interface DropMark {
  index: number;
  after: boolean;
}

const JobRow = ({
  job,
  sectionCatalogId,
  department,
  actions,
  editing,
  locale,
  draggableRow,
  columnIds,
  columnEditable,
  mark,
  onDragStart,
  onDragEnd,
  onDragOverRow,
}: {
  job: OrgChartJobDto;
  sectionCatalogId: string | null;
  department: OrgChartDepartmentDto;
  actions: ChartActions;
  editing: boolean;
  locale: Locale;
  draggableRow: boolean;
  /** The column's job ids, in the order shown. */
  columnIds: readonly string[];
  /** The column takes writes: not a section stopped in the company list (§4.2, §5.7). */
  columnEditable: boolean;
  /** A drag of a job of THIS column is over this row: where it would land. */
  mark: 'before' | 'after' | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** Over this row: true when in its lower half. Undefined while nothing of this column is dragged. */
  onDragOverRow: ((after: boolean) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const controls = editing && actions.canPlace && department.editable;
  const targets = moveTargets(department);
  const sectionName = (id: string | null): string =>
    id === null
      ? t('organization.chart.direct')
      : localized(
          department.sections.find((s) => s.sectionCatalogId === id)?.name ?? { ar: '', en: '' },
          locale,
        );
  // «نقل إلى» only where there is somewhere else to go; ↑ / ↓ only where there is someone to pass.
  const canMove = controls && targets.length > 1;
  const canOrder = controls && columnEditable && columnIds.length > 1;
  // The grip only where a drag can do something: reorder this column, or move to another.
  const grip = controls && draggableRow && (canMove || canOrder);
  const index = columnIds.indexOf(job.id);
  const step = (by: -1 | 1): void => {
    const next = reorderedIds(columnIds, job.id, index + by);
    if (!sameOrder(next, columnIds)) actions.onReorder(sectionCatalogId, next);
  };
  const remove = (
    <Button
      size="sm"
      variant="ghost"
      className="ms-auto shrink-0"
      aria-label={t('organization.chart.remove')}
      title={t('organization.chart.remove')}
      disabled={actions.busy}
      onClick={() => actions.onRemove(job, sectionCatalogId)}
    >
      ✕
    </Button>
  );
  const arrows = canOrder && (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="shrink-0"
        aria-label={t('organization.chart.moveUp')}
        title={t('organization.chart.moveUp')}
        disabled={actions.busy || index <= 0}
        onClick={() => step(-1)}
      >
        ↑
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="shrink-0"
        aria-label={t('organization.chart.moveDown')}
        title={t('organization.chart.moveDown')}
        disabled={actions.busy || index === -1 || index >= columnIds.length - 1}
        onClick={() => step(1)}
      >
        ↓
      </Button>
    </>
  );
  const secondLine = canMove || canOrder;
  return (
    <div
      draggable={grip && !actions.busy}
      // Only the row itself starts a move — never a drag of selected text, never outside edit mode.
      onDragStart={(e) => {
        if (e.target !== e.currentTarget || !grip || actions.busy) return;
        // Firefox starts no drag without data, and «move» is what the cursor should say.
        e.dataTransfer.setData('text/plain', job.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={
        onDragOverRow === undefined
          ? undefined
          : (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const box = e.currentTarget.getBoundingClientRect();
              onDragOverRow(e.clientY > box.top + box.height / 2);
            }
      }
      aria-label={localized(job.name, locale)}
      className={cn(
        'relative rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900',
        grip && 'cursor-grab active:cursor-grabbing',
      )}
    >
      {mark !== null && (
        // Where the job would land: a bar on the row's upper or lower edge.
        <span
          aria-hidden
          data-drop-mark={mark}
          className={cn(
            'pointer-events-none absolute inset-x-1 h-0.5 rounded bg-brand-500',
            mark === 'before' ? '-top-1' : '-bottom-1',
          )}
        />
      )}
      <div className="flex min-h-8 items-center gap-2">
        {grip && (
          <span aria-hidden className="select-none text-slate-400">
            ↕
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
          {localized(job.name, locale)}
        </span>
        {controls && !secondLine && remove}
      </div>
      {secondLine && (
        <div className="mt-2 flex items-center gap-1">
          {arrows}
          {canMove && (
            <div className="min-w-0 flex-1">
              <Select
                aria-label={t('organization.chart.moveTo')}
                title={t('organization.chart.moveTo')}
                value={sectionCatalogId ?? ''}
                disabled={actions.busy}
                onChange={(e) => {
                  const to = e.target.value === '' ? null : e.target.value;
                  if (to !== sectionCatalogId) actions.onMove(job, sectionCatalogId, to);
                }}
              >
                {targets.map((target) => (
                  <option key={target.sectionCatalogId ?? ''} value={target.sectionCatalogId ?? ''}>
                    {sectionName(target.sectionCatalogId)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {remove}
        </div>
      )}
    </div>
  );
};

/** A section's (or the direct column's) jobs, a drop target in edit mode. */
const JobList = ({
  jobs,
  sectionCatalogId,
  department,
  actions,
  editing,
  locale,
  draggableRows,
  dragFrom,
  mark,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onLeaveColumn,
  onDrop,
  connector = true,
  targetEditable = true,
}: {
  jobs: readonly OrgChartJobDto[];
  sectionCatalogId: string | null;
  department: OrgChartDepartmentDto;
  actions: ChartActions;
  editing: boolean;
  locale: Locale;
  draggableRows: boolean;
  /** The column the dragged job comes from; undefined while nothing is dragged. */
  dragFrom: string | null | undefined;
  /** Where a drag inside this column would land, when one is over it. */
  mark: DropMark | null;
  onDragStart: (job: OrgChartJobDto, from: string | null) => void;
  onDragEnd: () => void;
  onDragOverRow: (sectionCatalogId: string | null, mark: DropMark) => void;
  /** The drag is no longer over this column's rows: forget where it would have landed. */
  onLeaveColumn: () => void;
  onDrop: (to: string | null) => void;
  /** Whether a job may be placed here: not under a section stopped or filed elsewhere in the list. */
  targetEditable?: boolean;
  /** The side line from the section box down its jobs; off where the jobs hang from the department. */
  connector?: boolean;
}): JSX.Element => {
  const t = useT();
  const canAdd = editing && actions.canPlace && department.editable && targetEditable;
  const ids = jobs.map((job) => job.id);
  // A drag of one of THIS column's jobs reorders it; the rows then say where it would land.
  const ordering = dragFrom !== undefined && dragFrom === sectionCatalogId && canAdd;
  return (
    <ul
      className={cn(
        'space-y-1.5',
        connector && 'mt-2 border-s border-slate-300 ps-3 dark:border-slate-700',
      )}
      // Takes a drop only where a job could be added (the browser refuses it elsewhere).
      onDragOver={(e) => {
        if (canAdd) e.preventDefault();
        // Over ANOTHER column the drop will move the job, so the bar in its own column must go.
        if (!ordering) onLeaveColumn();
      }}
      onDragLeave={(e) => {
        // Out of its own column altogether (the department box, the gap between columns): the
        // drop there does nothing, so nothing may say where it would land.
        const to = e.relatedTarget;
        if (ordering && !(to instanceof Node && e.currentTarget.contains(to))) onLeaveColumn();
      }}
      onDrop={() => {
        if (canAdd) onDrop(sectionCatalogId);
      }}
    >
      {jobs.map((job, index) => (
        <li key={job.id}>
          <JobRow
            job={job}
            sectionCatalogId={sectionCatalogId}
            department={department}
            actions={actions}
            editing={editing}
            locale={locale}
            draggableRow={draggableRows}
            columnIds={ids}
            columnEditable={targetEditable}
            mark={mark?.index === index ? (mark.after ? 'after' : 'before') : null}
            onDragStart={() => onDragStart(job, sectionCatalogId)}
            onDragEnd={onDragEnd}
            onDragOverRow={
              ordering
                ? (after) => onDragOverRow(sectionCatalogId, { index, after })
                : undefined
            }
          />
        </li>
      ))}
      {canAdd && (
        <li>
          <Button
            size="sm"
            variant="ghost-brand"
            disabled={actions.busy}
            onClick={() => actions.onAddJob(sectionCatalogId)}
          >
            + {t('organization.chart.addJob')}
          </Button>
        </li>
      )}
    </ul>
  );
};

/** A section's box: its name and how many branches have it; rename and stop in edit mode. */
const SectionBox = ({
  section,
  department,
  actions,
  editing,
  locale,
  dashed = false,
}: {
  section: OrgChartSectionDto | null;
  department: OrgChartDepartmentDto;
  actions: ChartActions;
  editing: boolean;
  locale: Locale;
  dashed?: boolean;
}): JSX.Element => {
  const t = useT();
  const sectionControls =
    section !== null &&
    editing &&
    actions.canEditSection &&
    section.editable &&
    department.editable;
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        dashed
          ? 'border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40'
          : 'border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-900',
      )}
    >
      <h4
        className={cn(
          'text-sm font-semibold',
          dashed ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100',
        )}
      >
        {section === null ? t('organization.chart.direct') : localized(section.name, locale)}
      </h4>
      {section !== null && !section.editable && (
        <div className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
          {section.sectionCatalogId === null
            ? t('organization.chart.notEditable')
            : t('organization.chart.sectionLocked')}
        </div>
      )}
      {sectionControls && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={actions.busy}
            onClick={() => actions.onRename(section)}
          >
            {t('organization.chart.rename')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={actions.busy}
            onClick={() => actions.onStop(section)}
          >
            {t('organization.chart.stop')}
          </Button>
        </div>
      )}
    </div>
  );
};

export const ChartBoard = ({
  department,
  columns,
  editing,
  actions,
  locale,
}: {
  department: OrgChartDepartmentDto;
  columns: DepartmentColumns;
  editing: boolean;
  actions: ChartActions;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  const [drag, setDrag] = useState<{ job: OrgChartJobDto; from: string | null } | null>(null);
  // Where a drag inside its own column would land, and in which column.
  const [over, setOver] = useState<{ column: string | null; mark: DropMark } | null>(null);
  const columnIdsOf = (sectionCatalogId: string | null): string[] =>
    (sectionCatalogId === null
      ? columns.direct
      : (columns.bySection.get(sectionCatalogId.toLowerCase()) ?? [])
    ).map((job) => job.id);
  const sections = department.sections;
  const showDirect = sections.length === 0 || columns.direct.length > 0 || editing;
  const canAddSection = editing && actions.canAddSection && department.editable;

  const drop = (to: string | null): void => {
    if (drag === null) return;
    const { job, from } = drag;
    const landing = over;
    setDrag(null);
    setOver(null);
    if (!editing || !actions.canPlace || !department.editable || actions.busy) return;
    if (to === from) {
      // Its own column: the row it was dropped on says where it goes (§5.7).
      if (landing === null || landing.column !== to) return;
      const ids = columnIdsOf(to);
      const next = reorderedIds(ids, job.id, dropIndex(ids, job.id, landing.mark.index, landing.mark.after));
      if (!sameOrder(next, ids)) actions.onReorder(to, next);
      return;
    }
    const target = moveTargets(department).some((place) => place.sectionCatalogId === to);
    if (target) actions.onMove(job, from, to);
  };
  const listProps = (draggableRows: boolean) => ({
    department,
    actions,
    editing,
    locale,
    draggableRows,
    dragFrom: drag === null ? undefined : drag.from,
    onDragStart: (job: OrgChartJobDto, from: string | null) => {
      setOver(null);
      setDrag({ job, from });
    },
    // A drag released anywhere else leaves nothing behind (the drop, when there is one, comes first).
    onDragEnd: () => {
      setDrag(null);
      setOver(null);
    },
    onLeaveColumn: () => setOver((now) => (now === null ? now : null)),
    onDragOverRow: (column: string | null, mark: DropMark) =>
      setOver((now) =>
        now !== null &&
        now.column === column &&
        now.mark.index === mark.index &&
        now.mark.after === mark.after
          ? now
          : { column, mark },
      ),
    onDrop: drop,
  });
  const markOf = (sectionCatalogId: string | null): DropMark | null =>
    over !== null && over.column === sectionCatalogId ? over.mark : null;

  const nothing = sections.length === 0 && columns.direct.length === 0 && !editing;
  // Wider in edit mode: a row's second line holds ↑ / ↓, «نقل إلى» and ✕, and the select must still
  // show the section's name.
  const columnWidth = editing ? 'w-64' : 'w-56';

  const departmentBox = (
    <div className="rounded-lg bg-brand-600 px-5 py-2.5 text-center text-white shadow-card">
      <div className="text-sm font-semibold">{localized(department.name, locale)}</div>
      <div className="mt-0.5 text-xs text-white/80">
        {t('organization.chart.inBranches', { n: department.branches.length })}
      </div>
    </div>
  );

  return (
    <>
      {/* From `sm` up: the top-down tree. */}
      <div className="hidden overflow-x-auto sm:block">
        <div className="flex min-w-max flex-col items-center px-2 pb-2">
          {departmentBox}
          {nothing ? (
            <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
              {t('organization.chart.noJobs')}
            </p>
          ) : sections.length === 0 ? (
            // No sections: the jobs hang directly under the department.
            <ul className={STEM}>
              <li className={BRANCH}>
                <div className={columnWidth}>
                  <JobList
                    jobs={columns.direct}
                    sectionCatalogId={null}
                    mark={markOf(null)}
                    {...listProps(true)}
                    connector={false}
                  />
                </div>
              </li>
            </ul>
          ) : (
            <ul className={STEM}>
              {showDirect && (
                <li className={BRANCH}>
                  <div className={columnWidth}>
                    <SectionBox
                      section={null}
                      department={department}
                      actions={actions}
                      editing={editing}
                      locale={locale}
                      dashed
                    />
                    <JobList
                      jobs={columns.direct}
                      sectionCatalogId={null}
                      mark={markOf(null)}
                      {...listProps(true)}
                    />
                  </div>
                </li>
              )}
              {sections.map((section) => (
                <li key={section.key} className={BRANCH}>
                  <div className={columnWidth}>
                    <SectionBox
                      section={section}
                      department={department}
                      actions={actions}
                      editing={editing}
                      locale={locale}
                    />
                    {section.sectionCatalogId !== null && (
                      <JobList
                        jobs={columns.bySection.get(section.sectionCatalogId.toLowerCase()) ?? []}
                        sectionCatalogId={section.sectionCatalogId}
                        mark={markOf(section.sectionCatalogId)}
                        {...listProps(true)}
                        targetEditable={section.editable}
                      />
                    )}
                  </div>
                </li>
              ))}
              {canAddSection && (
                <li className={BRANCH}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={actions.busy}
                    onClick={actions.onAddSection}
                  >
                    + {t('organization.chart.addSection')}
                  </Button>
                </li>
              )}
            </ul>
          )}
          {sections.length === 0 && canAddSection && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-4"
              disabled={actions.busy}
              onClick={actions.onAddSection}
            >
              + {t('organization.chart.addSection')}
            </Button>
          )}
        </div>
      </div>

      {/* Below `sm`: the same content as an indented tree. */}
      <div className="space-y-3 sm:hidden">
        {departmentBox}
        {nothing ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('organization.chart.noJobs')}
          </p>
        ) : (
          <ul className="space-y-3 ps-6">
            {(showDirect || sections.length === 0) && (
              <li>
                {sections.length > 0 && (
                  <SectionBox
                    section={null}
                    department={department}
                    actions={actions}
                    editing={editing}
                    locale={locale}
                    dashed
                  />
                )}
                <JobList
                  jobs={columns.direct}
                  sectionCatalogId={null}
                  mark={null}
                  {...listProps(false)}
                  connector={sections.length > 0}
                />
              </li>
            )}
            {sections.map((section) => (
              <li key={section.key}>
                <SectionBox
                  section={section}
                  department={department}
                  actions={actions}
                  editing={editing}
                  locale={locale}
                />
                {section.sectionCatalogId !== null && (
                  <JobList
                    jobs={columns.bySection.get(section.sectionCatalogId.toLowerCase()) ?? []}
                    sectionCatalogId={section.sectionCatalogId}
                    mark={null}
                    {...listProps(false)}
                    targetEditable={section.editable}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canAddSection && (
          <Button
            size="sm"
            variant="secondary"
            disabled={actions.busy}
            onClick={actions.onAddSection}
          >
            + {t('organization.chart.addSection')}
          </Button>
        )}
      </div>
    </>
  );
};
