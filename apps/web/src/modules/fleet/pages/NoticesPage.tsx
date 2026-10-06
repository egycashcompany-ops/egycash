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
import { Link, useNavigate } from 'react-router-dom';
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
} from '../../../shared/ui/icons';
import {
  useDeleteNotice,
  useNotices,
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
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useNotices({
    page,
    pageSize,
  });
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
      key: 'noticeImage',
      header: t('fleet.notices.columns.noticeImage'),
      align: 'center',
      render: (row) => <NoticeImageCell row={row} kind="notice" onPreview={setImage} />,
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
  const print = (): void => {
    if (template === undefined) return;
    try {
      printNoticePages(pages.current, `${template.insurer} — ${template.title}`, false);
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
        </div>
      )}
    </Dialog>
  );
};
