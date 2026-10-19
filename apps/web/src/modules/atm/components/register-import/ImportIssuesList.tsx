// The rows' import notes (spec §8.6): a summary by code, and the rows behind it on demand. A note's
// detail is only ever a P-class value the server chose to send (never a key or a combination).
import { useState } from 'react';
import { type AtmRegisterImportResultDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Badge } from '../../../../shared/ui/Badge';
import { formatNumber } from '../../../../shared/lib/format';
import { pageOf } from '../../lib/register-import-view';
import { ClientPager } from './ImportCategoryCard';

const TH = 'p-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
const TD = 'p-2 align-top';
const PAGE_SIZE = 50;

export const ImportIssuesList = ({
  issues,
}: {
  issues: AtmRegisterImportResultDto['issues'];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [page, setPage] = useState(1);
  const lines = issues.rows.flatMap((row) =>
    row.issues.map((issue, i) => ({ key: `${String(row.importRow)}:${String(i)}`, row, issue })),
  );
  const shown = pageOf(lines, page, PAGE_SIZE);

  return (
    <Card>
      <CardHeader title={t('atm.registerImport.issues.title')} />
      <CardBody className="space-y-3">
        {issues.byCode.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.noResults')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {issues.byCode.map((entry) => (
              <Badge key={entry.code} tone="warning">
                {t(`atm.register.issue.${entry.code}`)} · {formatNumber(entry.count, locale)}
              </Badge>
            ))}
          </div>
        )}
        {lines.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm text-brand-700 dark:text-brand-300">
              {t('atm.registerImport.issues.row')} ({formatNumber(issues.rows.length, locale)})
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className={TH}>{t('atm.registerImport.issues.row')}</th>
                    <th className={TH}>{t('atm.registerImport.issues.codes')}</th>
                    <th className={TH}>{t('atm.registerImport.issues.column')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {shown.map(({ key, row, issue }) => (
                    <tr key={key}>
                      <td className={`${TD} tabular-nums`} dir="ltr">
                        {row.importRow}
                      </td>
                      <td className={TD}>
                        {t(`atm.register.issue.${issue.code}`)}
                        {issue.detail !== null && (
                          <span className="ms-2 text-slate-500 dark:text-slate-400" dir="auto">
                            {issue.detail}
                          </span>
                        )}
                      </td>
                      <td className={`${TD} font-mono`} dir="ltr">
                        {issue.column ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ClientPager page={page} total={lines.length} size={PAGE_SIZE} onPage={setPage} />
            </div>
          </details>
        )}
      </CardBody>
    </Card>
  );
};
