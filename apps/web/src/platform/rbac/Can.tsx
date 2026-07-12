// Permission-aware rendering — UX only; the server remains the enforcement authority
// (Software Architecture §6, ADR-004). `useCan` answers a single permission; the hooks below
// answer any-of/all-of. `<Can>` gates a subtree and can render a fallback instead of nothing.
import { type ReactNode } from 'react';
import { useAppSelector } from '../../store';

export const useCan = (): ((permission: string) => boolean) => {
  const me = useAppSelector((state) => state.auth.me);
  return (permission: string) => me !== null && permission in me.permissions;
};

export const useHasAnyPermission = (): ((permissions: string[]) => boolean) => {
  const can = useCan();
  return (permissions: string[]) => permissions.some((p) => can(p));
};

export const useHasAllPermissions = (): ((permissions: string[]) => boolean) => {
  const can = useCan();
  return (permissions: string[]) => permissions.every((p) => can(p));
};

export const Can = ({
  permission,
  anyOf,
  allOf,
  fallback = null,
  children,
}: {
  permission?: string;
  anyOf?: string[];
  allOf?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}): ReactNode => {
  const can = useCan();
  const allowed =
    (permission === undefined || can(permission)) &&
    (anyOf === undefined || anyOf.some((p) => can(p))) &&
    (allOf === undefined || allOf.every((p) => can(p)));
  return allowed ? children : fallback;
};
