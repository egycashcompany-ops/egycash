// «إدارات العمليات» (Round 14) — which company departments ARE the operations crew, on a screen of
// its own.
//
// THE OWNER: «انا عاوز افصل ان احدد اداره معايا ولا لا عن تجهيز الطاقم», and asked where, «شاشة
// لوحدها في القائمة». Choosing the departments is a setting made once in a while by whoever keeps
// the system; preparing the crew («كشف الأطقم», `RequirementsPage.tsx`) is the desk's daily work. The
// card sat above the roster since the roster became the org chart, and Round 15 folded it shut so it
// stayed out of the way; now it has left the roster for this page, beneath it in the sidebar, and
// the roster's notices point here (`ChooseCrewDepartments`).
//
// THE CARD IS THE PAGE (`components/CrewDepartmentsCard.tsx`): open, in its round-15 look — one tile
// per company department, the search, «تراجع» / «حفظ». The title is the page's, and the one figure
// beside it is how many people the SAVED choice makes, as the closed card used to say.
//
// ITS GRANT IS THE SETTING'S WRITE, `setting.edit` — what the card has always required, and what the
// settings endpoint demands of the save. The people count reads the roster, which is Operations'
// (`operationsCrew.view`), so it is asked only of a reader who holds that too: a settings
// administrator without it still has the whole screen, minus a number he could not have read.
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useOperationsCrewDirectory } from '../api/operations-queries';
import { CrewDepartmentsCard } from '../components/CrewDepartmentsCard';

export const CrewDepartmentsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  // The roster «كشف الأطقم» reads (the same query, so one cache); refetched after a save, since the
  // save stales the roster (`useSetOperationsSetting`).
  const directory = useOperationsCrewDirectory(null, can('operationsCrew.view'));
  // Only a DERIVED roster is "the people these departments make"; the unconfigured fallback is
  // somebody else's old list, and counting it here would read as the choice's result.
  const crewCount = directory.data?.rosterIsDerived === true ? directory.data.members.length : null;

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.crew.departments.title')}
        figures={
          crewCount === null ? undefined : (
            <span
              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              data-crew-departments-people="true"
            >
              {t('operations.crew.departments.people', { count: crewCount })}
            </span>
          )
        }
      />
      <CrewDepartmentsCard />
    </PageContainer>
  );
};
