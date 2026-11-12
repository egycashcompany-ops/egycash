// «مسميات الوظائف لدى التأمينات» — a tab of «الإعدادات», beside «نموذج التقديم» (A28): «فيه مسميات
// وظائف … عندنا مختلفه عن مسميات الوظائف عند التامينات … هيسمح اني احط مسمي الوظيفي بتاعي و قدامو
// المسمي الوظيفي لدى التامينات عشان … يحط فنموزج 1 المسمي الوظيفي بتاع التامينات».
//
// Every job title on a row, its code and name, and beside it a box for its title at the insurance
// authority. «حفظ» keeps the rows that changed; a box left empty takes the title off, and the job
// prints its own name. «نموذج رقم (1)» prints the authority's title.
import { useEffect, useMemo, useState } from 'react';
import { INSURANCE_JOB_TITLE_MAX, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, Card, CardBody, CardHeader, Input, toast } from '../../../../shared/ui';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { localized } from '../../../../shared/lib/format';
import { columnSearchMatches } from '../../../../shared/lib/column-filter';
import { useInsuranceJobTitles, useSaveInsuranceJobTitles } from '../api/contract-queries';

/** The rows whose box differs from what was saved, as the request sends them. */
export const changedTitles = (
  saved: readonly { jobTitleId: string; insuranceTitle: string }[],
  typed: ReadonlyMap<string, string>,
): { jobTitleId: string; insuranceTitle: string }[] =>
  saved.flatMap((job) => {
    const now = (typed.get(job.jobTitleId) ?? job.insuranceTitle).trim();
    return now === job.insuranceTitle.trim() ? [] : [{ jobTitleId: job.jobTitleId, insuranceTitle: now }];
  });

export const InsuranceJobTitlesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isLoading, isError, error, refetch } = useInsuranceJobTitles();
  const save = useSaveInsuranceJobTitles();
  const [typed, setTyped] = useState<ReadonlyMap<string, string>>(new Map());
  const [search, setSearch] = useState('');

  // What is typed starts again from what was saved, each time it is loaded or saved.
  useEffect(() => setTyped(new Map()), [data]);

  const jobs = data?.jobs ?? [];
  const changed = changedTitles(jobs, typed);
  const shown = useMemo(
    () => jobs.filter((job) => columnSearchMatches(`${job.code} ${job.name.ar} ${job.name.en} ${job.insuranceTitle}`, search)),
    [jobs, search],
  );
  const set = (jobTitleId: string, value: string): void => setTyped((current) => new Map(current).set(jobTitleId, value));

  const submit = async (): Promise<void> => {
    if (changed.length === 0) return;
    try {
      await save.mutateAsync({ titles: changed });
      toast.success(t('contracts.insuranceTitles.saved', { count: changed.length }));
    } catch {
      // the error itself is surfaced globally
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('contracts.insuranceTitles.title')}
        breadcrumbs={[{ label: t('hr.settings.title'), to: '/hr-settings' }, { label: t('contracts.insuranceTitles.title') }]}
        actions={
          <Button disabled={changed.length === 0} loading={save.isPending} onClick={() => void submit()} data-insurance-save>
            {changed.length === 0 ? t('contracts.insuranceTitles.save') : t('contracts.insuranceTitles.saveCount', { count: changed.length })}
          </Button>
        }
      />
      <Card>
        <CardHeader title={t('contracts.insuranceTitles.subtitle')} description={t('contracts.insuranceTitles.hint')} />
        <CardBody>
          {isLoading ? (
            <LoadingState />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : (
            <>
              <div className="mb-3 w-full sm:w-80">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('contracts.insuranceTitles.search')}
                  aria-label={t('contracts.insuranceTitles.search')}
                />
              </div>
              {shown.length === 0 ? (
                <p className="text-sm text-slate-500">{t('contracts.insuranceTitles.none')}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <tr>
                        <th className="w-28 px-3 py-2 text-start font-semibold">{t('contracts.insuranceTitles.code')}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t('contracts.insuranceTitles.ours')}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t('contracts.insuranceTitles.theirs')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {shown.map((job) => {
                        const value = typed.get(job.jobTitleId) ?? job.insuranceTitle;
                        const dirty = value.trim() !== job.insuranceTitle.trim();
                        return (
                          <tr key={job.jobTitleId} className={dirty ? 'bg-amber-50/50 dark:bg-amber-950/20' : undefined} data-insurance-row={job.jobTitleId}>
                            <td className="px-3 py-2 font-mono text-xs" dir="ltr">{job.code}</td>
                            <td className="px-3 py-2 font-medium">{localized(job.name, locale)}</td>
                            <td className="px-3 py-1.5">
                              <Input
                                value={value}
                                maxLength={INSURANCE_JOB_TITLE_MAX}
                                onChange={(e) => set(job.jobTitleId, e.target.value)}
                                placeholder={localized(job.name, locale)}
                                aria-label={t('contracts.insuranceTitles.theirsFor', { job: localized(job.name, locale) })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
};
