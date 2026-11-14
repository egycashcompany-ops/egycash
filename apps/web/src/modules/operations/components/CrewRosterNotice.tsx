// "Where is my captain?" — answered on the screen where the question is asked.
//
// Every crew screen draws its pool from ONE roster, so when `operations.crewDepartmentIds` is
// unset they all show the same short list: whoever already had a requirements row, and nobody
// hired since. That is indistinguishable from a correctly configured department that happens to be
// small, which is exactly how it went unnoticed — a captain and a specialist were missing from the
// board and only an old driver showed.
//
// The pool cannot fix it (the setting is organization-wide, and planning is not `setting.edit`), so
// the notice says what is wrong and points at the one screen that can: «إدارات العمليات», a screen
// of its own since Round 14 («انا عاوز افصل ان احدد اداره معايا ولا لا عن تجهيز الطاقم»).
import { Link } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { CREW_DEPARTMENTS_PERMISSION, CREW_DEPARTMENTS_ROUTE } from '../lib/crew-departments';

/**
 * Where the department is chosen. A LINK only for a reader who may open «إدارات العمليات» — a link
 * to a screen that answers 403 is a dead end — and, for everybody else, the words that say who can.
 */
export const ChooseCrewDepartments = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  return can(CREW_DEPARTMENTS_PERMISSION) ? (
    <Link
      to={CREW_DEPARTMENTS_ROUTE}
      className="font-medium underline"
      data-crew-departments-link="true"
    >
      {t('operations.crew.rosterFallbackLink')}
    </Link>
  ) : (
    <span data-crew-departments-elsewhere="true">{t('operations.crew.departmentsElsewhere')}</span>
  );
};

/** `undefined` while the roster is still loading — say nothing until the server has answered. */
export const CrewRosterNotice = ({
  rosterIsDerived,
}: {
  rosterIsDerived: boolean | undefined;
}): JSX.Element | null => {
  const t = useT();
  if (rosterIsDerived !== false) return null;
  return (
    <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {t('operations.crew.rosterFallback')} <ChooseCrewDepartments />
    </p>
  );
};
