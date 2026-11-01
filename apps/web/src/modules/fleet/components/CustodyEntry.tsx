// `/fleet/custody` — the menu's «العهدة» — redirects (`custodyEntryTarget`): to «سجل العهدة» on its
// own, to «مصروفات العهدة» for an old board link with its filters, to «سجل العهدة» with the dialog
// for an old `?fund=` link. In place, so Back never returns to the bare address.
import { Navigate, useLocation } from 'react-router-dom';
import { custodyEntryTarget } from '../lib/custody-entry';

export const CustodyEntry = (): JSX.Element => {
  const { search } = useLocation();
  return <Navigate replace to={custodyEntryTarget(search)} />;
};
