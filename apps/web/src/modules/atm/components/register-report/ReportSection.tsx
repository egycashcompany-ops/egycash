// The Data Report's body (spec §8.5): the sheet's three sections in the sheet's order, each its
// chart with the table of its own cells under it, and above them the two notes the sheet could not
// make — machines in operation whose branch has no register code (counted in the bank figures
// only) and machines in operation with no bank (counted in the branch figures only).
//
// Which branches appear is the server's answer (`branchesShown`, DEC-27): a branch outside the
// reader's reach is not drawn as a zero, it is simply not on the page. Every number is the
// server's; `lib/register-report-view.ts` only picks and places them.
//
// Printed, each section keeps to one page where it can, loses its shadow, and keeps its colours.
import { useId, type ReactNode } from 'react';
import { type AtmRegisterReportDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import {
  hasBranchCategories,
  registerReportView,
  reportCount,
  type ReportSingleSection,
} from '../../lib/register-report-view';
import { BarChart } from './BarChart';
import { GroupedBarChart } from './GroupedBarChart';
import { ReportTable } from './ReportTable';

const NOTE =
  'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
const INFO =
  'rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200';

/** One section of the sheet: its title, then its chart and table. */
export const ReportSection = ({
  section,
  title,
  children,
}: {
  section: 1 | 2 | 3;
  title: string;
  children: ReactNode;
}): JSX.Element => {
  const titleId = useId();
  return (
    <section
      data-report-section={section}
      aria-labelledby={titleId}
      className="break-inside-avoid rounded-lg border border-slate-200 bg-white shadow-card print:shadow-none dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id={titleId}
        className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100"
      >
        {title}
      </h2>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
};

/** Sections 1 and 2: the chart, and the labels row over the values row. */
const SingleSection = ({ section }: { section: ReportSingleSection }): JSX.Element => (
  <>
    <BarChart section={section} />
    <ReportTable
      section={section.section}
      caption={section.title}
      columns={section.bars.map((bar) => ({ key: bar.key, label: bar.label, strong: bar.isTotal }))}
      rows={[
        {
          key: 'values',
          label: null,
          cells: section.bars.map((bar) => ({
            key: bar.key,
            value: bar.value,
            strong: bar.isTotal,
          })),
        },
      ]}
    />
  </>
);

const NoBranch = (): JSX.Element => {
  const t = useT();
  return (
    <p
      data-report-no-branch="true"
      className="py-6 text-center text-sm text-slate-500 dark:text-slate-400"
    >
      {t('atm.registerReport.empty')}
    </p>
  );
};

export const RegisterReportSections = ({
  report,
}: {
  report: AtmRegisterReportDto;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const view = registerReportView(report, locale, t);
  const { section1, section2, section3 } = view;

  return (
    <div className="space-y-4">
      {view.empty && (
        <p role="status" data-report-empty="true" className={INFO}>
          {t('atm.registerReport.empty')}
        </p>
      )}
      {view.activeWithUnmappedBranch > 0 && (
        <p role="status" data-report-unmapped={view.activeWithUnmappedBranch} className={NOTE}>
          {t('atm.registerReport.unmapped', {
            count: reportCount(view.activeWithUnmappedBranch),
          })}
        </p>
      )}
      {view.activeWithoutBank > 0 && (
        <p role="status" data-report-without-bank={view.activeWithoutBank} className={NOTE}>
          {t('atm.registerReport.withoutBank', { count: reportCount(view.activeWithoutBank) })}
        </p>
      )}

      <ReportSection section={1} title={section1.title}>
        <SingleSection section={section1} />
      </ReportSection>

      <ReportSection section={2} title={section2.title}>
        {hasBranchCategories(section2) ? <SingleSection section={section2} /> : <NoBranch />}
      </ReportSection>

      <ReportSection section={3} title={section3.title}>
        {section3.groups.length > 0 ? (
          <>
            <GroupedBarChart section={section3} />
            <ReportTable
              section={3}
              caption={section3.title}
              corner={t('atm.register.col.branchCode')}
              columns={section3.series.map((series) => ({
                key: series.key,
                label: series.label,
                strong: false,
              }))}
              rows={section3.groups.map((group) => ({
                key: group.key,
                label: group.label,
                cells: group.cells.map((cell) => ({ ...cell, strong: false })),
              }))}
            />
          </>
        ) : (
          <NoBranch />
        )}
      </ReportSection>
    </div>
  );
};
