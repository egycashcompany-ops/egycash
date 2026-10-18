// «رسم قطاع جديد» (docs/12-planning/atm-map-zones.md §8.8 `DrawPanel`, `Edit.dc.html:90-105`): the
// three steps, the live counts and «إنهاء» / «تراجع عن النقطة» / «إلغاء». It takes the place of
// «+ قطاع جديد» and «القطاع المحدد» only; «الالتصاق» and «القطاعات» stay below it.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { machineCountText } from '../../lib/map-count-text';

export const DrawPanel = ({
  points,
  inside,
  locale,
  onFinish,
  onUndoPoint,
  onCancel,
}: {
  points: number;
  /** Machines inside the shape so far (0 under three dots). */
  inside: number;
  locale: Locale;
  onFinish: () => void;
  onUndoPoint: () => void;
  onCancel: () => void;
}): JSX.Element => {
  const t = useT();
  const short = points < 3;
  return (
    <section
      data-draw-panel="true"
      className="flex flex-col gap-2.5 rounded-[10px] border border-brand-200 bg-brand-50 p-3.5 dark:border-brand-800 dark:bg-brand-950"
    >
      <h2 className="text-[15px] font-semibold text-brand-900 dark:text-brand-100">
        {t('atm.map.draw.title')}
      </h2>
      <ol className="list-decimal ps-[18px] text-[13px] leading-[1.9] text-brand-800 dark:text-brand-200">
        <li>{t('atm.map.draw.step1')}</li>
        <li>{t('atm.map.draw.step2')}</li>
        <li>{t('atm.map.draw.step3')}</li>
      </ol>
      <div aria-live="polite" className="text-[13px] text-brand-900 dark:text-brand-100">
        {t('atm.map.draw.points', { count: formatNumber(points, locale) })}{' '}
        {t('atm.map.draw.inside', { count: machineCountText(inside, t, locale) })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={onFinish}
          disabled={short}
          title={short ? t('atm.map.draw.needThree') : t('atm.map.draw.closeShape')}
        >
          {t('atm.map.draw.finish')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onUndoPoint} disabled={points === 0}>
          {t('atm.map.draw.undoPoint')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('atm.map.draw.cancel')}
        </Button>
      </div>
      {points > 0 && short && (
        <span className="text-xs text-brand-700 dark:text-brand-300">
          {t('atm.map.draw.needThree')}
        </span>
      )}
    </section>
  );
};
