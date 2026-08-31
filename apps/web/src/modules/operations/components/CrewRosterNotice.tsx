// "Where is my captain?" — answered on the screen where the question is asked.
//
// Every crew screen draws its pool from ONE roster, so when `operations.crewDepartmentIds` is
// unset they all show the same short list: whoever already had a requirements row, and nobody
// hired since. That is indistinguishable from a correctly configured department that happens to be
// small, which is exactly how it went unnoticed — a captain and a specialist were missing from the
// board and only an old driver showed.
//
// The pool cannot fix it (the setting is organization-wide, and planning is not `setting.edit`), so
// the notice says what is wrong and points at the one screen that can.
import { Link } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';

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
      {t('operations.crew.rosterFallback')}{' '}
      <Link to="/operations/requirements" className="font-medium underline">
        {t('operations.crew.rosterFallbackLink')}
      </Link>
    </p>
  );
};
