// The read-only halves of the user detail screen: who this account is, where it sits, and what its
// credential state is.
//
// The organizational placement comes from the platform DIRECTORY rather than from `UserDto`. The
// user DTO carries `organization` as raw ids, and rendering an ObjectId to an administrator is the
// same as rendering nothing; the directory already answers "branch / department / job title" as
// localized names, is a platform surface the shell consumes elsewhere, and is deliberately not
// gated on `user.view` — so it costs one request and no new endpoint, no new permission and no
// cross-module import. Section has no directory field and is therefore not shown; a full placement
// panel arrives with the branch reference surface in the next slice.
import { type Locale, type UserDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useDirectoryProfile } from '../../../../platform/directory';
import { Badge, Card, CardBody, CardHeader } from '../../../../shared/ui';
import { formatDateTime } from '../../../../shared/lib/format';
import { AccountStatusBadge, UserStatusBadge } from './UserStatusBadges';

const PLACEHOLDER = '—';

const Fact = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div className="min-w-0">
    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="mt-0.5 truncate text-sm text-slate-800 dark:text-slate-100">{children}</dd>
  </div>
);

export const UserIdentityCard = ({ user }: { user: UserDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: profile } = useDirectoryProfile(user.id);

  return (
    <Card>
      <CardHeader
        title={t('systemAdmin.users.identity.title')}
        description={t('systemAdmin.users.identity.hint')}
      />
      <CardBody>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t('systemAdmin.users.fields.username')}>
            <span dir="ltr">{user.username ?? PLACEHOLDER}</span>
          </Fact>
          <Fact label={t('systemAdmin.users.fields.email')}>
            <span dir="ltr">{user.email ?? PLACEHOLDER}</span>
          </Fact>
          <Fact label={t('systemAdmin.users.fields.phone')}>
            <span dir="ltr">{user.phone ?? PLACEHOLDER}</span>
          </Fact>
          <Fact label={t('systemAdmin.users.fields.locale')}>
            {t(`systemAdmin.users.locale.${user.locale}`)}
          </Fact>
          <Fact label={t('systemAdmin.users.fields.branch')}>
            {profile?.branch?.[locale] ?? PLACEHOLDER}
          </Fact>
          <Fact label={t('systemAdmin.users.fields.department')}>
            {profile?.department?.[locale] ?? PLACEHOLDER}
          </Fact>
          <Fact label={t('systemAdmin.users.fields.jobTitle')}>
            {profile?.jobTitle?.[locale] ?? PLACEHOLDER}
          </Fact>
          <Fact label={t('systemAdmin.users.fields.created')}>
            {formatDateTime(user.createdAt, locale)}
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
};

/**
 * The credential timeline the account panel exists for (§16.5): when the invitation went out, when
 * it stops being valid, when the person first activated, when they last signed in, and when the
 * password last changed. Read-only — every one of these is written by an auth flow, never typed.
 */
export const UserAccountCard = ({ user }: { user: UserDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const never = t('systemAdmin.users.never');

  return (
    <Card>
      <CardHeader
        title={t('systemAdmin.users.account.title')}
        description={t('systemAdmin.users.account.hint')}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <UserStatusBadge status={user.status} />
          <AccountStatusBadge status={user.accountStatus} />
          <Badge size="sm" tone={user.totpEnabled ? 'success' : 'neutral'}>
            {t(user.totpEnabled ? 'systemAdmin.users.totp.on' : 'systemAdmin.users.totp.off')}
          </Badge>
          {user.totpRequired && (
            <Badge size="sm" tone="warning">
              {t('systemAdmin.users.totp.requiredBadge')}
            </Badge>
          )}
          {user.setupLinkPending && (
            <Badge size="sm" tone="info">
              {t('systemAdmin.users.account.linkPending')}
            </Badge>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t('systemAdmin.users.fields.lastLogin')}>
            {user.lastLoginAt === null ? never : formatDateTime(user.lastLoginAt, locale)}
          </Fact>
          <Fact label={t('systemAdmin.users.fields.activatedAt')}>
            {user.activatedAt === null ? never : formatDateTime(user.activatedAt, locale)}
          </Fact>
          <Fact label={t('systemAdmin.users.fields.passwordChangedAt')}>
            {user.passwordChangedAt === null ? never : formatDateTime(user.passwordChangedAt, locale)}
          </Fact>
          <Fact label={t('systemAdmin.users.fields.invitationSentAt')}>
            {user.invitationSentAt === null ? never : formatDateTime(user.invitationSentAt, locale)}
          </Fact>
          <Fact label={t('systemAdmin.users.fields.invitationExpiresAt')}>
            {user.invitationExpiresAt === null
              ? PLACEHOLDER
              : formatDateTime(user.invitationExpiresAt, locale)}
          </Fact>
        </dl>

        {user.lastDelivery !== null && user.lastDelivery.length > 0 && (
          <div className="space-y-1 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t('systemAdmin.users.account.lastDelivery')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {user.lastDelivery.map((row) => (
                <Badge key={row.channel} size="sm" tone={row.ok ? 'success' : 'danger'}>
                  {t(`systemAdmin.users.channel.${row.channel}`)}
                  {row.detail === null ? '' : ` · ${row.detail}`}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
