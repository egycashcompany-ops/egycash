// What applying the file would do (spec §8.6, item 3) — and the one place Apply is pressed.
//
// Read top to bottom the way the owner decides: the counts; what blocks (with the rows behind each
// blocker and the remedy, first); the 57-number check; the rows' notes; the branches; then one card
// per category, each approved on its own. Nothing is approved until somebody ticks it, and the
// report-mismatch override is a separate, red tick that exists only while the numbers differ.
import { useState } from 'react';
import {
  type AtmRegisterImportCategory,
  type AtmRegisterImportResultDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { Checkbox } from '../../../../shared/ui/form';
import { StatStrip } from '../../../../shared/ui/StatStrip';
import { formatNumber, localized } from '../../../../shared/lib/format';
import { ConfirmActionDialog } from '../ReplenishmentDialogs';
import { branchLabel } from '../../lib/register-labels';
import {
  approvedCategories,
  blockerHintKey,
  canApply,
  listSeparator,
  orderedCategories,
  outcomeEntries,
} from '../../lib/register-import-view';
import { ImportCategoryCard } from './ImportCategoryCard';
import { ImportIssuesList } from './ImportIssuesList';
import { ReportCheckTable } from './ReportCheckTable';

const TH = 'p-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
const TD = 'p-2';

export const ImportPreviewPanel = ({
  result,
  approved,
  onToggle,
  reportOverride,
  onOverride,
  onApply,
  applying,
}: {
  result: AtmRegisterImportResultDto;
  approved: ReadonlySet<AtmRegisterImportCategory>;
  onToggle: (category: AtmRegisterImportCategory) => void;
  reportOverride: boolean;
  onOverride: (value: boolean) => void;
  onApply: () => void;
  applying: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [confirming, setConfirming] = useState(false);
  const { blocking, rest } = orderedCategories(result.categories);
  const chosen = approvedCategories(approved);
  const unreadableRows = result.issues.rows.filter((row) =>
    row.issues.some((issue) => issue.code === 'dateInvalid'),
  );
  const yesNo = (value: boolean): string => t(value ? 'common.yes' : 'common.no');

  const categoryCard = (category: (typeof result.categories)[number]): JSX.Element => (
    <ImportCategoryCard
      key={category.key}
      category={category}
      approved={approved.has(category.key as AtmRegisterImportCategory)}
      onToggle={() => onToggle(category.key as AtmRegisterImportCategory)}
      disabled={applying}
    />
  );

  return (
    <div className="space-y-4">
      {result.applied !== null && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {t('atm.registerImport.applied', {
            summary: outcomeEntries(result.applied.counts)
              .map(
                ([key, n]) =>
                  `${t(`atm.registerImport.outcome.${key}`)}: ${formatNumber(n, locale)}`,
              )
              .join(listSeparator(locale)),
          })}
        </p>
      )}

      <StatStrip
        columns={5}
        items={(['rows', 'open', 'ended', 'pending', 'alreadyImported'] as const).map((key) => ({
          key,
          label: t(`atm.registerImport.counts.${key}`),
          value: formatNumber(result.counts[key], locale),
        }))}
      />

      {result.blockers.length > 0 && (
        <Card>
          <CardBody className="space-y-2">
            <ul className="space-y-1.5">
              {result.blockers.map((blocker) => {
                const hint = blockerHintKey(blocker);
                return (
                  <li key={blocker} className="text-sm">
                    <span className="font-medium text-rose-700 dark:text-rose-300">
                      {t(`atm.registerImport.blocker.${blocker}`)}
                    </span>
                    {hint !== null && (
                      <span className="block text-xs text-slate-600 dark:text-slate-300">
                        {t(hint)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {unreadableRows.length > 0 && (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {t('atm.registerImport.item.row')}:{' '}
                <span dir="ltr" className="tabular-nums">
                  {unreadableRows.map((row) => row.importRow).join(', ')}
                </span>
              </p>
            )}
          </CardBody>
        </Card>
      )}
      {blocking.map(categoryCard)}

      <ReportCheckTable report={result.report} />
      <ImportIssuesList issues={result.issues} />

      <Card>
        <CardHeader title={t('atm.registerImport.branches.title')} />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>{t('atm.registerImport.branches.code')}</th>
                  <th className={TH}>{t('atm.registerImport.branches.branch')}</th>
                  <th className={TH}>{t('atm.registerImport.branches.active')}</th>
                  <th className={TH}>{t('atm.registerImport.branches.inReach')}</th>
                  <th className={TH}>{t('atm.registerImport.branches.rows')}</th>
                  <th className={TH}>{t('atm.registerImport.branches.openRows')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {result.branches.map((branch) => (
                  <tr key={branch.code}>
                    <td className={TD}>
                      <span className="font-mono text-xs" dir="ltr">
                        {branch.code}
                      </span>{' '}
                      <span className="text-slate-500 dark:text-slate-400" dir="auto">
                        {branchLabel(branch.code, locale)}
                      </span>
                    </td>
                    <td className={TD} dir="auto">
                      {branch.branchName === null ? '—' : localized(branch.branchName, locale)}
                    </td>
                    <td className={TD}>{yesNo(branch.active)}</td>
                    <td className={TD}>{yesNo(branch.inReach)}</td>
                    <td className={`${TD} tabular-nums`}>{formatNumber(branch.rows, locale)}</td>
                    <td className={`${TD} tabular-nums`}>
                      {formatNumber(branch.openRows, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {rest.map(categoryCard)}

      <Card>
        <CardBody className="space-y-3">
          {!result.report.allMatch && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/40">
              <Checkbox
                label={t('atm.registerImport.reportOverride')}
                checked={reportOverride}
                disabled={applying}
                onChange={(e) => onOverride(e.target.checked)}
              />
              <p className="mt-1 text-xs text-rose-800 dark:text-rose-200">
                {t('atm.registerImport.reportOverrideHint')}
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              disabled={!canApply(result, chosen, reportOverride)}
              loading={applying}
              onClick={() => setConfirming(true)}
            >
              {t('atm.registerImport.apply')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <ConfirmActionDialog
        open={confirming}
        title={t('atm.registerImport.applyConfirmTitle')}
        body={t('atm.registerImport.applyConfirmBody', {
          list: chosen
            .map((category) => t(`atm.registerImport.category.${category}.title`))
            .join(listSeparator(locale)),
        })}
        confirmLabel={t('atm.registerImport.apply')}
        busy={applying}
        onConfirm={() => {
          setConfirming(false);
          onApply();
        }}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
};
