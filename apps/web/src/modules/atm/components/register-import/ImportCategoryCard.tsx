// One category of the import plan (spec §8.6): what it means, how many rows it holds, the rows
// themselves (paged in the browser — never cut short), and, for an approvable category, the
// owner's Approve tick. Every value shown is a P-class field of the row or a column LETTER; the
// server never sends a key value or a combination, so there is nothing secret here to hide.
import { useState } from 'react';
import {
  type AtmRegisterImportCategoryDto,
  type AtmRegisterImportItemDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Checkbox } from '../../../../shared/ui/form';
import { formatNumber } from '../../../../shared/lib/format';
import { useAtmBankLookup } from '../../api/atm-queries';
import { branchLabel, columnHeaderKey } from '../../lib/register-labels';
import { listSeparator, pageOf } from '../../lib/register-import-view';

const TH = 'p-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
const TD = 'p-2 align-top';
const PAGE_SIZE = 25;
const DASH = '—';

/** Prev / next over a list held in the browser. */
export const ClientPager = ({
  page,
  total,
  size,
  onPage,
}: {
  page: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-2 text-xs text-slate-500 dark:text-slate-400">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('common.pagination.prev')}
      </Button>
      <span className="tabular-nums" dir="ltr">
        {formatNumber(page, locale)} / {formatNumber(pages, locale)}
      </span>
      <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('common.pagination.next')}
      </Button>
    </div>
  );
};

export const ImportCategoryCard = ({
  category,
  approved,
  onToggle,
  disabled = false,
}: {
  category: AtmRegisterImportCategoryDto;
  approved: boolean;
  onToggle: () => void;
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [page, setPage] = useState(1);
  // A row's bank by the catalog's name (DEC-35) — the seed's, or the code, until it answers.
  const lookup = useAtmBankLookup();
  const { key, items } = category;

  const hasReason = items.some((item) => item.reason !== null);
  const showDifferences = key === 'link';
  const showOtherBranch = key === 'activeElsewhere' || key === 'openInRegister';
  const showColumns = key === 'changedSinceImport';
  const shown = pageOf(items, page, PAGE_SIZE);

  const branchOf = (item: AtmRegisterImportItemDto): string =>
    item.branchCode === null ? DASH : branchLabel(item.branchCode, locale);

  return (
    <Card>
      <CardHeader
        title={t(`atm.registerImport.category.${key}.title`)}
        description={t(`atm.registerImport.category.${key}.body`)}
        actions={
          <div className="flex items-center gap-3">
            <Badge tone={category.count > 0 ? 'brand' : 'neutral'}>
              {formatNumber(category.count, locale)}
            </Badge>
            {category.approvable && (
              <Checkbox
                label={t('atm.registerImport.approve')}
                checked={approved}
                disabled={disabled || category.count === 0}
                onChange={onToggle}
              />
            )}
          </div>
        }
      />
      {(items.length > 0 || category.pairs.length > 0) && (
        <CardBody className="space-y-3">
          {category.pairs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={TH}>{t('atm.registerImport.pairs.from')}</th>
                    <th className={TH}>{t('atm.registerImport.pairs.to')}</th>
                    <th className={TH}>{t('atm.registerImport.pairs.count')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {category.pairs.map((pair) => (
                    <tr key={`${pair.fromBranchCode ?? ''}>${pair.toBranchCode}`}>
                      <td className={TD}>
                        <span dir="auto">
                          {pair.fromBranchCode === null
                            ? DASH
                            : branchLabel(pair.fromBranchCode, locale)}
                        </span>
                      </td>
                      <td className={TD}>
                        <span dir="auto">{branchLabel(pair.toBranchCode, locale)}</span>
                      </td>
                      <td className={`${TD} tabular-nums`}>{formatNumber(pair.count, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className={TH}>{t('atm.registerImport.item.row')}</th>
                    <th className={TH}>{t(columnHeaderKey('branchCode'))}</th>
                    <th className={TH}>{t(columnHeaderKey('machineCode'))}</th>
                    <th className={TH}>{t(columnHeaderKey('name'))}</th>
                    <th className={TH}>{t(columnHeaderKey('area'))}</th>
                    <th className={TH}>{t(columnHeaderKey('bankCode'))}</th>
                    {hasReason && <th className={TH}>{t('atm.registerImport.item.reason')}</th>}
                    {showDifferences && (
                      <th className={TH}>{t('atm.registerImport.item.differences')}</th>
                    )}
                    {showOtherBranch && (
                      <th className={TH}>{t('atm.registerImport.item.otherBranch')}</th>
                    )}
                    {showColumns && <th className={TH}>{t('atm.registerImport.item.columns')}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {shown.map((item, i) => (
                    <tr key={`${String(item.importRow)}:${item.machineId ?? ''}:${String(i)}`}>
                      <td className={`${TD} tabular-nums`} dir="ltr">
                        {item.importRow > 0 ? item.importRow : DASH}
                      </td>
                      <td className={TD}>
                        <span dir="auto">{branchOf(item)}</span>
                      </td>
                      <td className={`${TD} font-mono`} dir="ltr">
                        {item.machineCode ?? DASH}
                      </td>
                      <td className={TD}>
                        <span dir="auto">{item.name ?? DASH}</span>
                      </td>
                      <td className={TD}>
                        <span dir="auto">{item.area ?? DASH}</span>
                      </td>
                      <td className={TD}>
                        <span dir="auto">
                          {item.bankCode === null
                            ? (item.masterBankLabel ?? DASH)
                            : lookup.name(item.bankCode, locale)}
                        </span>
                      </td>
                      {hasReason && (
                        <td className={TD}>
                          {item.reason === null
                            ? DASH
                            : t(`atm.registerImport.reason.${item.reason}`)}
                        </td>
                      )}
                      {showDifferences && (
                        <td className={TD}>
                          {item.differences.length === 0
                            ? DASH
                            : item.differences
                                .map((f) => t(columnHeaderKey(f)))
                                .join(listSeparator(locale))}
                        </td>
                      )}
                      {showOtherBranch && (
                        <td className={TD}>
                          <span dir="auto">
                            {item.otherBranchCode === null
                              ? DASH
                              : branchLabel(item.otherBranchCode, locale)}
                          </span>
                        </td>
                      )}
                      {showColumns && (
                        <td className={`${TD} font-mono`} dir="ltr">
                          {item.columns.join(', ')}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <ClientPager page={page} total={items.length} size={PAGE_SIZE} onPage={setPage} />
            </div>
          )}
        </CardBody>
      )}
    </Card>
  );
};
