// Two badges, because an account answers two different questions and conflating them is how an
// administrator ends up reset-linking an account that was merely suspended.
//
//   • `status`        — the LIFECYCLE the administrator drives: invited → active → suspended →
//                       archived. This is the one the transition buttons act on, and the one the
//                       list sorts by (`sortableFields: ['email','status','createdAt']`).
//   • `accountStatus` — DERIVED server-side and never stored (`user.service.ts` §15.4): can this
//                       person sign in right now, and if not, why. A suspended account and an
//                       account whose setup link expired both cannot sign in, and they need
//                       completely different remedies.
import { StatusBadge, type Tone } from '../../../../shared/ui';
import { type AccountStatus, type UserStatus } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';

const LIFECYCLE_TONE: Record<UserStatus, Tone> = {
  invited: 'info',
  active: 'success',
  suspended: 'warning',
  // Terminal, not alarming: an archived account is a decision that was carried out, not a fault.
  archived: 'neutral',
};

const ACCOUNT_TONE: Record<AccountStatus, Tone> = {
  activated: 'success',
  invitationSent: 'info',
  // The link ran out — recoverable by an administrator, so a warning rather than a failure.
  expired: 'warning',
  // Cannot sign in and will not recover on its own.
  locked: 'danger',
};

export const UserStatusBadge = ({ status }: { status: UserStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={LIFECYCLE_TONE[status]} label={t(`systemAdmin.users.status.${status}`)} />;
};

export const AccountStatusBadge = ({ status }: { status: AccountStatus }): JSX.Element => {
  const t = useT();
  return (
    <StatusBadge tone={ACCOUNT_TONE[status]} label={t(`systemAdmin.users.accountStatus.${status}`)} />
  );
};

export { LIFECYCLE_TONE, ACCOUNT_TONE };
