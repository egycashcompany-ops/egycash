// «حذف «X»؟» (docs/12-planning/atm-map-zones.md §8.8, `Edit.dc.html:277-287`): zones are deleted one
// by one, each with its machine count — there is no «حذف كل القطاعات» (dropped by the owner). The
// count is the machines whose primary zone this is; a machine inside another zone keeps that one.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { machineCountText } from '../../lib/map-count-text';

export const DeleteZoneDialog = ({
  zone,
  locale,
  onBack,
  onConfirm,
}: {
  zone: { name: string; count: number } | null;
  locale: Locale;
  onBack: () => void;
  onConfirm: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={zone !== null}
      onClose={onBack}
      size="sm"
      title={t('atm.map.deleteZone.title', { name: zone?.name ?? '' })}
      footer={
        <>
          <Button variant="secondary" onClick={onBack}>
            {t('atm.map.deleteZone.back')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t('atm.map.deleteZone.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('atm.map.deleteZone.body', { count: machineCountText(zone?.count ?? 0, t, locale) })}
      </p>
    </Dialog>
  );
};
