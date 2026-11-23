// What a «رفع جماعي» wrote — step 3 of `/it/assets/import`: the counts, and every asset the apply
// registered, filled or moved, each linked to its record so the reader can open what changed.
import { Link } from 'react-router-dom';
import { type ItAssetImportResultDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Badge, type Tone } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { formatNumber } from '../../../shared/lib/format';
import { resultEntries } from '../lib/asset-import';

type Written = ItAssetImportResultDto['assets'][number];

/** The tone of what happened to an asset — the preview's own colours for the same decisions. */
const ACTION_TONE: Readonly<Record<Written['action'], Tone>> = {
  created: 'success',
  filled: 'info',
  moved: 'brand',
};

export const AssetImportResult = ({
  result,
  onAgain,
}: {
  result: ItAssetImportResultDto;
  /** Start over with another file. */
  onAgain: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const columns: Column<Written>[] = [
    {
      key: 'row',
      header: t('it.assets.import.columns.row'),
      render: (asset) => <span className="tabular-nums">{asset.row}</span>,
    },
    {
      key: 'code',
      header: t('it.assets.columns.code'),
      render: (asset) => (
        <Link
          to={`/it/assets/${asset.assetId}`}
          className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-300"
          dir="ltr"
        >
          {asset.assetCode}
        </Link>
      ),
    },
    {
      key: 'action',
      header: t('it.assets.import.columns.decision'),
      render: (asset) => (
        <Badge tone={ACTION_TONE[asset.action]} size="sm">
          {t(`it.assets.import.resultAction.${asset.action}`)}
        </Badge>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader title={t('it.assets.import.done.title')} />
      <CardBody className="space-y-4">
        <ul className="flex flex-wrap gap-2">
          {resultEntries(result).map(({ key, count }) => (
            <li
              key={key}
              data-import-result={key}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
            >
              {t(`it.assets.import.result.${key}`)}:{' '}
              <span className="font-semibold tabular-nums">{formatNumber(count, locale)}</span>
            </li>
          ))}
        </ul>
        {result.assets.length > 0 && (
          <DataTable
            columns={columns}
            rows={result.assets}
            rowKey={(asset) => `${String(asset.row)}:${asset.assetId}`}
            dense
            minColumnWidth={7}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onAgain}>
            {t('it.assets.import.again')}
          </Button>
          <Link
            to="/it/assets"
            className="text-sm text-brand-700 hover:underline dark:text-brand-300"
          >
            {t('it.assets.backToList')}
          </Link>
        </div>
      </CardBody>
    </Card>
  );
};
