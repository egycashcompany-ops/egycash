// Permission route guard: renders the route when the user holds the permission, otherwise the
// 403 page. UX only — every underlying API call is independently authorized server-side.
import { type ReactNode } from 'react';
import { useCan } from '../rbac/Can';
import { ForbiddenPage } from '../app/pages/ForbiddenPage';

export const RequirePermission = ({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}): ReactNode => {
  const can = useCan();
  return can(permission) ? children : <ForbiddenPage />;
};
