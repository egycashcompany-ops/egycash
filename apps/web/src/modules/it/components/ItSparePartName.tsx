// One stored `partId` rendered as a name and a unit — the display half of ADR-019 rule 5, and the
// reason a ledger panel needs no catalogue in the browser.
//
// Resolve-by-id, cached under the part's own detail key, so a panel showing the same part on three
// rows costs one request and not three. A caller without `itSparePart.view` sees a short reference
// rather than a 403: that a repair consumed *something* is not the store's secret.
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useItSparePart } from '../api/it-queries';

export const ItSparePartName = ({ id }: { id: string }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const allowed = can('itSparePart.view');
  const part = useItSparePart(allowed ? id : '');

  if (!allowed || part.isError) {
    return (
      <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
        {id.slice(-6)}
      </span>
    );
  }
  if (part.data === undefined) {
    return <span className="text-xs text-slate-400">{t('common.loading')}</span>;
  }
  return (
    <span className="text-sm text-slate-800 dark:text-slate-100">
      {part.data.name} ({part.data.unit})
    </span>
  );
};
