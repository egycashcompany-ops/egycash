// The client-side half of "this surface is for customers".
//
// The server is the authority — `requireGoldPortal` refuses anybody without a live binding, and the
// platform gate refuses an external account everywhere else. This only shapes navigation, and it
// does two things the server cannot: it sends an unauthenticated visitor to the PORTAL's login
// rather than the staff one, and it keeps employees out of a surface built for somebody else. The
// second matters because the super-admin holds every permission, `goldPortal.view` included, so a
// grant check alone would let them in to a page that then 403s on every request.
import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ForcePasswordChangePage } from '../../../platform/auth/ForcePasswordChangePage';

export const RequirePortal = ({ children }: { children: ReactNode }): ReactNode => {
  const t = useT();
  const status = useAppSelector((state) => state.auth.status);
  const me = useAppSelector((state) => state.auth.me);

  if (status === 'unknown') return null;
  if (status !== 'signedIn' || me === null) return <Navigate to="/portal/login" replace />;
  // Same first-login gate every account passes through; the customer chooses their own password
  // from the setup link, so this is the rare case of an administrator having reset them.
  if (me.mustChangePassword) return <ForcePasswordChangePage />;

  const external = me.external;
  if (external === null || external.moduleId !== 'gold' || external.subjectType !== 'goldCompany') {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <EmptyState title={t('gold.portal.notACustomer')} description={t('gold.portal.notACustomerHint')} />
      </div>
    );
  }
  return children;
};
