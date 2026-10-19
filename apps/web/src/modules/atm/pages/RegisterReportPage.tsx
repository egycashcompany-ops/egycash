// /atm/register/report — the Data Report (spec §8.5): the owner's `Data Report` sheet as a page
// computed from the register. Machines in operation per bank, per branch, and per branch × bank,
// each a chart in the sheet's own order and colours with its table under it, stamped with the
// moment the server counted (D7).
//
// A THIN shell: the header carries the title and the as-of stamp (no subtitle —
// page-header-has-no-subtitle.spec.ts), and the sections, charts and tables live in
// `components/register-report/*`. It reads no URL parameter and filters nothing, so the remembered-
// filters census files it as not filter-capable. No polling and no as-of picker: the realtime
// signal for `atm.registerEntry` stales the report and it refetches (§8.2).
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { useRegisterReport } from '../api/register-queries';
import { AsOfStamp } from '../components/register-report/AsOfStamp';
import { RegisterReportSections } from '../components/register-report/ReportSection';

export const RegisterReportPage = (): JSX.Element => {
  const t = useT();
  const report = useRegisterReport();
  return (
    <PageContainer>
      <PageHeader
        title={t('atm.registerReport.title')}
        {...(report.data === undefined
          ? {}
          : { actions: <AsOfStamp generatedAt={report.data.generatedAt} /> })}
      />
      {report.data !== undefined ? (
        <RegisterReportSections report={report.data} />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <LoadingState />
      )}
    </PageContainer>
  );
};
