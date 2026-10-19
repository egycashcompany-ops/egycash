// «تعذّر الحفظ» (docs/12-planning/atm-map-zones.md DM-7, §8.8): another editor saved this branch's
// zones after this session loaded them, and the save answered 409 `ATM_MAP_ZONES_STALE` — nothing
// was written. The draft stays; it is said to be kept on this device only when it really was
// (`saveDraft` can be refused, §8.6).
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';

export const ConflictDialog = ({
  open,
  draftKept,
  onReload,
  onClose,
}: {
  open: boolean;
  draftKept: boolean;
  /** «تحميل النسخة الأحدث» — the page asks the discard question first. */
  onReload: () => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('atm.map.conflict.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('atm.map.conflict.close')}
          </Button>
          <Button onClick={onReload}>{t('atm.map.conflict.reload')}</Button>
        </>
      }
    >
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {t(draftKept ? 'atm.map.conflict.body' : 'atm.map.conflict.bodyNoDraft')}
      </p>
    </Dialog>
  );
};
