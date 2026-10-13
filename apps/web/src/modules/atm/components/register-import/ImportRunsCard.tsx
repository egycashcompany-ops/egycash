// Previous imports (spec §8.6): when each ran, who ran it, what was approved and what happened —
// counts only, never a row (the run's per-row outcomes stay on the server).
import { type AtmRegisterImportRunState, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { StatusBadge, type Tone } from '../../../../shared/ui/Badge';
import { formatDateTime, formatNumber } from '../../../../shared/lib/format';
import { useRegisterImportRuns } from '../../api/register-queries';
import { listSeparator, outcomeEntries } from '../../lib/register-import-view';

const TH = 'p-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
const TD = 'p-2 align-top';

const STATE_TONE: Record<AtmRegisterImportRunState, Tone> = {
  running: 'info',
  completed: 'success',
  failed: 'danger',
  abandoned: 'warning',
};

export const ImportRunsCard = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const runs = useRegisterImportRuns();
  const list = runs.data ?? [];

  return (
    <Card>
      <CardHeader title={t('atm.registerImport.runs.title')} />
      <CardBody>
        {runs.isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('atm.registerImport.runs.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className={TH}>{t('atm.registerImport.runs.started')}</th>
                  <th className={TH}>{t('atm.registerImport.runs.finished')}</th>
                  <th className={TH}>{t('atm.registerImport.runs.state')}</th>
                  <th className={TH}>{t('atm.registerImport.runs.actor')}</th>
                  <th className={TH}>{t('atm.registerImport.runs.categories')}</th>
                  <th className={TH}>{t('atm.registerImport.runs.counts')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((run) => (
                  <tr key={run.id}>
                    <td className={`${TD} whitespace-nowrap`}>
                      {formatDateTime(run.startedAt, locale)}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {formatDateTime(run.finishedAt, locale)}
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        tone={STATE_TONE[run.state]}
                        label={t(`atm.registerImport.runs.state.${run.state}`)}
                      />
                    </td>
                    <td className={TD} dir="auto">
                      {run.actorName ?? '—'}
                    </td>
                    <td className={TD}>
                      {run.categories
                        .map((category) => t(`atm.registerImport.category.${category}.title`))
                        .join(listSeparator(locale))}
                      {run.reportOverride && (
                        <span className="block text-rose-700 dark:text-rose-300">
                          {t('atm.registerImport.reportOverride')}
                        </span>
                      )}
                    </td>
                    <td className={TD}>
                      {outcomeEntries(run.counts).map(([key, n]) => (
                        <span key={key} className="me-3 inline-block whitespace-nowrap">
                          {t(`atm.registerImport.outcome.${key}`)}:{' '}
                          <span className="tabular-nums">{formatNumber(n, locale)}</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
