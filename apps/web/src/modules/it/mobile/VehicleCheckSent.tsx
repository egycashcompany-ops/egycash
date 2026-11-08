// «تم إرسال التقرير» — what the reporter sees once the report is filed
// (docs/12-planning/it-vehicle-checks-design.md §2 item 7): the car, the day, «x يعمل · y لا يعمل»,
// and the number of photos, then «تقرير لسيارة أخرى», which clears the form and keeps the day.
//
// The report is filed whatever became of its photos. A photo that did not go up for want of an
// answer is counted here and «إعادة رفع الصور» sends it again to the SAME report (with its own
// `clientPhotoId`, so a photo whose answer was lost is not added twice); a photo the server refused
// is named with the reason and is not offered again.
import { type ReactNode } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { Button } from '../../../shared/ui/Button';
import { CheckIcon } from '../../../shared/ui/icons';
import { custodyPlural, type CustodyCountForm } from '../../fleet/lib/custody-words';
import { dayShown, type VehicleCheckCounts } from '../lib/vehicle-check-form';
import {
  VEHICLE_CHECK_MAX_PHOTOS,
  photoRefusalReason,
  type PhotoRefusalReason,
} from '../lib/vehicle-check-photos';
import { CARD } from './vehicle-check-looks';

export interface VehicleCheckSentSummary {
  /** The car's code as the report filed it. */
  vehicleCode: string;
  checkDate: string;
  counts: VehicleCheckCounts;
  /** Photos on the report now. */
  photoCount: number;
  /** Photos that did not go up for want of an answer — the ones «إعادة رفع الصور» sends. */
  failed: number;
  /** The server's code for each photo it refused. */
  refused: readonly string[];
}

export const VehicleCheckSent = ({
  summary,
  retrying,
  onRetry,
  onAnother,
}: {
  summary: VehicleCheckSentSummary;
  retrying: boolean;
  onRetry: () => void;
  onAnother: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const form = (n: number): CustodyCountForm => custodyPlural(locale, n);

  // Every form written out, so each key is a literal the IT dictionary check can see.
  const photoCount = (n: number): string => {
    if (n === 0) return t('it.vehicleCheck.sent.photoCount.none');
    const words: Record<CustodyCountForm, string> = {
      one: t('it.vehicleCheck.sent.photoCount.one', { count: n }),
      two: t('it.vehicleCheck.sent.photoCount.two', { count: n }),
      few: t('it.vehicleCheck.sent.photoCount.few', { count: n }),
      many: t('it.vehicleCheck.sent.photoCount.many', { count: n }),
      other: t('it.vehicleCheck.sent.photoCount.other', { count: n }),
    };
    return words[form(n)];
  };
  const failedLine = (n: number): string => {
    const words: Record<CustodyCountForm, string> = {
      one: t('it.vehicleCheck.sent.failed.one', { count: n }),
      two: t('it.vehicleCheck.sent.failed.two', { count: n }),
      few: t('it.vehicleCheck.sent.failed.few', { count: n }),
      many: t('it.vehicleCheck.sent.failed.many', { count: n }),
      other: t('it.vehicleCheck.sent.failed.other', { count: n }),
    };
    return words[form(n)];
  };
  const refusedLead = (n: number): string => {
    const words: Record<CustodyCountForm, string> = {
      one: t('it.vehicleCheck.sent.refused.one', { count: n }),
      two: t('it.vehicleCheck.sent.refused.two', { count: n }),
      few: t('it.vehicleCheck.sent.refused.few', { count: n }),
      many: t('it.vehicleCheck.sent.refused.many', { count: n }),
      other: t('it.vehicleCheck.sent.refused.other', { count: n }),
    };
    return words[form(n)];
  };
  // Each reason reads for ANY count, since the lead before it may count one photo or several: it
  // speaks of the report, or of the size or type in general, never of «الصورة» in the singular
  // («لم تُرفع صورتان: الحجم أكبر من 10 ميجابايت.»).
  const reasonWords: Record<PhotoRefusalReason, string> = {
    limit: t('it.vehicleCheck.sent.reason.limit', { max: VEHICLE_CHECK_MAX_PHOTOS }),
    window: t('it.vehicleCheck.sent.reason.window'),
    tooLarge: t('it.vehicleCheck.sent.reason.size'),
    badType: t('it.vehicleCheck.sent.reason.type'),
    other: t('it.vehicleCheck.sent.reason.server'),
  };
  const reasons = [...new Set(summary.refused.map(photoRefusalReason))].map((r) => reasonWords[r]);

  const { counts } = summary;
  const rows: [string, ReactNode][] = [
    [t('it.vehicleCheck.vehicle'), summary.vehicleCode],
    [t('it.vehicleCheck.date'), <bdi key="day">{dayShown(summary.checkDate)}</bdi>],
    [
      t('it.vehicleCheck.sent.devices'),
      <>
        {t('it.vehicleCheck.sent.works', { count: counts.works })}
        {' · '}
        <span className={counts.notWorking > 0 ? 'text-red-600 dark:text-red-400' : ''}>
          {t('it.vehicleCheck.sent.notWorking', { count: counts.notWorking })}
        </span>
        {counts.unanswered > 0 &&
          ` · ${t('it.vehicleCheck.sent.unanswered', { count: counts.unanswered })}`}
      </>,
    ],
    [t('it.vehicleCheck.sent.photos'), photoCount(summary.photoCount)],
  ];

  return (
    <div data-vehicle-check-sent="true">
      <section className={cn(CARD, 'space-y-5 px-4 pb-5 pt-8')}>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <CheckIcon className="h-6 w-6" />
          </span>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            {t('it.vehicleCheck.sent.title')}
          </h2>
        </div>
        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-[15px] dark:divide-slate-800 dark:border-slate-800">
          {rows.map(([term, value]) => (
            <div key={term} className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-slate-500 dark:text-slate-400">{term}</dt>
              <dd className="text-end font-semibold text-slate-900 dark:text-slate-50">{value}</dd>
            </div>
          ))}
        </dl>
        {summary.failed > 0 && (
          <div
            role="status"
            data-vehicle-check-failed-photos="true"
            className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
          >
            <p className="font-semibold">{failedLine(summary.failed)}</p>
            <Button
              variant="secondary"
              onClick={onRetry}
              loading={retrying}
              className="min-h-12 w-full !text-base"
              data-vehicle-check-retry="true"
            >
              {t('it.vehicleCheck.sent.retry')}
            </Button>
          </div>
        )}
        {summary.refused.length > 0 && (
          <p
            role="status"
            data-vehicle-check-refused-photos="true"
            className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200"
          >
            <strong>{refusedLead(summary.refused.length)}</strong>{' '}
            {reasons.join(t('common.validation.separator'))}.
          </p>
        )}
        <Button
          onClick={onAnother}
          disabled={retrying}
          className="min-h-12 w-full !text-base"
          data-vehicle-check-another="true"
        >
          {t('it.vehicleCheck.sent.another')}
        </Button>
      </section>
    </div>
  );
};
