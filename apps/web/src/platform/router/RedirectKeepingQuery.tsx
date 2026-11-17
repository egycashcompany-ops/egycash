// A retired address that lands on the screen that took its place, WITH its query and hash.
//
// `<Navigate to="/x" replace />` drops the query string, which is the one thing a report's old
// link carries: «تجميع الخزينة»'s bookmark is `?from=…&to=…&name=…`, and landing on «تقرير البنوك»
// with the period reset to this month would show different figures under the same link. `replace`,
// so Back does not bounce the reader into the redirect again.
import { Navigate, useLocation } from 'react-router-dom';

export const RedirectKeepingQuery = ({ to }: { to: string }): JSX.Element => {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
};
