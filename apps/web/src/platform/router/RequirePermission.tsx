// Permission route guard: renders the route when the user holds the permission, otherwise the
// 403 page. UX only — every underlying API call is independently authorized server-side.
//
// `anyOf` is for a page several keys lead to — the ATM data-edit page serves Operations
// (`atmRefLabel.*`, `atmMachine.moveArea`) and administrators (`atmMachine.manage`), and each
// action on it is gated again by its own key. Exactly one of `permission` / `anyOf` is given; the
// type refuses both and neither, so a guard can never be accidentally open.
import { type ReactNode } from 'react';
import { useCan } from '../rbac/Can';
import { ForbiddenPage } from '../app/pages/ForbiddenPage';

type Gate =
  { permission: string; anyOf?: never } | { anyOf: readonly string[]; permission?: never };

export const RequirePermission = (props: Gate & { children: ReactNode }): ReactNode => {
  const can = useCan();
  const allowed =
    props.anyOf !== undefined ? props.anyOf.some((p) => can(p)) : can(props.permission);
  return allowed ? props.children : <ForbiddenPage />;
};
