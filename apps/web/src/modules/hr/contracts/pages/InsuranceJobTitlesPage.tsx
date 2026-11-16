// «مسميات الوظائف لدى التأمينات» — a tab of «الإعدادات», beside «نموذج التقديم» (A28): «هنحط كل الظائف
// بتاعتنا ك data اساسيه و جمب كل واحده زي زرار صغير كدا اسمو تعديل لما ادوس عليه مفروض هيطلعلي pop up
// صغير بردو مثبت فيه المسمي الوظيفي عندنا و التعديل عمتا هيكون ف مسمي الوظيفي لدي التامينات و كود
// المهنه بس».
//
// Every job of the company is a row — none is added or taken off here. «تعديل» opens a small popup:
// our job title fixed at its top, its title at social insurance and its occupation code to type.
// Once saved, form 1 prints them for whoever holds the job. A search above the table finds a job
// («عشان لو عاوز اعمل سيرش علي وظيفه من اللي موجودين») by our title, its insurance title or its code.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  OCCUPATION_CODE_PATTERN,
  INSURANCE_JOB_TITLE_MAX,
  type InsuranceJobTitleRowDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  Input,
  SearchInput,
  toast,
} from '../../../../shared/ui';
import { SEARCH_FITS_TEXT } from '../../recruitment/job-offers/components/OfferFilters';
import { columnSearchMatches } from '../../../../shared/lib/column-filter';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { useInsuranceJobTitles, useSaveInsuranceJobTitle } from '../api/contract-queries';

/** Remembered across visits: this screen's search. */
const REMEMBERED_FILTERS = ['q'] as const;

/** Does the job hold every word searched — in our title, its insurance title or its code? */
export const matchesSearch = (row: InsuranceJobTitleRowDto, search: string): boolean =>
  columnSearchMatches(`${row.jobTitle} ${row.insuranceTitle} ${row.occupationCode}`, search);

/** Can the occupation code be boxed on form 1? Empty is allowed: nothing is printed in the boxes. */
export const isOccupationCode = (code: string): boolean =>
  OCCUPATION_CODE_PATTERN.test(code.trim());

/** The popup's request, trimmed. */
export const requestOf = (insuranceTitle: string, occupationCode: string) => ({
  insuranceTitle: insuranceTitle.trim(),
  occupationCode: occupationCode.trim(),
});

/** Has the popup changed what is kept for the job? */
export const isChanged = (
  row: InsuranceJobTitleRowDto,
  insuranceTitle: string,
  occupationCode: string,
): boolean => {
  const typed = requestOf(insuranceTitle, occupationCode);
  return typed.insuranceTitle !== row.insuranceTitle || typed.occupationCode !== row.occupationCode;
};

/** «تعديل» on one job: our title fixed, its insurance title and code typed. */
const EditDialog = ({
  row,
  onClose,
}: {
  row: InsuranceJobTitleRowDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const save = useSaveInsuranceJobTitle();
  const [insuranceTitle, setInsuranceTitle] = useState(row.insuranceTitle);
  const [occupationCode, setOccupationCode] = useState(row.occupationCode);
  const codeOk = isOccupationCode(occupationCode);
  const changed = isChanged(row, insuranceTitle, occupationCode);

  const submit = async (): Promise<void> => {
    if (!changed || !codeOk) return;
    try {
      await save.mutateAsync({
        jobTitleId: row.jobTitleId,
        body: requestOf(insuranceTitle, occupationCode),
      });
      toast.success(t('contracts.insuranceTitles.saved'));
      onClose();
    } catch {
      // the error itself is surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={t('contracts.insuranceTitles.editTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!changed || !codeOk}
            loading={save.isPending}
            onClick={() => void submit()}
            data-insurance-save
          >
            {t('contracts.insuranceTitles.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('contracts.insuranceTitles.ours')}
          </p>
          <p
            className="mt-1 rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
            data-insurance-ours
          >
            {row.jobTitle}
          </p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t('contracts.insuranceTitles.theirs')}
          </span>
          <Input
            value={insuranceTitle}
            maxLength={INSURANCE_JOB_TITLE_MAX}
            onChange={(e) => setInsuranceTitle(e.target.value)}
            placeholder={row.jobTitle}
            autoFocus
            data-insurance-theirs
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t('contracts.insuranceTitles.code')}
          </span>
          <Input
            value={occupationCode}
            dir="ltr"
            className="text-right"
            maxLength={7}
            inputMode="numeric"
            onChange={(e) => setOccupationCode(e.target.value)}
            placeholder="123/456"
            data-insurance-code
          />
          {!codeOk && (
            <span className="text-xs text-red-600">
              {t('contracts.insuranceTitles.problem.code')}
            </span>
          )}
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('contracts.insuranceTitles.editHint')}
        </p>
      </form>
    </Dialog>
  );
};

export const InsuranceJobTitlesPage = (): JSX.Element => {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useInsuranceJobTitles();
  const [editing, setEditing] = useState<InsuranceJobTitleRowDto | null>(null);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const search = sp.get('q') ?? '';
  // Replaces rather than pushes: a search is a view of this screen, not a place to go Back to.
  const setSearch = (value: string): void => {
    const next = new URLSearchParams(sp);
    if (value === '') next.delete('q');
    else next.set('q', value);
    setSp(next, { replace: true });
  };
  const all = data?.rows ?? [];
  const rows = all.filter((row) => matchesSearch(row, search));

  return (
    <PageContainer>
      <PageHeader
        title={t('contracts.insuranceTitles.title')}
        breadcrumbs={[
          { label: t('hr.settings.title'), to: '/hr-settings' },
          { label: t('contracts.insuranceTitles.title') },
        ]}
      />
      <Card>
        <CardHeader
          title={t('contracts.insuranceTitles.subtitle')}
          description={t('contracts.insuranceTitles.hint')}
        />
        <CardBody>
          {isLoading ? (
            <LoadingState />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : (
            <>
              {/* A flex row lets the box be as wide as its hint, as the other search-only pages. */}
              <div className="mb-3 flex">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder={t('contracts.insuranceTitles.searchPlaceholder')}
                  className={SEARCH_FITS_TEXT}
                />
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2 text-start font-semibold">
                        {t('contracts.insuranceTitles.ours')}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {t('contracts.insuranceTitles.theirs')}
                      </th>
                      <th className="w-36 px-3 py-2 text-start font-semibold">
                        {t('contracts.insuranceTitles.code')}
                      </th>
                      <th
                        className="w-24 px-3 py-2"
                        aria-label={t('contracts.insuranceTitles.edit')}
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                          {all.length === 0
                            ? t('contracts.insuranceTitles.empty')
                            : t('contracts.insuranceTitles.noMatch')}
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr key={row.jobTitleId} data-insurance-row={row.jobTitleId}>
                          <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                            {row.jobTitle}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                            {row.insuranceTitle === '' ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              row.insuranceTitle
                            )}
                          </td>
                          {/* Under its heading, at the start of the cell — away from «تعديل». The code
                              reads left to right inside its own span: «742/115», never «115/742». */}
                          <td className="px-3 py-2 text-start text-slate-700 dark:text-slate-200">
                            {row.occupationCode === '' ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <span dir="ltr" className="tabular-nums" data-insurance-code-cell>
                                {row.occupationCode}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditing(row)}
                              data-insurance-edit={row.jobTitleId}
                            >
                              {t('contracts.insuranceTitles.edit')}
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardBody>
      </Card>
      {editing !== null && <EditDialog row={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
};
