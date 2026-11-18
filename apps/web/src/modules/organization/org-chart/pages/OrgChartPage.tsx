// «شجرة الهيكل التنظيمي» — the company org chart (P-ORG-3, docs/12-planning/org-chart-design.md §2).
//
// «عبارة عن شارت بالشركة كلها .. فيه الإدارات والأقسام والمسميات الوظيفية … فوق كل الإدارات جنب بعض
// فى كروت ولما أختار إدارة بالضغط على كارت يجيب تحتها الشارت بتاع هيكلها التنظيمي». The tiles are every
// company department (branch copies folded by the server); the chart below is the picked one's
// sections and the jobs placed in each.
//
// EDIT MODE saves each gesture at once (the organize board's model). A job's place is the job's own
// update — the same write the job form makes — so the two screens never disagree (§5.2, ADR-038).
// One change is in flight at a time, and the controls wait until the chart in the cache carries the
// job's new version, so the next gesture never sends a stale one (§2.2, §6.1).
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type Locale, type OrgChartJobDto, type OrgChartSectionDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, EmptyState } from '../../../../shared/ui';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { useHealedGroupKeys } from '../../../../shared/lib/useHealedGroupKeys';
import {
  useAddChartSection,
  useChangeJobPlaces,
  useOrderChartColumn,
  useOrgChart,
  useRenameChartSection,
  useStopChartSection,
} from '../org-chart-queries';
import { columnsOf, pickDepartment, placesAfter, type PlaceChange } from '../lib/chart-model';
import { DepartmentTiles } from '../components/DepartmentTiles';
import { ChartBoard, type ChartActions } from '../components/ChartBoard';
import {
  AddJobDialog,
  AddSectionDialog,
  RenameSectionDialog,
  StopSectionDialog,
} from '../components/ChartDialogs';

type Open =
  | { kind: 'addSection' }
  | { kind: 'rename'; section: OrgChartSectionDto }
  | { kind: 'stop'; section: OrgChartSectionDto }
  | { kind: 'addJob'; sectionCatalogId: string | null }
  | null;

export const OrgChartPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Open>(null);

  const chart = useOrgChart();
  const addSection = useAddChartSection();
  const renameSection = useRenameChartSection();
  const stopSection = useStopChartSection();
  const changePlaces = useChangeJobPlaces();
  const orderColumn = useOrderChartColumn();

  const canPlace = can('jobTitle.edit');
  const canAddSection = can('section.create');
  const canEditSection = can('section.edit');
  const mayEdit = canPlace || canAddSection || canEditSection;
  // Busy from the click until the refetched chart lands: the next gesture reads the new version.
  const busy =
    addSection.isPending ||
    renameSection.isPending ||
    stopSection.isPending ||
    changePlaces.isPending ||
    orderColumn.isPending ||
    chart.isFetching;

  // By name in the current language (§2.1); the server's order is by the Arabic name.
  const departments = useMemo(
    () =>
      [...(chart.data?.departments ?? [])].sort((a, b) =>
        localized(a.name, locale).localeCompare(localized(b.name, locale), locale),
      ),
    [chart.data, locale],
  );
  const jobs = chart.data?.jobs ?? [];
  // A link to a department from before it was linked to the company list still opens it.
  useHealedGroupKeys(
    [params, setParams],
    [
      {
        param: 'dept',
        choices: departments,
        read: (raw) => (raw === '' ? [] : [raw]),
        write: (keys) => keys[0] ?? null,
      },
    ],
  );
  const department = pickDepartment(departments, params.get('dept'));
  const jobCounts = useMemo(
    () => new Map(departments.map((d) => [d.key, columnsOf(d, jobs).jobCount])),
    [departments, jobs],
  );
  const columns = useMemo(
    () => (department === null ? null : columnsOf(department, jobs)),
    [department, jobs],
  );

  const select = (key: string): void => {
    const next = new URLSearchParams(params);
    next.set('dept', key);
    setParams(next, { replace: true });
  };

  /** One change of one job's places, through the job's own update; the chart refreshes after it. */
  const change = (job: OrgChartJobDto, placeChange: PlaceChange, after?: () => void): void => {
    changePlaces.mutate(
      { id: job.id, version: job.version, places: placesAfter(job, placeChange) },
      {
        onSuccess: () => {
          toast.success(t('organization.chart.saved'));
          after?.();
        },
        // The shared error toast words the refusal; a stale version also brings the chart up to date.
        onError: () => void chart.refetch(),
      },
    );
  };

  const departmentCatalogId = department?.departmentCatalogId ?? '';
  const actions: ChartActions = {
    canPlace,
    canAddSection,
    canEditSection,
    busy,
    onMove: (job, from, to) => change(job, { kind: 'move', departmentCatalogId, from, to }),
    // The column's new order, the whole of it (§5.7); a chart that moved on meanwhile is refused
    // with STALE_DOCUMENT and refetched, as a stale job version is.
    onReorder: (sectionCatalogId, jobTitleIds) =>
      orderColumn.mutate(
        { departmentCatalogId, sectionCatalogId, jobTitleIds },
        {
          onSuccess: () => toast.success(t('organization.chart.orderSaved')),
          onError: () => void chart.refetch(),
        },
      ),
    onRemove: (job, sectionCatalogId) =>
      change(job, { kind: 'remove', departmentCatalogId, sectionCatalogId }),
    onAddJob: (sectionCatalogId) => setOpen({ kind: 'addJob', sectionCatalogId }),
    onAddSection: () => setOpen({ kind: 'addSection' }),
    onRename: (section) => setOpen({ kind: 'rename', section }),
    onStop: (section) => setOpen({ kind: 'stop', section }),
  };

  const close = (): void => setOpen(null);
  /** Each section act says what it did, as the organize board's do. */
  const doneThenClose = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      close();
    },
  });

  const header = (
    <PageHeader
      title={t('organization.chart.title')}
      breadcrumbs={[
        { label: t('organization.title'), to: '/organization' },
        { label: t('organization.chart.title') },
      ]}
      actions={
        mayEdit && departments.length > 0 ? (
          <Button size="sm" onClick={() => setEditing((on) => !on)}>
            {editing ? t('organization.chart.doneEditing') : t('organization.chart.edit')}
          </Button>
        ) : undefined
      }
    />
  );

  if (chart.isLoading) {
    return (
      <PageContainer>
        {header}
        <LoadingState />
      </PageContainer>
    );
  }
  if (chart.isError || chart.data === undefined) {
    return (
      <PageContainer>
        {header}
        <ErrorState error={chart.error} onRetry={() => void chart.refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {header}

      {departments.length === 0 || department === null || columns === null ? (
        <EmptyState
          title={t('organization.chart.empty')}
          action={
            can('department.create') ? (
              <Link
                to="/organization/departments"
                className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                {t('organization.chart.goToDepartments')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <DepartmentTiles
            departments={departments}
            jobCounts={jobCounts}
            selectedKey={department.key}
            onSelect={select}
            search={search}
            onSearch={setSearch}
            locale={locale}
          />

          {editing && (
            <p className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-300">
              {t('organization.chart.editingBanner')}
            </p>
          )}

          <Card>
            <CardHeader
              title={t('organization.chart.structureOf', {
                name: localized(department.name, locale),
              })}
              description={[
                department.sections.length === 0
                  ? t('organization.chart.noSections')
                  : t('organization.chart.sectionsCount', { n: department.sections.length }),
                t('organization.chart.jobsCount', { n: columns.jobCount }),
                ...(department.editable
                  ? []
                  : [
                      department.departmentCatalogId === null
                        ? t('organization.chart.notEditable')
                        : t('organization.chart.stoppedInList'),
                    ]),
              ].join(' · ')}
            />
            <CardBody>
              <ChartBoard
                department={department}
                columns={columns}
                editing={editing}
                actions={actions}
                locale={locale}
              />
            </CardBody>
          </Card>
        </>
      )}

      {open?.kind === 'addSection' && department !== null && (
        <AddSectionDialog
          department={department}
          locale={locale}
          pending={addSection.isPending}
          onClose={close}
          onSubmit={(name, branchIds) =>
            addSection.mutate(
              { departmentCatalogId, name, branchIds },
              doneThenClose(t('organization.chart.sectionAdded')),
            )
          }
        />
      )}
      {open?.kind === 'rename' && (
        <RenameSectionDialog
          section={open.section}
          locale={locale}
          pending={renameSection.isPending}
          onClose={close}
          onSubmit={(name) =>
            renameSection.mutate(
              {
                id: open.section.sectionCatalogId ?? '',
                body: { name, version: open.section.catalogVersion ?? 0 },
              },
              doneThenClose(t('organization.chart.sectionRenamed')),
            )
          }
        />
      )}
      {open?.kind === 'stop' && (
        <StopSectionDialog
          section={open.section}
          locale={locale}
          pending={stopSection.isPending}
          onClose={close}
          onConfirm={() =>
            stopSection.mutate(
              {
                id: open.section.sectionCatalogId ?? '',
                body: { version: open.section.catalogVersion ?? 0 },
              },
              doneThenClose(t('organization.chart.sectionStopped')),
            )
          }
        />
      )}
      {open?.kind === 'addJob' && department !== null && (
        <AddJobDialog
          chart={chart.data}
          department={department}
          sectionCatalogId={open.sectionCatalogId}
          locale={locale}
          pending={changePlaces.isPending}
          onClose={close}
          onSubmit={(jobId) => {
            const job = jobs.find((entry) => entry.id === jobId);
            if (job === undefined) return;
            change(
              job,
              { kind: 'add', departmentCatalogId, sectionCatalogId: open.sectionCatalogId },
              close,
            );
          }}
        />
      )}
    </PageContainer>
  );
};
