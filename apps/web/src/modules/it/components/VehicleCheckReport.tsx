// One vehicle check report, opened from the dashboard («عرض التقرير») — the sample's side panel: the
// car, its branch and day, who sent it and when, the three counts, the eleven devices each with its
// answer, the note, and the photos as the reporter took them.
//
// THE PHOTOS ARE REAL IMAGES. Each is read through `GET /it/vehicle-checks/:id/photos/:fileId` with
// the reader's token (an `<img src>` would send none) and shown from an object URL, which is let go
// when the panel closes or moves to another report. A tap opens the photo large.
//
// «حذف التقرير» is for a holder of `itVehicleCheck.delete`, behind the app's confirm: a wrong report
// is soft-deleted, leaves the board and the list, and the car's latest falls back to the one before.
// «كل تقارير هذه السيارة» narrows the reports list to this car, by its id, on every day, «بها عطل»
// and the device cleared (`lib/vehicle-check-dashboard.ts` says why not by its code alone, and why
// not under the period).
import { useEffect, useState } from 'react';
import { IT_VEHICLE_CHECK_ITEMS, type ItVehicleCheckDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { SideLayer } from '../../../shared/ui/SideLayer';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { ImageIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatBusinessDateTime, formatNumber } from '../../../shared/lib/format';
import * as api from '../api/it-api';
import {
  useDeleteItVehicleCheck,
  useForgetItVehicleCheck,
  useItVehicleCheck,
} from '../api/it-queries';
import {
  answerCounts,
  deviceLabel,
  deviceState,
  forgetsDeletedReport,
  formatYmd,
  loadVehicleCheckPhotos,
  stateWord,
  type DeviceState,
} from '../lib/vehicle-check-dashboard';

/** A device's answer as a chip — the matrix's colours: emerald «يعمل», red «لا يعمل», slate. */
export const STATE_CHIP: Record<DeviceState, string> = {
  works: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  notWorking: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  unanswered: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

/**
 * The open report's photos, by file id: a URL once fetched, `null` for one that failed, absent
 * while on its way. `photoKey` is the file ids joined — one string, so a refetch of the same
 * report does not fetch its photos again.
 */
const useReportPhotos = (
  reportId: string | null,
  photoKey: string,
): ReadonlyMap<string, string | null> => {
  const [photos, setPhotos] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    setPhotos(new Map());
    if (reportId === null || photoKey === '') return;
    let cancelled = false;
    const made: string[] = [];
    void loadVehicleCheckPhotos(reportId, photoKey.split(','), {
      fetchPhoto: api.fetchVehicleCheckPhoto,
      toUrl: (blob) => {
        const url = URL.createObjectURL(blob);
        // Landed after the panel closed: nothing will show it, so it goes at once.
        if (cancelled) URL.revokeObjectURL(url);
        else made.push(url);
        return url;
      },
      onEach: (photo) => setPhotos((prev) => new Map(prev).set(photo.fileId, photo.url)),
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [reportId, photoKey]);
  return photos;
};

const ReportBody = ({
  report,
  photos,
  branchName,
  onZoom,
}: {
  report: ItVehicleCheckDto;
  photos: ReadonlyMap<string, string | null>;
  branchName: (id: string | null) => string;
  onZoom: (fileId: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const counts = answerCounts(report.items);
  return (
    <div className="space-y-5" data-report-view={report.id}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">{t('it.assets.columns.branch')}</dt>
          <dd className="mt-0.5 font-medium text-slate-900 dark:text-white">
            {branchName(report.branchId)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">
            {t('it.vehicleChecks.columns.day')}
          </dt>
          <dd className="mt-0.5 font-medium text-slate-900 dark:text-white">
            {formatYmd(report.checkDate, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">
            {t('it.vehicleChecks.columns.reporter')}
          </dt>
          <dd className="mt-0.5 font-medium text-slate-900 dark:text-white">
            {report.reportedByName}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">
            {t('it.vehicleChecks.columns.sentAt')}
          </dt>
          <dd className="mt-0.5 font-medium tabular-nums text-slate-900 dark:text-white">
            {formatBusinessDateTime(report.createdAt, locale)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2" data-report-counts="">
        <Badge tone="success">
          {t('it.vehicleCheck.sent.works', { count: formatNumber(counts.works, locale) })}
        </Badge>
        <Badge tone="danger">
          {t('it.vehicleCheck.sent.notWorking', {
            count: formatNumber(counts.notWorking, locale),
          })}
        </Badge>
        <Badge tone="neutral">
          {t('it.vehicleCheck.sent.unanswered', {
            count: formatNumber(counts.unanswered, locale),
          })}
        </Badge>
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {IT_VEHICLE_CHECK_ITEMS.map((item) => {
          const state = deviceState(report.items[item]);
          return (
            <li
              key={item}
              data-report-device={item}
              className={cn(
                'flex items-center justify-between gap-3 px-3.5 py-2.5',
                state === 'notWorking' && 'bg-red-50/60 dark:bg-red-950/30',
              )}
            >
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {deviceLabel(t, locale, item)}
              </span>
              <span
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-semibold',
                  STATE_CHIP[state],
                )}
              >
                {stateWord(t, state)}
              </span>
            </li>
          );
        })}
      </ul>

      <section className="space-y-1.5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          {t('it.vehicleCheck.notes')}
        </h3>
        <p className="whitespace-pre-line break-words rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          {report.notes ?? t('it.vehicleChecks.report.noNotes')}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          {t('it.vehicleCheck.photos')}
        </h3>
        {report.photos.length === 0 ? (
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {t('it.vehicleChecks.report.noPhotos')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {report.photos.map((photo, index) => {
                const url = photos.get(photo.fileId);
                const label = t('it.vehicleCheck.photos.number', {
                  n: formatNumber(index + 1, locale),
                });
                return (
                  <button
                    key={photo.fileId}
                    type="button"
                    data-report-photo={photo.fileId}
                    aria-label={label}
                    title={label}
                    disabled={url === undefined || url === null}
                    onClick={() => onZoom(photo.fileId)}
                    className="relative aspect-[4/3] overflow-hidden rounded-lg bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 enabled:cursor-zoom-in dark:bg-slate-800"
                  >
                    {url === undefined ? (
                      <Skeleton className="h-full w-full" />
                    ) : url === null ? (
                      <span className="flex h-full flex-col items-center justify-center gap-1 p-1 text-center text-[11px] text-slate-500 dark:text-slate-400">
                        <ImageIcon className="h-5 w-5" aria-hidden="true" />
                        {t('it.vehicleChecks.report.photoFailed')}
                      </span>
                    ) : (
                      <img src={url} alt={label} className="h-full w-full object-cover" />
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('it.vehicleChecks.report.photoHint')}
            </p>
          </>
        )}
      </section>
    </div>
  );
};

export const VehicleCheckReport = ({
  reportId,
  onClose,
  onCarReports,
  branchName,
}: {
  /** The report to show; `null` keeps the panel closed. */
  reportId: string | null;
  onClose: () => void;
  /** «كل تقارير هذه السيارة» — the page narrows its list to this car. */
  onCarReports: (car: { vehicleId: string; vehicleCode: string }) => void;
  /** The branch's name, or «—» for a car filed with none. */
  branchName: (id: string | null) => string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const report = useItVehicleCheck(reportId);
  const data = report.data !== undefined && report.data.id === reportId ? report.data : undefined;
  const photos = useReportPhotos(
    data === undefined ? null : data.id,
    data === undefined ? '' : data.photos.map((photo) => photo.fileId).join(','),
  );
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteItVehicleCheck();
  const forget = useForgetItVehicleCheck();
  // The report just deleted: its own read is let go once the panel has closed (or moved to another
  // report) — let go while it is still open, the panel would fetch it back as a 404.
  const [deletedId, setDeletedId] = useState<string | null>(null);
  useEffect(() => {
    if (deletedId === null || !forgetsDeletedReport(deletedId, reportId)) return;
    forget(deletedId);
    setDeletedId(null);
  }, [deletedId, reportId, forget]);

  // A dialog over the panel is its own page: a press inside it is not «outside» the panel, and
  // Escape closes the dialog alone.
  const nested = zoomed !== null || confirming;
  const close = (): void => {
    if (nested) return;
    setZoomed(null);
    onClose();
  };

  const confirmDelete = async (): Promise<void> => {
    if (data === undefined) return;
    const id = data.id;
    try {
      await remove.mutateAsync(id);
      toast.success(t('it.vehicleChecks.report.deleted'));
      setDeletedId(id);
      setConfirming(false);
      onClose();
    } catch (failure) {
      // Said here, and only here: the delete hook declares its own `onError`, so the app's global
      // handler stays silent. The dialog stays open to try again.
      toast.error(errorMessage(failure, locale));
    }
  };

  const zoomedUrl = zoomed === null ? null : (photos.get(zoomed) ?? null);
  const zoomedIndex = data?.photos.findIndex((photo) => photo.fileId === zoomed) ?? -1;

  return (
    <>
      <SideLayer
        open={reportId !== null}
        onClose={close}
        side="left"
        dismissOnOutsideClick={!nested}
        title={
          data === undefined
            ? t('it.vehicleChecks.report.kicker')
            : t('it.vehicleChecks.report.title', { code: data.vehicleCode })
        }
        {...(data === undefined
          ? {}
          : {
              description: `${branchName(data.branchId)} · ${formatYmd(data.checkDate, locale)}`,
            })}
        {...(data === undefined
          ? {}
          : {
              footer: (
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    data-car-reports={data.vehicleId}
                    onClick={() =>
                      onCarReports({ vehicleId: data.vehicleId, vehicleCode: data.vehicleCode })
                    }
                  >
                    {t('it.vehicleChecks.report.carReports')}
                  </Button>
                  <Can permission="itVehicleCheck.delete">
                    <Button
                      size="sm"
                      variant="ghost-danger"
                      data-delete-report={data.id}
                      leftIcon={<TrashIcon className="h-4 w-4" />}
                      onClick={() => setConfirming(true)}
                    >
                      {t('it.vehicleChecks.report.delete')}
                    </Button>
                  </Can>
                </div>
              ),
            })}
      >
        {report.isError && data === undefined ? (
          <ErrorState error={report.error} onRetry={() => void report.refetch()} />
        ) : data === undefined ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <ReportBody report={data} photos={photos} branchName={branchName} onZoom={setZoomed} />
        )}
      </SideLayer>

      {/* «الصورة تُفتح بحجمها الكامل عند الضغط عليها». */}
      <Dialog
        open={zoomedUrl !== null}
        onClose={() => setZoomed(null)}
        size="xl"
        title={
          data === undefined
            ? t('it.vehicleCheck.photos')
            : `${data.vehicleCode} — ${t('it.vehicleCheck.photos.number', {
                n: formatNumber(zoomedIndex + 1, locale),
              })}`
        }
      >
        {zoomedUrl !== null && (
          <img
            src={zoomedUrl}
            alt={t('it.vehicleCheck.photos.alt')}
            className="mx-auto max-h-[75vh] rounded-lg"
          />
        )}
      </Dialog>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('it.vehicleChecks.report.deleteTitle')}
        {...(data === undefined
          ? {}
          : {
              description: `${data.vehicleCode} — ${formatYmd(data.checkDate, locale)} — ${data.reportedByName}`,
            })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
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
          {t('it.vehicleChecks.report.deleteBody')}
        </p>
      </Dialog>
    </>
  );
};
