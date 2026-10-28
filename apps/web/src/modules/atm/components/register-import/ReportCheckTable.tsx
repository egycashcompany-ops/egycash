// The Data Report check (spec §6.5, §8.6): the sheet's 57 numbers recomputed from this file, each
// beside the verified snapshot. Laid out as the Data Report page names its cells, so the owner can
// hold the two side by side.
import { type AtmRegisterImportResultDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { formatNumber } from '../../../../shared/lib/format';
import { cn } from '../../../../shared/lib/cn';
import { useAtmBankLookup } from '../../api/atm-queries';
import { reportCellLabel } from '../../lib/register-import-view';

const TH = 'p-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
const TD = 'p-2';

export const ReportCheckTable = ({
  report,
}: {
  report: AtmRegisterImportResultDto['report'];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The six seeds' names as the catalog holds them now (a curated name reads here too).
  const lookup = useAtmBankLookup();
  return (
    <Card>
      <CardHeader title={t('atm.registerImport.reportCheck.title')} />
      <CardBody className="space-y-3">
        {report.allMatch && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
            {t('atm.registerImport.reportCheck.allMatch')}
          </p>
        )}
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white dark:bg-slate-900">
              <tr>
                <th className={TH}>{t('atm.registerImport.reportCheck.section')}</th>
                <th className={TH}>{t('atm.registerImport.reportCheck.label')}</th>
                <th className={TH}>{t('atm.registerImport.reportCheck.cell')}</th>
                <th className={TH}>{t('atm.registerImport.reportCheck.expected')}</th>
                <th className={TH}>{t('atm.registerImport.reportCheck.recomputed')}</th>
                <th className={TH}>
                  <span className="sr-only">{t('atm.registerImport.reportCheck.match')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.cells.map((cell) => (
                <tr
                  key={cell.key}
                  className={cn(!cell.matches && 'bg-rose-50 dark:bg-rose-950/40')}
                >
                  <td className={TD}>{t(`atm.registerReport.section${String(cell.section)}`)}</td>
                  <td className={TD}>
                    <span dir="auto">{reportCellLabel(cell, t, locale, lookup.ordered)}</span>
                  </td>
                  <td className={`${TD} font-mono`} dir="ltr">
                    {cell.cell}
                  </td>
                  <td className={`${TD} tabular-nums`}>{formatNumber(cell.expected, locale)}</td>
                  <td className={`${TD} tabular-nums font-medium`}>
                    {formatNumber(cell.recomputed, locale)}
                  </td>
                  <td
                    className={cn(
                      TD,
                      cell.matches
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'font-medium text-rose-700 dark:text-rose-300',
                    )}
                  >
                    {cell.matches
                      ? t('atm.registerImport.reportCheck.match')
                      : t('atm.registerImport.reportCheck.mismatch')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
};
