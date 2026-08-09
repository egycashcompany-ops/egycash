// One stored `productId` rendered as a name — the display half of ADR-019 rule 5, and what lets a
// list of installations name its software without holding the catalogue.
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useItSoftwareProduct } from '../api/it-queries';

export const ItSoftwareProductName = ({ id }: { id: string }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const allowed = can('itSoftware.view') || can('itLicense.view');
  const product = useItSoftwareProduct(id, allowed);

  if (!allowed || product.isError) {
    return (
      <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
        {id.slice(-6)}
      </span>
    );
  }
  if (product.data === undefined) {
    return <span className="text-xs text-slate-400">{t('common.loading')}</span>;
  }
  return <span className="text-sm text-slate-800 dark:text-slate-100">{product.data.name}</span>;
};
