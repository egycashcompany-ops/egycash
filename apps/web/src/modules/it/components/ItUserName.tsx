// A stored user id → a readable name, for the ticket screens.
//
// Three honest outcomes, never a blank: the caller themself is named "you", a directory reader
// gets the real name, and everyone else gets a short reference. Deliberately FAIL-SOFT — a
// requester without `user.view` still reads their own ticket, they just see `#a1b2c3` where a
// technician sees a name. The alternative (an error, or an empty cell) would make the page look
// broken over something that is only a directory permission.
//
// Reads IT's own api module against the PLATFORM users surface — the same boundary rule the
// custody picker follows. No import from another business module.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { fullName } from '../../../shared/lib/format';
import { useItUser } from '../api/it-queries';

const shortRef = (id: string): string => (id.length > 8 ? `#${id.slice(-6)}` : `#${id}`);

export const ItUserName = ({
  id,
  className,
}: {
  id: string | null;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const me = useAppSelector((state) => state.auth.me);
  const isMe = me !== null && id !== null && me.id === id;
  const allowed = can('user.view');
  const { data, isPending } = useItUser(id ?? '', allowed && !isMe && id !== null);

  if (id === null) return <span className={className}>—</span>;
  if (isMe && me !== null) {
    return (
      <span className={className}>
        {`${fullName({ firstName: me.name.firstName, lastName: me.name.lastName }, locale)} · ${t('it.tickets.you')}`}
      </span>
    );
  }
  if (!allowed) {
    return (
      <span className={className} dir="ltr">
        {shortRef(id)}
      </span>
    );
  }
  if (isPending) return <span className={className}>…</span>;
  if (data === undefined) {
    return (
      <span className={className} dir="ltr">
        {shortRef(id)}
      </span>
    );
  }
  return <span className={className}>{fullName(data, locale)}</span>;
};
