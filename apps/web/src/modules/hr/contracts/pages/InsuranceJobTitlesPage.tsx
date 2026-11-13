// «مسميات الوظائف لدى التأمينات» — a tab of «الإعدادات», beside «نموذج التقديم» (A28): «انا عاوز انا
// اللي احط المسميات الوظيفه بتاعتنا و المسميات الوظيفيه بتاعت التامينات و هنزود column … كود المهنه و
// كله هيتحط manual بس لما تتعمل save خلاص فهي by default لما اجي احط المسمي الوظيفي بتاعنا هيترمي في
// نموزج 1 علي اساس المسمي الوظيفي لدي الالتامينات و كود المهنه».
//
// A table typed by hand: our job title (the company's titles offered while typing, and a note when
// none carries what was typed), its title at social insurance, its occupation code. «إضافة صف» adds a
// row, the bin takes one off, «حفظ» keeps the table as it stands.
import { useEffect, useState } from 'react';
import { OCCUPATION_CODE_PATTERN, INSURANCE_JOB_TITLE_MAX, type InsuranceJobTitlesDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, Card, CardBody, CardHeader, Input, toast } from '../../../../shared/ui';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { foldColumnText } from '../../../../shared/lib/column-filter';
import { useInsuranceJobTitles, useSaveInsuranceJobTitles } from '../api/contract-queries';

/** One row as typed — `key` keeps React's row while its title is retyped. */
export interface TypedRow {
  key: string;
  jobTitle: string;
  insuranceTitle: string;
  occupationCode: string;
}

let next = 0;
const fresh = (): string => `row-${(next += 1)}`;

export const rowsOf = (data: InsuranceJobTitlesDto): TypedRow[] =>
  data.rows.map((row) => ({ key: row.id, jobTitle: row.jobTitle, insuranceTitle: row.insuranceTitle, occupationCode: row.occupationCode }));

/** A job title folded as the server matches it (`jobKey`): «أخصائى عد و فرز» meets «اخصائي عد وفرز». */
export const foldTitle = (title: string): string =>
  foldColumnText(title)
    .replace(/ـ/g, '')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ و /g, ' و');
const fold = foldTitle;

/** What a row lacks before it can be saved: its title, a code form 1 can box, a title not listed twice. */
export const problemsOf = (rows: readonly TypedRow[]): Map<string, 'title' | 'code' | 'twice'> => {
  const problems = new Map<string, 'title' | 'code' | 'twice'>();
  const seen = new Set<string>();
  for (const row of rows) {
    const title = fold(row.jobTitle);
    if (title === '') problems.set(row.key, 'title');
    else if (seen.has(title)) problems.set(row.key, 'twice');
    else if (!OCCUPATION_CODE_PATTERN.test(row.occupationCode.trim())) problems.set(row.key, 'code');
    seen.add(title);
  }
  return problems;
};

/** The table as «حفظ» sends it, trimmed. */
export const requestOf = (rows: readonly TypedRow[]) => ({
  rows: rows.map((row) => ({
    jobTitle: row.jobTitle.trim(),
    insuranceTitle: row.insuranceTitle.trim(),
    occupationCode: row.occupationCode.trim(),
  })),
});

/** Has the table changed since it was loaded? */
export const isChanged = (saved: readonly TypedRow[], typed: readonly TypedRow[]): boolean =>
  JSON.stringify(requestOf(saved)) !== JSON.stringify(requestOf(typed));

export const InsuranceJobTitlesPage = (): JSX.Element => {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useInsuranceJobTitles();
  const save = useSaveInsuranceJobTitles();
  const [rows, setRows] = useState<TypedRow[]>([]);

  // The table starts again from what was saved, each time it is loaded or saved.
  useEffect(() => {
    if (data !== undefined) setRows(rowsOf(data));
  }, [data]);

  const saved = data === undefined ? [] : rowsOf(data);
  const changed = isChanged(saved, rows);
  const problems = problemsOf(rows);
  const known = new Set((data?.jobNames ?? []).map(fold));

  const edit = (key: string, field: keyof Omit<TypedRow, 'key'>, value: string): void =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  const add = (): void => setRows((current) => [...current, { key: fresh(), jobTitle: '', insuranceTitle: '', occupationCode: '' }]);
  const remove = (key: string): void => setRows((current) => current.filter((row) => row.key !== key));

  const submit = async (): Promise<void> => {
    if (!changed || problems.size > 0) return;
    try {
      await save.mutateAsync(requestOf(rows));
      toast.success(t('contracts.insuranceTitles.saved'));
    } catch {
      // the error itself is surfaced globally
    }
  };

  const problemText = (problem: 'title' | 'code' | 'twice'): string =>
    t(`contracts.insuranceTitles.problem.${problem}`);

  return (
    <PageContainer>
      <PageHeader
        title={t('contracts.insuranceTitles.title')}
        breadcrumbs={[{ label: t('hr.settings.title'), to: '/hr-settings' }, { label: t('contracts.insuranceTitles.title') }]}
        actions={
          <Button
            disabled={!changed || problems.size > 0}
            loading={save.isPending}
            onClick={() => void submit()}
            data-insurance-save
          >
            {t('contracts.insuranceTitles.save')}
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
              <datalist id="insurance-job-names">
                {(data?.jobNames ?? []).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2 text-start font-semibold">{t('contracts.insuranceTitles.ours')}</th>
                      <th className="px-3 py-2 text-start font-semibold">{t('contracts.insuranceTitles.theirs')}</th>
                      <th className="w-44 px-3 py-2 text-start font-semibold">{t('contracts.insuranceTitles.code')}</th>
                      <th className="w-16 px-3 py-2" aria-label={t('contracts.insuranceTitles.remove')} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-slate-500">{t('contracts.insuranceTitles.empty')}</td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        const problem = problems.get(row.key);
                        const unknown = row.jobTitle.trim() !== '' && !known.has(fold(row.jobTitle));
                        return (
                          <tr key={row.key} className="align-top" data-insurance-row={row.key}>
                            <td className="px-3 py-2">
                              <Input
                                value={row.jobTitle}
                                maxLength={INSURANCE_JOB_TITLE_MAX}
                                list="insurance-job-names"
                                onChange={(e) => edit(row.key, 'jobTitle', e.target.value)}
                                placeholder={t('contracts.insuranceTitles.oursPlaceholder')}
                                aria-label={t('contracts.insuranceTitles.ours')}
                                data-insurance-ours
                              />
                              {problem === 'title' || problem === 'twice' ? (
                                <p className="mt-1 text-xs text-red-600">{problemText(problem)}</p>
                              ) : (
                                unknown && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('contracts.insuranceTitles.unknown')}</p>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={row.insuranceTitle}
                                maxLength={INSURANCE_JOB_TITLE_MAX}
                                onChange={(e) => edit(row.key, 'insuranceTitle', e.target.value)}
                                aria-label={t('contracts.insuranceTitles.theirs')}
                                data-insurance-theirs
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={row.occupationCode}
                                dir="ltr"
                                maxLength={7}
                                inputMode="numeric"
                                onChange={(e) => edit(row.key, 'occupationCode', e.target.value)}
                                placeholder="123/456"
                                aria-label={t('contracts.insuranceTitles.code')}
                                data-insurance-code
                              />
                              {problem === 'code' && <p className="mt-1 text-xs text-red-600">{problemText(problem)}</p>}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Button size="sm" variant="ghost-danger" onClick={() => remove(row.key)} aria-label={t('contracts.insuranceTitles.remove')}>
                                {t('contracts.insuranceTitles.remove')}
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">
                <Button variant="secondary" size="sm" onClick={add} data-insurance-add>
                  {t('contracts.insuranceTitles.add')}
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
};
