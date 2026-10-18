// «مراجعة التغييرات قبل الحفظ» (docs/12-planning/atm-map-zones.md §8.8, `Edit.dc.html:252-273`): how
// many zones are new, changed and deleted; every zone's count before and after; the overlaps; and
// how many machines will have no zone. Counted over all the edit branch's active machines, whatever
// the view filters say (§6.4).
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { machineCountText } from '../../lib/map-count-text';
import { type SaveSummary } from '../../lib/map-view';

export const SaveSummaryDialog = ({
  open,
  summary,
  overlaps,
  saving,
  locale,
  onBack,
  onConfirm,
}: {
  open: boolean;
  summary: SaveSummary;
  /** Each overlapping pair once: the zone, the other zone, the machines in both. */
  overlaps: readonly { zone: string; other: string; count: number }[];
  saving: boolean;
  locale: Locale;
  onBack: () => void;
  onConfirm: () => void;
}): JSX.Element => {
  const t = useT();
  const n = (value: number): string => formatNumber(value, locale);
  const cell = 'px-2.5 py-2 text-start';
  return (
    <Dialog
      open={open}
      onClose={onBack}
      size="md"
      title={t('atm.map.save.title')}
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={onBack} disabled={saving}>
            {t('atm.map.save.back')}
          </Button>
          <Button onClick={onConfirm} loading={saving}>
            {t('atm.map.save.confirm')}
          </Button>
        </>
      }
    >
      <div
        data-save-summary="true"
        className="flex flex-col gap-3.5 text-sm text-slate-700 dark:text-slate-200"
      >
        <p>
          {t('atm.map.save.counts', {
            created: n(summary.created),
            updated: n(summary.updated),
            deleted: n(summary.deleted),
          })}
        </p>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <th className={`${cell} font-semibold`}>{t('atm.map.save.colZone')}</th>
              <th className={`${cell} font-semibold`}>{t('atm.map.save.colBefore')}</th>
              <th className={`${cell} font-semibold`}>{t('atm.map.save.colAfter')}</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className={cell}>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    {row.name}
                  </span>
                </td>
                <td className={cell}>{row.before === null ? '—' : n(row.before)}</td>
                <td className={`${cell} font-semibold`}>
                  {row.after === null ? t('atm.map.save.deleted') : n(row.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {overlaps.map((overlap) => (
          <p
            key={`${overlap.zone}|${overlap.other}`}
            className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-2 text-[13px] text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200"
          >
            «{overlap.zone}»:{' '}
            {t('atm.map.edit.overlap', {
              name: overlap.other,
              count: machineCountText(overlap.count, t, locale),
            })}
          </p>
        ))}
        <p className="text-[13px] text-orange-800 dark:text-orange-300">
          {t('atm.map.save.orphaned', { count: n(summary.orphaned) })}
        </p>
      </div>
    </Dialog>
  );
};
