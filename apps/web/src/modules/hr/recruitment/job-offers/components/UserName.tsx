// Resolve a manager (user) id → localized full name via the platform Users endpoint (reused, not
// invented). Gated on `user.view`: without directory access — or if the lookup fails — it falls
// back to a short reference. Fail-soft (no toast on miss).
import { type Locale } from '@ecms/contracts';
import { useCan } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { fullName } from '../../../../../shared/lib/format';
import { useUser } from '../api/job-offer-queries';

const shortRef = (id: string): string => (id.length > 8 ? `#${id.slice(-6)}` : `#${id}`);

export const UserName = ({ id, className }: { id: string; className?: string }): JSX.Element => {
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const allowed = can('user.view');
  const { data, isLoading } = useUser(id, allowed);

  if (!allowed) return <span className={className} dir="ltr">{shortRef(id)}</span>;
  if (isLoading) return <span className={className}>…</span>;
  if (data === undefined) return <span className={className} dir="ltr">{shortRef(id)}</span>;
  return <span className={className}>{fullName(data, locale)}</span>;
};
