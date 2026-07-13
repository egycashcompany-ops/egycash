// Resolve an interviewer id → localized full name via the platform Users endpoint (reused, not
// invented). Gated on `user.view`: without directory access — or if the lookup fails — it falls
// back to a short reference so the panel still renders. Fail-soft by design (no toast on miss).
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { fullName } from '../../../../../shared/lib/format';
import { useUser } from '../api/interview-queries';

const shortRef = (id: string): string => (id.length > 8 ? `#${id.slice(-6)}` : `#${id}`);

export const UserName = ({ id, className }: { id: string; className?: string }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const me = useAppSelector((state) => state.auth.me);
  const allowed = can('user.view');
  const isMe = me !== null && me.id === id;
  const { data, isLoading } = useUser(id, allowed && !isMe);

  if (isMe && me !== null) {
    return <span className={className}>{`${fullName({ firstName: me.name.firstName, lastName: me.name.lastName }, locale)} · ${t('interviews.panel.you')}`}</span>;
  }
  if (!allowed) return <span className={className} dir="ltr">{shortRef(id)}</span>;
  if (isLoading) return <span className={className}>…</span>;
  if (data === undefined) return <span className={className} dir="ltr">{shortRef(id)}</span>;
  return <span className={className}>{fullName(data, locale)}</span>;
};
