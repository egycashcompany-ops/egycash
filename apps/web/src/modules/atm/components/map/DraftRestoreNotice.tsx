// A draft from an earlier session (docs/12-planning/atm-map-zones.md DM-29, §8.8): kept on this
// device under (user, branch) and offered back only when it was drawn on the revision the server
// still has. An older one would re-apply edits over somebody else's save, so it is announced as
// outdated and cleared instead.
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';

export const DraftRestoreNotice = ({
  kind,
  onRestore,
  onIgnore,
}: {
  kind: 'restore' | 'outdated';
  onRestore: () => void;
  /** «تجاهلها», or closing the outdated notice. */
  onIgnore: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      role="status"
      data-draft-notice={kind}
      className="mb-3.5 flex flex-wrap items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-[13px] text-brand-900 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-100"
    >
      <span>{t(kind === 'restore' ? 'atm.map.draft.found' : 'atm.map.draft.outdated')}</span>
      <div className="ms-auto flex gap-2">
        {kind === 'restore' && (
          <Button size="sm" onClick={onRestore}>
            {t('atm.map.draft.restore')}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onIgnore}>
          {kind === 'restore' ? t('atm.map.draft.ignore') : t('atm.map.conflict.close')}
        </Button>
      </div>
    </div>
  );
};
