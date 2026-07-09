// Permission-aware rendering — UX only; the server remains the enforcement
// authority (Software Architecture §6).
import { type ReactNode } from 'react';
import { useAppSelector } from '../../store';

export const useCan = (): ((permission: string) => boolean) => {
  const me = useAppSelector((state) => state.auth.me);
  return (permission: string) => me !== null && permission in me.permissions;
};

export const Can = ({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}): ReactNode => {
  const can = useCan();
  return can(permission) ? children : null;
};
