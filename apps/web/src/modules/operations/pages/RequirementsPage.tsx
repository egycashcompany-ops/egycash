// Operations crew roster and requirements (B3) — the legacy `/requirement` screen.
//
// WHAT THE LEGACY SCREEN WAS (discovery §9, contad_app.js:4324-4372): a matrix of NINE checkboxes
// written onto the employee document. Only `leader` was ever read by a server query; the rest were
// pool decoration and browser filters, and four of them were never read at all (quirk Q25).
//
// TWO THINGS THIS SCREEN IS NOT:
//   1. It is not an eligibility editor. Nothing here gates an assignment — the crew board will
//      accept an employee with every box unticked, and one with no row at all. That is the
//      approved decision, and the integration tests assert it rather than trusting this comment.
//   2. It is not an HR screen. The row belongs to Operations; the person belongs to HR. Adding
//      someone here says "this person is operations crew", it does not edit their employee record.
//
// Membership is the ORG CHART (`operations.crewDepartmentIds`, chosen on «إدارات العمليات» —
// `CrewDepartmentsPage.tsx`), so this screen adds and removes nobody. What it records is what
// Operations knows ABOUT a member — the flags — and the row behind them is created the first time
// one is set. Somebody with no row yet shows with nothing recorded.
//
// ROUND 19 — «عاوز احسن الui بتاع الشاشة دى دا كان القديم برضو القى نظره», with the legacy screen
// beside this one. It is rebuilt in the Operations boards' look, after the legacy layout:
//
//   · the boards' toolbar — the title, the figures over the rows shown (how many, how many
//     «قادة», how many «أخصائيون»), and «تراجع» / «حفظ (n)» at its end;
//   · the boards' dark one-row filter bar, after legacy's «ابحث بال ID» | «ابحث بالاسم» | «اختر
//     الوظيفة», and «يحمل» — the flags a member must hold. Remembered across visits, as the boards
//     remember theirs;
//   · the boards' dark table, each flag legacy's ROUND toggle — green with ✓ when set, grey when
//     not (`RosterFlagToggle`);
//   · a BATCH save, as legacy's «حفظ» was: a tick waits, ringed, its row tinted, until «حفظ (n)»
//     sends them all — or «تراجع» drops them, and leaving with ticks waiting asks first. The old
//     screen saved each tick the moment it was pressed, so a slip of the finger was already
//     written.
//
// ROUND 19b — «اعمل سامبل لواحدة يكون فيها الاسم بتاع القائد فى الاول وجمبه صغير كدا الكود ولما اقف
// على القائد يجيب بياناته زى السواق. والفلاتر تكون ترتبيها زى الجدول والغى السيرش بالكود خليه مكان
// واحد للاسم والكود سوا»:
//
//   · the table starts with the PERSON — the name, the code small and muted beside it — and the
//     separate «الكود» column is gone: الاسم | الوظيفة | the flags;
//   · hovering the name (or reaching it with Tab) opens the member's card in the Fleet driver
//     card's look: the code, «الوظيفة», the mobile number, the branch and what they hold
//     (`RosterMemberHoverName`);
//   · the filters run in the columns' order: ONE box «الاسم أو الكود» at the person's place, then
//     «الوظيفة», then «يحمل». The code's own box is gone; a view remembered (or linked) with the
//     two old boxes opens with their text in the one (`searchFromOldBoxes`).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Locale, type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatNumber } from '../../../shared/lib/format';
import { readList, writeList } from '../../../shared/lib/list-param';
import { pluralKey } from '../../../shared/lib/plural';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { useUnsavedGuard } from '../../atm/lib/useUnsavedGuard';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../fleet/components/board-scroll';
import { DARK_FILTER_BAR } from '../../fleet/components/dark-filter-bar';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { FILTER_ICON, FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { FleetPager } from '../../fleet/components/FleetPager';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import {
  useOperationsCrewDirectory,
  useSaveCrewRequirementsBatch,
} from '../api/operations-queries';
import { BoardFigurePill, FIGURE_TONE } from '../components/BoardFigures';
import { ChooseCrewDepartments } from '../components/CrewRosterNotice';
import { RosterFlagToggle } from '../components/RosterFlagToggle';
import { RosterMemberHoverName } from '../components/RosterMemberCard';
import {
  ADD_BUTTON,
  BAR_LAYOUT,
  BOARD_TABLE_LOOK,
  BRAND_BUTTON,
} from '../components/ShipmentsBoard';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import {
  NO_JOB_TITLE,
  NO_PENDING,
  REQUIREMENT_FLAGS,
  hasRosterFilter,
  isPendingCell,
  isRequirementFlag,
  jobTitleChoices,
  keepUnsaved,
  pendingCellCount,
  pendingRows,
  rosterFigures,
  rosterRows,
  searchFromOldBoxes,
  shownFlag,
  toSaveRequests,
  togglePending,
  type PendingFlags,
  type RosterFilters,
} from '../lib/requirements';
import { HISTORY_PAGE_SIZE, HISTORY_PAGE_SIZES, pageOfRows } from '../lib/shipment-history';

/**
 * Remembered across visits, as the boards remember theirs: the name or code typed (`q`), the job
 * titles and the flags chosen. The roster is the same every day, so the screen asks for no day
 * (the same read «إدارات العمليات» and the standing crew make).
 *
 * `code` and `name` — the two boxes before Round 19b — are read only to be folded into `q` and
 * dropped from the address, never remembered.
 */
const REMEMBERED_FILTERS = ['q', 'job', 'flags'] as const;

/** The pager shows once the roster is longer than the smallest page it offers. */
const PAGER_FROM = Math.min(...HISTORY_PAGE_SIZES);

/** Every filter is `density="tight"`, as on the boards. */
const TIGHT = 'tight' as const;

/**
 * The boards' table, over this screen's cells: the round toggles keep their own size (the boards'
 * table squares every button in a cell for its row icons), and the flag columns sit narrow —
 * twelve columns beside the menu on a laptop. The person and «الوظيفة» read from the start edge.
 */
const ROSTER_TABLE = cn(
  BOARD_TABLE_LOOK,
  BOARD_TABLE_FILL,
  '[&_td_button[role=switch]]:!h-[30px] [&_td_button[role=switch]]:!w-[30px]',
  '[&_td:has([role=switch])]:!px-1 [&_th]:!text-center [&_th:nth-child(-n+2)]:!text-start',
);

/**
 * A name or a title that may wrap rather than widen its column (the table's cells are `nowrap`) —
 * onto two lines at most for the legacy roster's longest («عبد الغنى ظهير محمدالامين عبد الله»,
 * «رئيس قسم تشغيل نقل الاموال»), so a phone's rows stay a toggle high rather than three lines.
 */
const NAME_WRAP = 'block min-w-[10rem] max-w-[15rem] whitespace-normal leading-snug';
const TITLE_WRAP = 'block min-w-[9rem] max-w-[14rem] whitespace-normal leading-snug';

export const RequirementsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // Today's `canPlan` rule: setting a flag is a planning decision, on the crew board's grant.
  const canPlan = can('operationsCrew.plan');

  // The roster is day-independent; `null` is the read «إدارات العمليات» and the standing crew make
  // too, so the three screens share one answer.
  const directory = useOperationsCrewDirectory(null);
  const save = useSaveCrewRequirementsBatch();
  const members = directory.data?.members ?? [];
  const loaded = directory.data !== undefined;

  // ── The filters, in the URL and remembered ────────────────────────────────────────────────────
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  // The two boxes before Round 19b, from a remembered view or an old link: read into the one box
  // at once (no flash of the whole roster), then taken off the address — so what is remembered
  // from here on is `q`.
  const oldCode = sp.get('code');
  const oldName = sp.get('name');
  const filters: RosterFilters = {
    search: sp.get('q') ?? searchFromOldBoxes(oldCode, oldName),
    jobs: readList(sp, 'job'),
    flags: readList(sp, 'flags').filter(isRequirementFlag),
  };
  useEffect(() => {
    if (oldCode === null && oldName === null) return;
    const next = new URLSearchParams(sp);
    next.delete('code');
    next.delete('name');
    const folded = searchFromOldBoxes(oldCode, oldName);
    if (!next.has('q') && folded !== '') next.set('q', folded);
    setSp(next, { replace: true });
  }, [oldCode, oldName, sp, setSp]);
  // `replace`: narrowing the roster is a view of it, not a place to go Back to.
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [name, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(name);
      else next.set(name, value);
    }
    setSp(next, { replace: true });
  };

  // ── The ticks waiting for «حفظ» ───────────────────────────────────────────────────────────────
  const [pending, setPending] = useState<PendingFlags>(NO_PENDING);
  // The rows the last save could not write, with the server's reason — marked until the next save.
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
  // Read against the roster as it is now: a tick the server has come to agree with is no change.
  const waiting = pendingRows(members, pending);
  const waitingCells = pendingCellCount(waiting);
  const dirty = waiting.length > 0;
  const waitingIds = new Set(waiting.map((row) => row.member.employeeId));

  // «لديك تغييرات غير محفوظة» — a link in the menu, «إدارات العمليات», a reload.
  const guard = useUnsavedGuard({ dirty });

  const discard = (): void => {
    setPending(NO_PENDING);
    setFailures(new Map());
  };

  const onSave = async (): Promise<void> => {
    if (!dirty || save.isPending) return;
    // Built at the moment of saving, from the roster as it is: each row the saved one with the
    // ticks over it, so a flag another planner set meanwhile is not written back unticked.
    const result = await save.mutateAsync(toSaveRequests(waiting));
    const failed = new Set(result.failed.map((row) => row.employeeId));
    setPending((current) => keepUnsaved(current, failed));
    setFailures(
      new Map(result.failed.map((row) => [row.employeeId, errorMessage(row.error, locale)])),
    );
    // ONE summary for the whole press, as legacy's «حفظ» answered once: all saved (success), none
    // saved (error), or some of each — one warning that names both, rather than a green and a red
    // toast stacked over the toolbar for the same press.
    const saved = result.saved.length;
    const savedText = t(pluralKey('operations.crew.requirements.saved', locale, saved), {
      count: formatNumber(saved, locale),
    });
    const notSavedText = t(pluralKey('operations.crew.requirements.notSaved', locale, failed.size), {
      count: formatNumber(failed.size, locale),
    });
    if (failed.size === 0) toast.success(savedText);
    else if (saved === 0) toast.error(notSavedText);
    else toast.warning(savedText, notSavedText);
  };

  // ── The rows ──────────────────────────────────────────────────────────────────────────────────
  const rows = rosterRows(members, filters);
  const figures = rosterFigures(rows, pending);
  const choices = jobTitleChoices(members, locale);

  // A page of the rows when the roster is long, kept with the view it was chosen on: a filter
  // changing puts the reader back on page 1 (the boards' paging, `ShipmentsBoard`).
  const view = sp.toString();
  const [paging, setPaging] = useState({ view, page: 1, size: HISTORY_PAGE_SIZE });
  if (paging.view !== view) setPaging({ view, page: 1, size: paging.size });
  const shown = pageOfRows(rows, paging.view === view ? paging.page : 1, paging.size);

  const flagLabel = (flag: string): string => t(`operations.crew.flag.${flag}`);

  const columns: Column<OperationsCrewMemberDto>[] = [
    {
      // The PERSON, first: the name — which opens their card — and the code small beside it.
      key: 'name',
      header: t('operations.crew.requirements.name'),
      render: (row) => {
        const failure = failures.get(row.employeeId);
        return (
          <span className="flex items-baseline gap-2" data-roster-person={row.code}>
            <RosterMemberHoverName member={row} className={NAME_WRAP} />
            {/* A figure: the figures' face, set left to right and isolated from the name. */}
            <span
              dir="ltr"
              className={cn(
                'shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400',
                NUM,
              )}
              data-roster-code="true"
            >
              {row.code}
            </span>
            {failure !== undefined && (
              // Not saved — said on the row it is about, with the server's reason.
              <span
                role="img"
                data-roster-failed={row.employeeId}
                aria-label={t('operations.crew.requirements.rowNotSaved', { reason: failure })}
                title={t('operations.crew.requirements.rowNotSaved', { reason: failure })}
                className="shrink-0 self-start text-red-600 dark:text-red-400"
              >
                <BoardIcon d={PATH.warn} className="h-4 w-4" />
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'jobTitle',
      header: t('operations.crew.requirements.jobTitle'),
      render: (row) =>
        row.jobTitle === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className={cn(TITLE_WRAP, 'text-slate-600 dark:text-slate-300')}>
            {row.jobTitle.name[locale] || row.jobTitle.name.ar}
          </span>
        ),
    },
    ...REQUIREMENT_FLAGS.map(
      (flag): Column<OperationsCrewMemberDto> => ({
        key: flag,
        header: flagLabel(flag),
        align: 'center',
        render: (row) => (
          <RosterFlagToggle
            flag={flag}
            on={shownFlag(row, pending, flag)}
            pending={isPendingCell(row, pending, flag)}
            label={`${flagLabel(flag)} — ${row.fullNameAr}`}
            pendingNote={t('operations.crew.requirements.pendingCell')}
            disabled={!canPlan || save.isPending}
            onToggle={() => setPending((current) => togglePending(current, row, flag))}
          />
        ),
      }),
    ),
  ];

  const filtered = hasRosterFilter(filters);

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME} data-requirements-page="true">
        {/* The boards' toolbar: the title and the figures at the start, the acts at the end. */}
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
          data-requirements-toolbar="true"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  FIGURE_TONE.count,
                )}
              >
                <BoardIcon d={[...SHIPMENT_PATH.crew]} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="text-base font-black leading-6 text-slate-900 sm:text-lg dark:text-white">
                  {t('operations.crew.requirements.title')}
                </h1>
                {/* Said once, plainly, on the screen an operator might otherwise read as a gate —
                  a line under the title now rather than a card of its own. */}
                <p
                  className="flex max-w-[34rem] items-start gap-1 text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400"
                  data-requirements-hint="true"
                >
                  <BoardIcon d={[...SHIPMENT_PATH.info]} className="mt-px h-3.5 w-3.5 shrink-0" />
                  {t('operations.crew.requirements.notAGate')}
                </p>
              </div>
            </div>
            <div
              role="status"
              aria-label={t('operations.board.stats')}
              className="flex min-w-0 flex-wrap items-center gap-1.5"
              data-requirements-figures="true"
            >
              <BoardFigurePill
                icon={SHIPMENT_PATH.crew}
                tone={FIGURE_TONE.count}
                label={t('operations.crew.requirements.figures.members')}
                value={
                  !loaded
                    ? '…'
                    : rows.length === members.length
                      ? formatNumber(rows.length, locale)
                      : `${formatNumber(rows.length, locale)} / ${formatNumber(members.length, locale)}`
                }
                data-figure="members"
              />
              <BoardFigurePill
                icon={SHIPMENT_PATH.person}
                tone={FIGURE_TONE.pound}
                label={t('operations.crew.requirements.figures.captains')}
                value={loaded ? formatNumber(figures.captains, locale) : '…'}
                data-figure="captains"
              />
              <BoardFigurePill
                icon={FILTER_ICON.licence}
                tone={FIGURE_TONE.dollar}
                label={t('operations.crew.requirements.figures.specialists')}
                value={loaded ? formatNumber(figures.specialists, locale) : '…'}
                data-figure="specialists"
              />
            </div>
          </div>
          {canPlan ? (
            <span className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
              <button
                type="button"
                data-requirements-discard="true"
                disabled={!dirty || save.isPending}
                onClick={discard}
                className={cn(BRAND_BUTTON, 'disabled:cursor-not-allowed disabled:opacity-50')}
              >
                <BoardIcon d={[...SHIPMENT_PATH.undo]} className="h-3.5 w-3.5" />
                {t('operations.crew.requirements.discard')}
              </button>
              <button
                type="button"
                data-requirements-save={waitingCells}
                disabled={!dirty || save.isPending}
                aria-busy={save.isPending}
                onClick={() => void onSave()}
                className={cn(
                  dirty ? ADD_BUTTON : BRAND_BUTTON,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {save.isPending ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <BoardIcon d={[...SHIPMENT_PATH.check]} className="h-3.5 w-3.5" width={2.5} />
                )}
                {t('operations.crew.requirements.save', {
                  count: formatNumber(waitingCells, locale),
                })}
              </button>
            </span>
          ) : (
            // A reader who may not plan sees every flag, and is told why none of them presses.
            <span
              className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400"
              data-requirements-readonly="true"
            >
              <BoardIcon d={PATH.lock} className="h-3.5 w-3.5" />
              {t('operations.crew.requirements.readOnly')}
            </span>
          )}
        </div>

        {directory.data?.rosterIsDerived === false && (
          // Otherwise a frozen fallback list looks exactly like a correctly configured one, and
          // nobody would learn why a new hire never appears. The cause is fixed on «إدارات
          // العمليات», so the notice ends where that is done.
          <p
            role="note"
            className="flex items-start gap-2 rounded-xl border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
            data-requirements-unconfigured="true"
          >
            <BoardIcon
              d={PATH.warn}
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            />
            <span>
              {t('operations.crew.requirements.unconfigured')} <ChooseCrewDepartments />
            </span>
          </p>
        )}

        {/* The boards' dark bar, in the columns' order: «الاسم أو الكود» over the person, then
          «الوظيفة», then «يحمل» — the flags a member must hold (every one chosen, as the crew
          board's pool buttons narrow). */}
        <div
          className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in', BAR_LAYOUT)}
          data-requirements-filters="true"
        >
          <FilterBar
            hasActiveFilters={filtered}
            onClear={() => {
              // ONE write — a second built from the params the first replaced would undo it.
              const next = new URLSearchParams(sp);
              for (const name of REMEMBERED_FILTERS) next.delete(name);
              setSp(next, { replace: true });
            }}
          >
            <FilterWithIcon
              icon={FILTER_ICON.person}
              tone="text-emerald-600 dark:text-emerald-400"
              className="w-52 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.crew.requirements.search')}
                placeholder={t('operations.crew.requirements.search')}
                value={filters.search}
                onChange={(e) => patch({ q: e.target.value })}
                data-requirements-search="true"
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.operation} tone="text-violet-600 dark:text-violet-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('operations.crew.requirements.jobTitle')}
                // «رئيس قسم تشغيل نقل الاموال» is longer than the box: the list reads it whole.
                panelWidth="w-72 max-w-[90vw]"
                options={[
                  ...choices.titles.map((title) => ({ value: title.id, label: title.label })),
                  ...(choices.anyWithout
                    ? [{ value: NO_JOB_TITLE, label: t('operations.crew.requirements.noJobTitle') }]
                    : []),
                ]}
                value={filters.jobs}
                onChange={(next) => patch({ job: writeList(next) })}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.status} tone="text-emerald-600 dark:text-emerald-400">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('operations.crew.requirements.holds')}
                options={REQUIREMENT_FLAGS.map((flag) => ({ value: flag, label: flagLabel(flag) }))}
                value={filters.flags}
                onChange={(next) => patch({ flags: writeList(next) })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        <div className={ROSTER_TABLE} data-requirements-table="true">
          <DataTable
            columns={columns}
            rows={shown.rows}
            rowKey={(row) => row.employeeId}
            loading={directory.isLoading}
            error={directory.error}
            onRetry={() => void directory.refetch()}
            empty={
              members.length > 0 && filtered
                ? t('operations.crew.requirements.noMatch')
                : t('operations.crew.requirements.empty')
            }
            // A row not saved is red; a row with ticks waiting is amber, as legacy lit the row
            // being worked on. Each also says so in a cell (the ringed toggles, the ⚠ by the name).
            rowClassName={(row) =>
              failures.has(row.employeeId)
                ? '!bg-red-50 dark:!bg-red-500/10'
                : waitingIds.has(row.employeeId)
                  ? '!bg-amber-50 dark:!bg-amber-500/10'
                  : undefined
            }
            stickyHead
            minColumnWidth={4}
          />
        </div>
        {shown.meta.totalItems > PAGER_FROM && (
          // The boards' pager, one slim line under the table, once the roster runs past the
          // smallest page — so a reader who chose a bigger page can still come back to it.
          <div className="shrink-0 [&>div]:!py-0" data-requirements-pager="true">
            <FleetPager
              meta={shown.meta}
              pageSizeOptions={HISTORY_PAGE_SIZES}
              onPageChange={(next) => setPaging({ view, page: next, size: paging.size })}
              onPageSizeChange={(size) => setPaging({ view, page: 1, size })}
            />
          </div>
        )}
      </div>

      {/* «لديك تغييرات غير محفوظة» — a link in the menu, «إدارات العمليات», a reload. */}
      <DesignDialog
        open={guard.leaveOpen}
        onClose={guard.cancel}
        title={t('operations.crew.requirements.leaveTitle')}
        icon={PATH.warn}
        width="lg"
        panelProps={{ 'data-requirements-leave': 'true' }}
        footer={
          <>
            <DesignSave
              onClick={guard.confirm}
              label={t('operations.crew.requirements.leaveConfirm')}
              data-requirements-leave-confirm="true"
            />
            <DesignCancel
              onClick={guard.cancel}
              label={t('operations.crew.requirements.leaveStay')}
            />
          </>
        }
      >
        <p className="text-[15px] font-semibold leading-7 text-slate-700 dark:text-slate-200">
          {t(pluralKey('operations.crew.requirements.leaveBody', locale, waitingCells), {
            count: formatNumber(waitingCells, locale),
          })}
        </p>
      </DesignDialog>
    </PageContainer>
  );
};
