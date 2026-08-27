// The candidate's route subtree, lazy-loaded as its own chunk.
//
// Its layout element is `ApplicantPortalShell`, not `AppShell` — which is the whole reason a
// candidate never sees an icon rail, a launcher or a command palette over a catalogue they hold
// no permissions for. Because AppShell is a route element each module chooses, there is nothing
// to switch off.
import { Route, Routes } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import { ApplicantPortalShell } from './ApplicantPortalShell';
import { RequireApplicantPortal } from './RequireApplicantPortal';
import { ApplicantPortalPage } from './pages/ApplicantPortalPage';

/** A wrong path INSIDE the portal stays inside it — the staff 404 links to a home they cannot open. */
const ApplicantPortalNotFound = (): JSX.Element => {
  const t = useT();
  return <EmptyState title={t('hr.applicantPortal.notFound')} />;
};

export default function ApplicantPortalRoutes(): JSX.Element {
  return (
    <Routes>
      <Route
        element={
          <RequireApplicantPortal>
            <ApplicantPortalShell />
          </RequireApplicantPortal>
        }
      >
        <Route index element={<ApplicantPortalPage />} />
        <Route path="*" element={<ApplicantPortalNotFound />} />
      </Route>
    </Routes>
  );
}
