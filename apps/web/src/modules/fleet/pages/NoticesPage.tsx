// الإخطارات — two doors and the notices themselves.
//
// «عاوز يبقى زرارين: الاول ادوس عليه اختار النموذج واحط قيم افتراضيه … التانى ادوس عليه يجبلى
// اختار نموذج ايه عشان املى واطبع منه … وعاوز جدول بالحاجات دى فى نفس الشاشه». The set-up opens a
// form's defaults; «إخطار جديد» asks which form to fill; the table lists every saved notice by its
// car, number and date, with its two scans and its actions laid out as the vehicles screen's
// («الصور والاجراءات تكون نفس شاشه السيارات»).
//
// «✓» closes a notice, and only with the insurer's cheque in: «مقدرش اعمل صح لو مفيش صوره شيك … لو
// علامه صح يجيب تلقائى ان اختار صورة الشيك لو مدخلتش صوره الشيك يظهر عفوا يرجى رفع صورة الشيك».
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { type FleetNoticeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Pagination } from '../../../shared/ui/Pagination';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { formatNumber } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import {
  CheckIcon,
  CogIcon,
  EditIcon,
  EyeIcon,
  PlusIcon,
  PrinterIcon,
  TrashIcon,
  UploadIcon,
} from '../../../shared/ui/icons';
import {
  useDeleteNotice,
  useNotices,
  useNoticesSummary,
  useSetNoticeDone,
  useUploadNoticeImage,
} from '../api/fleet-queries';
import { NOTICE_TEMPLATES, noticeTemplate } from '../lib/notice-templates';
import { printNoticePages } from '../lib/notice-render';
import { NoticeSheet } from '../components/NoticeSheet';
import {
  NOTICE_ACTION_BUTTON,
  NoticeImageCell,
  NoticeImagePreviewDialog,
  type NoticeImageTarget,
} from '../components/NoticeImageCell';
import { LICENSE_IMAGE_ACCEPT } from '../components/VehicleLicenseImage';
import { fetchNoticeImage } from '../api/fleet-api';
import { PhotoPickButton } from '../../../shared/ui/PhotoPick';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Input } from '../../../shared/ui/form';
import { readList, writeList } from '../../../shared/lib/list-param';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { BreakdownCard, FigureChip } from '../components/FleetFigures';
import { PATH } from '../components/FuelCardBoard';
import { monthCountOptions } from '../lib/licence-months';

/**
 * «فلاتر واحصائيات تكون زى شاشه السيارات»: the vehicles screen's bar and figures, over notices.
 * Remembered across visits like every Fleet list's.
 */
const REMEMBERED_FILTERS = [
  'vehicleCodes',
  'number',
  'from',
  'to',
  'templates',
  'status',
  'checkImage',
] as const;

/** The vehicles table's look — «نفس شاشه السيارات». */
const NOTICE_TABLE = cn(
  '[&>div]:!rounded-2xl [&>div]:!border-slate-200 dark:[&>div]:!border-slate-800 [&>div]:!bg-white dark:[&>div]:!bg-[#111827]',
  '[&_thead_tr]:!bg-slate-100 dark:[&_thead_tr]:!bg-[#0c121e] [&_thead_th]:!text-slate-500 dark:[&_thead_th]:!text-slate-400',
  '[&_tbody_tr]:!border-slate-200 dark:[&_tbody_tr]:!border-slate-800 [&_tbody_td]:!text-slate-800 dark:[&_tbody_td]:!text-slate-200',
  '[&_th]:!text-[13px] [&_th]:!font-bold [&_td]:!py-2.5 [&_td]:whitespace-nowrap [&_td]:!text-sm [&_td]:!font-semibold',
  '[&_td_button]:!h-7 [&_td_button]:!w-7 [&_td_.gap-1]:!gap-0.5',
);

const NUMBER_FONT =
  "[font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Cairo',monospace]";

/** `2026-10-05…` → `2026/10/05`, the way every Fleet table writes a day. */
const day = (iso: string | null): string =>
  iso === null ? '—' : iso.slice(0, 10).replace(/-/gu, '/');

const PAGE_SIZE = 25;

export const NoticesPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const vehicleCodes = readList(sp, 'vehicleCodes');
  const number = sp.get('number') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const templates = readList(sp, 'templates');
  const status = sp.get('status') ?? '';
  const checkImage = sp.get('checkImage') ?? '';
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };
  const filters = {
    vehicleCodes: vehicleCodes.length === 0 ? undefined : vehicleCodes.join(','),
    noticeNumber: number.trim() === '' ? undefined : number.trim(),
    from: from === '' ? undefined : from,
    to: to === '' ? undefined : to,
    templates: templates.length === 0 ? undefined : templates.join(','),
    status: status === '' ? undefined : status,
    checkImage: checkImage === '' ? undefined : checkImage,
  };
  const filterKey = JSON.stringify(filters);
  // A narrower list starts again on its first page.
  useEffect(() => setPage(1), [filterKey]);
  const hasFilters = Object.values(filters).some((value) => value !== undefined);
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useNotices({
    page,
    pageSize,
    ...filters,
  });
  const summary = useNoticesSummary(filters);
  const [statsOpen, setStatsOpen] = useState(false);
  const templateOptions = NOTICE_TEMPLATES.map((form) => ({
    value: form.key,
    label: form.insurer,
  }));
  const one = (value: string): string[] => (value === '' ? [] : [value]);
  const stateOptions = [
    { value: 'has', label: t('fleet.notices.imageHas') },
    { value: 'missing', label: t('fleet.notices.imageMissing') },
  ];
  const rows = data?.items ?? [];

  const [choosing, setChoosing] = useState(false);
  const [sheet, setSheet] = useState<{ row: FleetNoticeDto; print: boolean } | null>(null);
  const [image, setImage] = useState<NoticeImageTarget | null>(null);
  const [deleting, setDeleting] = useState<FleetNoticeDto | null>(null);
  const [reopening, setReopening] = useState<FleetNoticeDto | null>(null);

  const remove = useDeleteNotice();
  const setDone = useSetNoticeDone();
  const upload = useUploadNoticeImage();
  const mayEdit = can('fleetNotice.edit');

  // ── «✓» and the cheque ────────────────────────────────────────────────────────────────────
  // A notice with no cheque asks for one the moment «✓» is pressed: the file dialog opens, and
  // closing it with nothing chosen says why the notice did not close.
  const chequeInput = useRef<HTMLInputElement>(null);
  const closing = useRef<FleetNoticeDto | null>(null);
  const refusal = t('fleet.notices.checkRequired');
  useEffect(() => {
    const input = chequeInput.current;
    if (input === null) return undefined;
    const cancelled = (): void => {
      if (closing.current === null) return;
      closing.current = null;
      toast.error(refusal);
    };
    input.addEventListener('cancel', cancelled);
    return () => input.removeEventListener('cancel', cancelled);
  }, [refusal]);

  const close = async (row: FleetNoticeDto): Promise<void> => {
    try {
      await setDone.mutateAsync({ id: row.id, body: { done: true, version: row.version } });
      toast.success(t('fleet.notices.closedToast'));
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };

  const tick = (row: FleetNoticeDto): void => {
    if (row.completedAt !== null) {
      setReopening(row);
      return;
    }
    if (row.checkImage !== null) {
      void close(row);
      return;
    }
    closing.current = row;
    chequeInput.current?.click();
  };

  const chequePicked = async (file: File | undefined): Promise<void> => {
    const row = closing.current;
    closing.current = null;
    if (row === null) return;
    if (file === undefined) {
      toast.error(refusal);
      return;
    }
    try {
      const withCheque = await upload.mutateAsync({ id: row.id, kind: 'check', file });
      await close(withCheque);
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };

  const reopen = async (): Promise<void> => {
    if (reopening === null) return;
    try {
      await setDone.mutateAsync({
        id: reopening.id,
        body: { done: false, version: reopening.version },
      });
      toast.success(t('fleet.notices.reopenedToast'));
      setReopening(null);
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t('fleet.notices.deletedToast'));
      setDeleting(null);
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };

  const edit = (row: FleetNoticeDto): void =>
    navigate(`/fleet/notices/${row.template}?id=${row.id}`);

  const columns: Column<FleetNoticeDto>[] = [
    {
      key: 'code',
      header: t('fleet.notices.columns.code'),
      render: (row) => (
        <span className={cn('font-bold', NUMBER_FONT)} dir="ltr">
          {row.vehicleCode ?? '—'}
        </span>
      ),
    },
    {
      key: 'number',
      header: t('fleet.notices.columns.number'),
      render: (row) => (
        <span className={NUMBER_FONT} dir="ltr">
          {row.noticeNumber ?? '—'}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('fleet.notices.columns.date'),
      render: (row) => (
        <span className={NUMBER_FONT} dir="ltr">
          {day(row.noticeDate)}
        </span>
      ),
    },
    {
      key: 'template',
      header: t('fleet.notices.columns.template'),
      render: (row) => noticeTemplate(row.template)?.insurer ?? row.template,
    },
    {
      key: 'checkImage',
      header: t('fleet.notices.columns.checkImage'),
      align: 'center',
      render: (row) => <NoticeImageCell row={row} kind="check" onPreview={setImage} />,
    },
    {
      key: 'actions',
      header: t('fleet.notices.columns.actions'),
      align: 'end',
      render: (row) => {
        const done = row.completedAt !== null;
        return (
          <span className="flex items-center justify-end gap-1">
            <button
              type="button"
              className={NOTICE_ACTION_BUTTON}
              aria-label={t('fleet.notices.view')}
              title={t('fleet.notices.view')}
              onClick={() => setSheet({ row, print: false })}
            >
              <EyeIcon className="h-4 w-4" />
            </button>
            <NoticeLicencesButton row={row} onPreview={setImage} />
            <button
              type="button"
              data-notice-row-print={row.id}
              className={NOTICE_ACTION_BUTTON}
              aria-label={t('fleet.notices.print')}
              title={t('fleet.notices.print')}
              onClick={() => setSheet({ row, print: true })}
            >
              <PrinterIcon className="h-4 w-4" />
            </button>
            {mayEdit && (
              <button
                type="button"
                data-notice-edit={row.id}
                className={NOTICE_ACTION_BUTTON}
                aria-label={t('fleet.notices.edit')}
                title={t('fleet.notices.edit')}
                onClick={() => edit(row)}
              >
                <EditIcon className="h-4 w-4" />
              </button>
            )}
            {can('fleetNotice.delete') && (
              <button
                type="button"
                data-notice-delete={row.id}
                className={NOTICE_ACTION_BUTTON}
                aria-label={t('fleet.notices.delete')}
                title={t('fleet.notices.delete')}
                onClick={() => setDeleting(row)}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
            {mayEdit && (
              <button
                type="button"
                data-notice-done={row.id}
                aria-pressed={done}
                disabled={setDone.isPending || upload.isPending}
                aria-label={done ? t('fleet.notices.completed') : t('fleet.notices.close')}
                title={done ? t('fleet.notices.completed') : t('fleet.notices.close')}
                onClick={() => tick(row)}
                className={cn(
                  'inline-flex items-center justify-center rounded-md border transition disabled:opacity-50',
                  done
                    ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
                    : 'border-emerald-600/50 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400',
                )}
              >
                <CheckIcon className="h-4 w-4" />
              </button>
            )}
          </span>
        );
      },
    },
  ];

  // «التاريخ فى الفلاتر خليه من الى»: two days, each named inside its own box until it is filled —
  // the maintenance screen's date boxes.
  const dateBound = (labelKey: string, value: string, param: string): JSX.Element => (
    <FilterWithIcon icon={FILTER_ICON.calendar} tone="text-cyan-600 dark:text-cyan-400">
      <Input
        type="date"
        dir="ltr"
        aria-label={t(labelKey)}
        title={t(labelKey)}
        value={value}
        onChange={(e) => patch({ [param]: e.target.value || null })}
        className={
          value === '' ? 'peer [&:not(:focus)::-webkit-datetime-edit]:opacity-0' : undefined
        }
      />
      {value === '' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-8 right-7 flex items-center justify-start truncate text-sm text-slate-400 peer-focus:hidden dark:text-slate-500"
        >
          {t(labelKey)}
        </span>
      )}
    </FilterWithIcon>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.notices')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.notices') },
        ]}
      />
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2" data-notices-toolbar="true">
          <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
            {data === undefined
              ? ''
              : t('fleet.notices.count', { count: formatNumber(data.meta.totalItems, locale) })}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              data-notice-stats-toggle="true"
              aria-expanded={statsOpen}
              onClick={() => setStatsOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/50 bg-brand-500/15 px-3 py-2 text-xs font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200"
            >
              {statsOpen
                ? t('fleet.vehicles.board.breakdownHide')
                : t('fleet.vehicles.board.breakdown')}
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className={cn('h-3.5 w-3.5 transition-transform', statsOpen && 'rotate-180')}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <Link
              to={`/fleet/notices/setup/${NOTICE_TEMPLATES[0]?.key ?? 'misrInsurance'}`}
              data-notice-setup="true"
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/50 bg-brand-500/15 px-3 py-2 text-xs font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200"
            >
              <CogIcon className="h-3.5 w-3.5" />
              {t('fleet.notices.setup')}
            </Link>
            {can('fleetNotice.create') && (
              <button
                type="button"
                data-notice-new="true"
                onClick={() => setChoosing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-3.5 py-2 text-xs font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 active:scale-95"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                {t('fleet.notices.newNotice')}
              </button>
            )}
          </span>
        </div>

        {statsOpen && summary.data !== undefined && (
          <section data-notice-figures="true" className="animate-drop-in space-y-2">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <FigureChip
                icon={PATH.card}
                iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                label={t('fleet.notices.stats.total')}
                value={summary.data.total}
                unit={t('fleet.notices.stats.unit')}
              />
              <FigureChip
                icon={FILTER_ICON.status}
                iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                label={t('fleet.notices.stats.done')}
                value={summary.data.done}
                valueClass="text-emerald-600 dark:text-emerald-400"
                unit={t('fleet.notices.stats.unit')}
              />
              <FigureChip
                icon={PATH.calendar}
                iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                label={t('fleet.notices.stats.open')}
                value={summary.data.open}
                valueClass="text-amber-600 dark:text-amber-400"
                unit={t('fleet.notices.stats.unit')}
              />
              <FigureChip
                icon={PATH.warn}
                iconClass={
                  summary.data.missingCheckImage > 0
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                }
                label={t('fleet.notices.stats.missingCheck')}
                value={summary.data.missingCheckImage}
                valueClass={
                  summary.data.missingCheckImage > 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }
                unit={t('fleet.notices.stats.unit')}
                note={t('fleet.notices.stats.missingLicences', {
                  count: String(summary.data.missingLicences),
                })}
              />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <BreakdownCard
                title={t('fleet.notices.stats.byTemplate')}
                rows={summary.data.byTemplate.map((row) => ({
                  id: row.template,
                  name: noticeTemplate(row.template)?.insurer ?? row.template,
                  count: row.count,
                }))}
                total={summary.data.total}
              />
              <BreakdownCard
                title={t('fleet.notices.stats.byMonth')}
                rows={[
                  ...monthCountOptions(summary.data.months, locale).map((option, index) => ({
                    id: option.value,
                    name: option.label.replace(/ \([^)]*\)$/u, ''),
                    count: summary.data.months[index]?.count ?? 0,
                  })),
                  ...(summary.data.total -
                    summary.data.months.reduce((sum, m) => sum + m.count, 0) >
                  0
                    ? [
                        {
                          id: '',
                          name: t('fleet.notices.stats.noDate'),
                          count:
                            summary.data.total -
                            summary.data.months.reduce((sum, m) => sum + m.count, 0),
                        },
                      ]
                    : []),
                ]}
                total={summary.data.total}
              />
            </div>
          </section>
        )}

        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
            hasActiveFilters={hasFilters}
            onClear={() =>
              patch({
                vehicleCodes: null,
                number: null,
                from: null,
                to: null,
                templates: null,
                status: null,
                checkImage: null,
              })
            }
          >
            <FilterWithIcon icon={FILTER_ICON.car} tone="text-emerald-600 dark:text-emerald-400">
              <VehicleCodeFilter
                fullWidth
                density="tight"
                placeholder={t('fleet.notices.filters.code')}
                value={vehicleCodes}
                onChange={(next) => patch({ vehicleCodes: writeList(next) })}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.chassis} tone="text-slate-500 dark:text-slate-400">
              <Input
                aria-label={t('fleet.notices.filters.number')}
                placeholder={t('fleet.notices.filters.number')}
                value={number}
                onChange={(event) => patch({ number: event.target.value || null })}
              />
            </FilterWithIcon>
            {dateBound('fleet.notices.filters.from', from, 'from')}
            {dateBound('fleet.notices.filters.to', to, 'to')}
            <FilterWithIcon
              icon={FILTER_ICON.insurance}
              tone="text-violet-600 dark:text-violet-300"
            >
              <MultiSelect
                clearable
                fullWidth
                density="tight"
                showSelectedValues
                label={t('fleet.notices.filters.template')}
                options={templateOptions}
                value={templates}
                onChange={(next) => patch({ templates: writeList(next) })}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.status} tone="text-emerald-600 dark:text-emerald-400">
              <MultiSelect
                clearable
                fullWidth
                density="tight"
                showSelectedValues
                label={t('fleet.notices.filters.status')}
                options={[
                  { value: 'open', label: t('fleet.notices.statusOpen') },
                  { value: 'done', label: t('fleet.notices.statusDone') },
                ]}
                value={one(status)}
                onChange={(next) => patch({ status: pickOne(one(status), next) })}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.card} tone="text-amber-600 dark:text-amber-400">
              <MultiSelect
                clearable
                fullWidth
                density="tight"
                showSelectedValues
                label={t('fleet.notices.filters.checkImage')}
                options={stateOptions}
                value={one(checkImage)}
                onChange={(next) => patch({ checkImage: pickOne(one(checkImage), next) })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        <div key={dataUpdatedAt} className={cn('animate-fade-in', NOTICE_TABLE)}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            empty={<EmptyState title={t('fleet.notices.empty')} />}
            rowClassName={(row) =>
              row.completedAt !== null ? '!bg-emerald-500/10 dark:!bg-emerald-500/10' : undefined
            }
            rowProps={(row) => ({ 'data-notice-row': row.id }) as never}
            minColumnWidth={6}
          />
        </div>
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>

      <input
        ref={chequeInput}
        type="file"
        accept={LICENSE_IMAGE_ACCEPT}
        className="hidden"
        data-notice-cheque-input="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void chequePicked(file);
        }}
      />

      <Dialog
        open={choosing}
        onClose={() => setChoosing(false)}
        title={t('fleet.notices.newNotice')}
        description={t('fleet.notices.chooseNew')}
        size="lg"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {NOTICE_TEMPLATES.map((template) => (
            <Link
              key={template.key}
              to={`/fleet/notices/${template.key}`}
              data-notice-template={template.key}
              className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm transition hover:border-brand-400 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900"
            >
              <img
                src={template.pages[0]}
                alt=""
                className="w-full rounded-md border border-slate-200 dark:border-slate-700"
              />
              <span className="mt-3 block text-base font-bold text-slate-800 dark:text-slate-100">
                {template.insurer}
              </span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                {template.title} ·{' '}
                {t('fleet.notices.pageCount', { count: String(template.pages.length) })}
              </span>
            </Link>
          ))}
        </div>
      </Dialog>

      <NoticeSheetDialog target={sheet} onClose={() => setSheet(null)} />
      <NoticeImagePreviewDialog target={image} onClose={() => setImage(null)} />

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.notices.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.notices.deleteBody')}
        </p>
      </Dialog>

      <Dialog
        open={reopening !== null}
        onClose={() => setReopening(null)}
        title={t('fleet.notices.reopenTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReopening(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={setDone.isPending} onClick={() => void reopen()}>
              {t('fleet.notices.reopen')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.notices.reopenBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};

/** One saved notice on its insurer's form — to look at, or to print from. */
/** A blob as a `data:` URL — what survives being copied into the print tab. */
const dataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * The licences that go with a notice — «صوره الرخصه بتاعت العربيه وصوره الرخصه بتاعت السائق» —
 * fetched for the dialog and the print, each the registry's own or the one uploaded with it.
 */
const useLicencePhotos = (
  row: FleetNoticeDto | null,
): { kind: 'vehicleLicense' | 'driverLicense'; src: string }[] => {
  const [photos, setPhotos] = useState<{ kind: 'vehicleLicense' | 'driverLicense'; src: string }[]>(
    [],
  );
  const key =
    row === null ? '' : `${row.id}:${row.vehicleLicense}:${row.driverLicense}:${row.updatedAt}`;
  useEffect(() => {
    setPhotos([]);
    if (row === null) return undefined;
    let cancelled = false;
    const kinds = (['vehicleLicense', 'driverLicense'] as const).filter((kind) =>
      kind === 'vehicleLicense' ? row.vehicleLicense !== null : row.driverLicense !== null,
    );
    void Promise.all(
      kinds.map((kind) =>
        fetchNoticeImage(row.id, kind)
          .then(dataUrl)
          .then((src) => ({ kind, src }))
          .catch(() => null),
      ),
    ).then((found) => {
      if (!cancelled) setPhotos(found.filter((photo) => photo !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return photos;
};

const NoticeSheetDialog = ({
  target,
  onClose,
}: {
  target: { row: FleetNoticeDto; print: boolean } | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const pages = useRef<HTMLElement[]>([]) as MutableRefObject<HTMLElement[]>;
  const template = target === null ? undefined : noticeTemplate(target.row.template);
  const photos = useLicencePhotos(target?.row ?? null);
  const print = (): void => {
    if (template === undefined) return;
    try {
      printNoticePages(
        pages.current,
        `${template.insurer} — ${template.title}`,
        false,
        photos.map((photo) => ({
          src: photo.src,
          caption: t(`fleet.notices.image.${photo.kind}.title`),
        })),
      );
    } catch {
      toast.error(t('fleet.notices.popupBlocked'));
    }
  };
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      size="xl"
      title={template === undefined ? '' : `${template.insurer} — ${template.title}`}
      description={
        target === null
          ? ''
          : t('fleet.notices.image.subtitle', {
              code: target.row.vehicleCode ?? '—',
              number: target.row.noticeNumber ?? '—',
              date: day(target.row.noticeDate),
              insurer: template?.insurer ?? '',
            })
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={print} data-notice-sheet-print="true" autoFocus={target?.print === true}>
            {t('fleet.notices.print')}
          </Button>
        </>
      }
    >
      {target !== null && template !== undefined && (
        <div className="max-h-[70vh] overflow-auto rounded-lg bg-slate-200 p-3 dark:bg-slate-800">
          <NoticeSheet
            template={template}
            answers={{ values: target.row.values, checks: target.row.checks }}
            pagesRef={pages}
          />
          {photos.map((photo) => (
            <figure
              key={photo.kind}
              data-notice-sheet-licence={photo.kind}
              className="mx-auto mt-3 max-w-[640px] rounded-lg bg-white p-3 text-center shadow"
            >
              <figcaption className="mb-2 text-sm font-bold text-slate-700">
                {t(`fleet.notices.image.${photo.kind}.title`)}
              </figcaption>
              <img src={photo.src} alt="" className="mx-auto max-h-[70vh] object-contain" />
            </figure>
          ))}
        </div>
      )}
    </Dialog>
  );
};

/**
 * «صوره الرخصه بتاعت العربيه وصوره الرخصه بتاعت السائق … لو مش موجوده اسمح انه يرفعهم»: the
 * arrow beside the eye opens the two licences that print with the form — each the registry's own
 * when it has one, else one uploaded here with the notice. Amber while either is missing.
 */
const NoticeLicencesButton = ({
  row,
  onPreview,
}: {
  row: FleetNoticeDto;
  onPreview: (target: NoticeImageTarget) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const upload = useUploadNoticeImage();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const missing = row.vehicleLicense === null || row.driverLicense === null;
  useEffect(() => {
    if (at === null) return undefined;
    const close = (): void => setAt(null);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [at]);
  const open = (): void => {
    const box = button.current?.getBoundingClientRect();
    if (box === undefined) return;
    const width = 300;
    // Under the arrow, held inside the screen at either edge.
    const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
    setAt({ top: box.bottom + 6, left });
  };
  const pick = async (kind: 'vehicleLicense' | 'driverLicense', file: File): Promise<void> => {
    try {
      await upload.mutateAsync({ id: row.id, kind, file });
      toast.success(t('fleet.notices.image.uploaded'));
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  const line = (kind: 'vehicleLicense' | 'driverLicense'): JSX.Element => {
    const source = kind === 'vehicleLicense' ? row.vehicleLicense : row.driverLicense;
    return (
      <div
        key={kind}
        data-notice-licence={kind}
        className={cn(
          'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm',
          source === null
            ? 'border-amber-500/60 bg-amber-500/10'
            : 'border-slate-200 dark:border-slate-700',
        )}
      >
        <span className="min-w-0">
          <span className="block font-bold text-slate-800 dark:text-slate-100">
            {t(`fleet.notices.image.${kind}.title`)}
          </span>
          <span
            className={cn(
              'block text-[11px]',
              source === null ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500',
            )}
          >
            {t(
              source === 'registry'
                ? 'fleet.notices.licences.fromRegistry'
                : source === 'notice'
                  ? 'fleet.notices.licences.fromNotice'
                  : 'fleet.notices.licences.missing',
            )}
          </span>
        </span>
        {source === null ? (
          <PhotoPickButton
            accept={LICENSE_IMAGE_ACCEPT}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/60 px-2 py-1 text-xs font-bold text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
            disabled={upload.isPending}
            label={t(`fleet.notices.image.${kind}.upload`)}
            data-notice-image-upload={`${kind}:${row.id}`}
            onFile={(file) => void pick(kind, file)}
          >
            <UploadIcon className="h-3.5 w-3.5" />
            {t('fleet.notices.licences.upload')}
          </PhotoPickButton>
        ) : (
          <button
            type="button"
            className={NOTICE_ACTION_BUTTON}
            aria-label={t(`fleet.notices.image.${kind}.view`)}
            title={t(`fleet.notices.image.${kind}.view`)}
            onClick={() => {
              setAt(null);
              onPreview({ row, kind });
            }}
          >
            <EyeIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        data-notice-licences={row.id}
        aria-expanded={at !== null}
        aria-label={t('fleet.notices.licences.title')}
        title={t('fleet.notices.licences.title')}
        onClick={() => (at === null ? open() : setAt(null))}
        className={cn(
          NOTICE_ACTION_BUTTON,
          missing && '!text-amber-500 ring-1 ring-amber-500/60 dark:!text-amber-400',
        )}
      >
        <UploadIcon className="h-4 w-4" />
      </button>
      {at !== null &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[80]" aria-hidden="true" onClick={() => setAt(null)} />
            <div
              role="dialog"
              aria-label={t('fleet.notices.licences.title')}
              style={{ top: at.top, left: at.left, width: 300 }}
              className="fixed z-[81] animate-menu-in space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-[#111827]"
            >
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {t('fleet.notices.licences.title')}
              </p>
              {line('vehicleLicense')}
              {line('driverLicense')}
            </div>
          </>,
          document.body,
        )}
    </>
  );
};
