// One stored `assetId` rendered as a code and a name — the display half of ADR-019 rule 5.
//
// A row holding an id and no name still has to say what it points at, so this resolves by id and
// links to the asset. A caller without `itAsset.view` sees a short reference rather than a 403:
// the fact that a plan or an order exists is not itself confidential, only the asset's detail is.
import { Link } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useItAsset } from '../api/it-queries';

export const ItAssetLink = ({ id }: { id: string }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const allowed = can('itAsset.view');
  const asset = useItAsset(allowed ? id : '');

  if (!allowed || asset.isError) {
    return (
      <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
        {id.slice(-6)}
      </span>
    );
  }
  if (asset.data === undefined) {
    return <span className="text-xs text-slate-400">{t('common.loading')}</span>;
  }
  return (
    <Link
      to={`/it/assets/${asset.data.id}`}
      className="text-sm text-brand-700 hover:underline dark:text-brand-300"
    >
      {asset.data.assetCode} — {asset.data.name}
    </Link>
  );
};
