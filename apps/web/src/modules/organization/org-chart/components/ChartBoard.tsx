// One department's chart (P-ORG-3 §2.1, §2.2): the department, its sections side by side, each
// section's jobs under it, and the jobs placed directly under the department in a dashed first
// column. From `sm` up it is drawn as a top-down tree whose connectors are logical borders, so they
// mirror in RTL by themselves; below `sm` the same content is an indented tree.
//
// Edit mode follows the organize board (`OrganizeApplicationsPage`): every gesture is one write, and
// dragging is never the only way — each job row also has «نقل إلى» and «إزالة من هنا».
import { useState } from 'react';
import { type Locale, type OrgChartDepartmentDto, type OrgChartJobDto, type OrgChartSectionDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Select } from '../../../../shared/ui/form';
import { cn } from '../../../../shared/lib/cn';
import { localized } from '../../../../shared/lib/format';
import { moveTargets, type DepartmentColumns } from '../lib/chart-model';

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
  onRemove: (job: OrgChartJobDto, sectionCatalogId: string | null) => void;
  onAddJob: (sectionCatalogId: string | null) => void;
  onAddSection: () => void;
  onRename: (section: OrgChartSectionDto) => void;
  onStop: (section: OrgChartSectionDto) => void;
}

/** The two halves of a connector above a column: one each side of its centre (classic CSS tree). */
const BRANCH =
  "relative flex flex-col items-center px-2 pt-5 before:absolute before:start-0 before:top-0 before:h-5 before:w-1/2 before:border-t before:border-slate-300 before:content-[''] after:absolute after:end-0 after:top-0 after:h-5 after:w-1/2 after:border-s after:border-t after:border-slate-300 after:content-[''] first:before:border-t-0 last:before:border-e last:after:border-0 only:before:hidden only:after:border-t-0 dark:before:border-slate-700 dark:after:border-slate-700";
/** The stem from the department down to the row of columns. */
const STEM =
  "relative flex justify-center pt-5 before:absolute before:start-1/2 before:top-0 before:h-5 before:border-s before:border-slate-300 before:content-[''] dark:before:border-slate-700";

const JobRow = ({
  job,
  sectionCatalogId,
  department,
  actions,
  editing,
  locale,
  draggableRow,
  onDragStart,
}: {
  job: OrgChartJobDto;
  sectionCatalogId: string | null;
  department: OrgChartDepartmentDto;
  actions: ChartActions;
  editing: boolean;
  locale: Locale;
  draggableRow: boolean;
  onDragStart: () => void;
}): JSX.Element => {
  const t = useT();
  const controls = editing && actions.canPlace && department.editable;
  const sectionName = (id: string | null): string =>
    id === null
      ? t('organization.chart.direct')
      : localized(department.sections.find((s) => s.sectionCatalogId === id)?.name ?? { ar: '', en: '' }, locale);
  return (
    <div
      draggable={controls && draggableRow && !actions.busy}
      onDragStart={onDragStart}
      aria-label={localized(job.name, locale)}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
    >
      {controls && draggableRow && (
        <span aria-hidden className="cursor-grab select-none text-slate-400">
          ↕
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{localized(job.name, locale)}</span>
      {controls && (
        <span className="flex shrink-0 items-center gap-1">
          {/* A fixed width around the shared Select, which always fills its holder. */}
          <span className="w-32">
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
              {moveTargets(department).map((target) => (
                <option key={target.sectionCatalogId ?? ''} value={target.sectionCatalogId ?? ''}>
                  {sectionName(target.sectionCatalogId)}
                </option>
              ))}
            </Select>
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('organization.chart.remove')}
            title={t('organization.chart.remove')}
            disabled={actions.busy}
            onClick={() => actions.onRemove(job, sectionCatalogId)}
          >
            ✕
          </Button>
        </span>
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
  onDragStart,
  onDrop,
}: {
  jobs: readonly OrgChartJobDto[];
  sectionCatalogId: string | null;
  department: OrgChartDepartmentDto;
  actions: ChartActions;
  editing: boolean;
  locale: Locale;
  draggableRows: boolean;
  onDragStart: (job: OrgChartJobDto, from: string | null) => void;
  onDrop: (to: string | null) => void;
}): JSX.Element => {
  const t = useT();
  const canAdd = editing && actions.canPlace && department.editable;
  return (
    <ul
      className="mt-2 space-y-1.5 border-s border-slate-300 ps-3 dark:border-slate-700"
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(sectionCatalogId)}
    >
      {jobs.map((job) => (
        <li key={job.id}>
          <JobRow
            job={job}
            sectionCatalogId={sectionCatalogId}
            department={department}
            actions={actions}
            editing={editing}
            locale={locale}
            draggableRow={draggableRows}
            onDragStart={() => onDragStart(job, sectionCatalogId)}
          />
        </li>
      ))}
      {canAdd && (
        <li>
          <button
            type="button"
            disabled={actions.busy}
            onClick={() => actions.onAddJob(sectionCatalogId)}
            className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-start text-sm text-brand-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-slate-800/60"
          >
            + {t('organization.chart.addJob')}
          </button>
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
    section !== null && editing && actions.canEditSection && section.editable && department.editable;
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        dashed
          ? 'border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40'
          : 'border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-900',
      )}
    >
      <div className={cn('text-sm font-semibold', dashed ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100')}>
        {section === null ? t('organization.chart.direct') : localized(section.name, locale)}
      </div>
      {section !== null && !section.editable && (
        <div className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{t('organization.chart.notEditable')}</div>
      )}
      {sectionControls && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button size="sm" variant="secondary" disabled={actions.busy} onClick={() => actions.onRename(section)}>
            {t('organization.chart.rename')}
          </Button>
          <Button size="sm" variant="ghost" disabled={actions.busy} onClick={() => actions.onStop(section)}>
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
  const sections = department.sections;
  const showDirect = sections.length === 0 || columns.direct.length > 0 || editing;
  const canAddSection = editing && actions.canAddSection && department.editable;

  const drop = (to: string | null): void => {
    if (drag === null) return;
    const { job, from } = drag;
    setDrag(null);
    if (to !== from) actions.onMove(job, from, to);
  };
  const listProps = (draggableRows: boolean) => ({
    department,
    actions,
    editing,
    locale,
    draggableRows,
    onDragStart: (job: OrgChartJobDto, from: string | null) => setDrag({ job, from }),
    onDrop: drop,
  });

  const nothing = sections.length === 0 && columns.direct.length === 0 && !editing;

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
            <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">{t('organization.chart.noJobs')}</p>
          ) : sections.length === 0 ? (
            // No sections: the jobs hang directly under the department.
            <ul className={STEM}>
              <li className={BRANCH}>
                <div className="w-56">
                  <JobList jobs={columns.direct} sectionCatalogId={null} {...listProps(true)} />
                </div>
              </li>
            </ul>
          ) : (
            <ul className={STEM}>
              {showDirect && (
                <li className={BRANCH}>
                  <div className="w-56">
                    <SectionBox section={null} department={department} actions={actions} editing={editing} locale={locale} dashed />
                    <JobList jobs={columns.direct} sectionCatalogId={null} {...listProps(true)} />
                  </div>
                </li>
              )}
              {sections.map((section) => (
                <li key={section.key} className={BRANCH}>
                  <div className="w-56">
                    <SectionBox section={section} department={department} actions={actions} editing={editing} locale={locale} />
                    {section.sectionCatalogId !== null && (
                      <JobList
                        jobs={columns.bySection.get(section.sectionCatalogId.toLowerCase()) ?? []}
                        sectionCatalogId={section.sectionCatalogId}
                        {...listProps(true)}
                      />
                    )}
                  </div>
                </li>
              ))}
              {canAddSection && (
                <li className={BRANCH}>
                  <button
                    type="button"
                    disabled={actions.busy}
                    onClick={actions.onAddSection}
                    className="w-44 rounded-lg border border-dashed border-brand-400 bg-white px-3 py-3 text-sm font-medium text-brand-700 hover:bg-brand-50/70 disabled:opacity-60 dark:bg-slate-900 dark:text-brand-300 dark:hover:bg-brand-950/50"
                  >
                    + {t('organization.chart.addSection')}
                  </button>
                </li>
              )}
            </ul>
          )}
          {sections.length === 0 && canAddSection && (
            <Button size="sm" variant="secondary" className="mt-4" disabled={actions.busy} onClick={actions.onAddSection}>
              + {t('organization.chart.addSection')}
            </Button>
          )}
        </div>
      </div>

      {/* Below `sm`: the same content as an indented tree. */}
      <div className="space-y-3 sm:hidden">
        {departmentBox}
        {nothing ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('organization.chart.noJobs')}</p>
        ) : (
          <ul className="space-y-3 border-s border-slate-300 ps-3 dark:border-slate-700">
            {(showDirect || sections.length === 0) && (
              <li>
                {sections.length > 0 && (
                  <SectionBox section={null} department={department} actions={actions} editing={editing} locale={locale} dashed />
                )}
                <JobList jobs={columns.direct} sectionCatalogId={null} {...listProps(false)} />
              </li>
            )}
            {sections.map((section) => (
              <li key={section.key}>
                <SectionBox section={section} department={department} actions={actions} editing={editing} locale={locale} />
                {section.sectionCatalogId !== null && (
                  <JobList
                    jobs={columns.bySection.get(section.sectionCatalogId.toLowerCase()) ?? []}
                    sectionCatalogId={section.sectionCatalogId}
                    {...listProps(false)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canAddSection && (
          <Button size="sm" variant="secondary" disabled={actions.busy} onClick={actions.onAddSection}>
            + {t('organization.chart.addSection')}
          </Button>
        )}
      </div>
    </>
  );
};
