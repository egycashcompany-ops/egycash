// Credential and second-factor actions an administrator can take on someone else's account.
//
// Every one of them already exists on the API and is audited there; this panel is a set of buttons
// over `/platform/users/:id/…`, not a second security model. Three properties of those endpoints
// shape the panel and are worth stating, because a screen that hid them would mislead:
//
//   • A reset does NOT produce a password. It clears the hash and delivers a one-time setup link,
//     so the person chooses their own (§14.4). Nothing here can show, set or reveal a credential,
//     and the result carries per-channel delivery OUTCOMES only — which is why they are rendered.
//   • Resend is only possible while a link is PENDING; the API refuses otherwise, so the button is
//     offered only then rather than left to fail.
//   • Forcing TOTP on CLEARS any existing enrollment (D6): the person re-enrolls at next login.
//     That is a stronger act than "tick a box", so it is spelled out where the toggle lives.
//
// None of these is offered on the administrator's OWN account. Resetting your own credential or
// revoking your own sessions ends your session immediately, and the account menu's Security page
// already does both properly for yourself. The global TOTP policy setting
// (`auth.totp.enforcedForPrivileged`) is never touched from here — per-user enforcement is what
// `totp/require` is for.
import { useState } from 'react';
import {
  type CredentialsDeliveryResultDto,
  type SetupLinkDto,
  type UserDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { Badge, Button, Card, CardBody, CardHeader, Dialog, toast } from '../../../../shared/ui';
import {
  useIssueSetupLink,
  useResendUserCredentials,
  useResetUserPassword,
  useResetUserTotp,
  useRevokeUserSessions,
  useSetUserTotpRequired,
} from '../api/user-queries';
import { SetupLinkDialog } from './SetupLinkDialog';

type Confirm = 'reset' | 'resend' | 'totpReset' | 'revokeSessions' | null;

const DeliveryOutcomes = ({
  delivery,
}: {
  delivery: CredentialsDeliveryResultDto[];
}): JSX.Element => {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {delivery.map((row) => (
        <Badge key={row.channel} size="sm" tone={row.ok ? 'success' : 'danger'}>
          {t(`systemAdmin.users.channel.${row.channel}`)}
          {row.detail === null ? '' : ` · ${row.detail}`}
        </Badge>
      ))}
    </div>
  );
};

export const UserSecurityActions = ({ user }: { user: UserDto }): JSX.Element => {
  const t = useT();
  const myUserId = useAppSelector((state) => state.auth.me?.id ?? null);
  const locale = useAppSelector((state) => state.locale.locale);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [delivery, setDelivery] = useState<CredentialsDeliveryResultDto[] | null>(null);
  // Held in component state and nowhere else: never in the query cache, never in a URL, and gone
  // the moment the dialog closes or the screen unmounts.
  const [setupLink, setSetupLink] = useState<SetupLinkDto | null>(null);

  const reset = useResetUserPassword(user.id);
  const resend = useResendUserCredentials(user.id);
  const issueLink = useIssueSetupLink(user.id);
  const resetTotp = useResetUserTotp(user.id);
  const setRequired = useSetUserTotpRequired(user.id);
  const revokeSessions = useRevokeUserSessions(user.id);

  const isSelf = myUserId !== null && myUserId === user.id;
  const busy =
    reset.isPending ||
    resend.isPending ||
    issueLink.isPending ||
    resetTotp.isPending ||
    setRequired.isPending ||
    revokeSessions.isPending;

  /**
   * The server refuses a link for an account that already has a password (P9-A / D3), so the button
   * is offered only where it would succeed.
   *
   * `accountStatus` is the signal, not `activatedAt`: an admin reset clears the password hash and
   * leaves `activatedAt` set, so an account that was reset and is now waiting for its owner to
   * choose a new password would have been refused a link by this screen while the server was happy
   * to issue one — the code present, the control unreachable, which is the exact shape of the P7-C
   * defect. Both of these states mean "no password on file".
   */
  const awaitingActivation =
    user.accountStatus === 'invitationSent' || user.accountStatus === 'expired';

  if (isSelf) {
    return (
      <Card>
        <CardHeader title={t('systemAdmin.users.security.title')} />
        <CardBody>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('systemAdmin.users.security.selfHint')}
          </p>
        </CardBody>
      </Card>
    );
  }

  const close = (): void => setConfirm(null);

  const confirmations: Record<
    Exclude<Confirm, null>,
    { title: string; body: string; run: () => void }
  > = {
    reset: {
      title: t('systemAdmin.users.actions.resetPassword'),
      body: t('systemAdmin.users.confirm.resetPassword'),
      run: () =>
        reset.mutate(undefined, {
          onSuccess: (result) => {
            setDelivery(result.delivery);
            close();
            toast.success(t('systemAdmin.users.resetSent'));
          },
        }),
    },
    resend: {
      title: t('systemAdmin.users.actions.resend'),
      body: t('systemAdmin.users.confirm.resend'),
      run: () =>
        resend.mutate(undefined, {
          onSuccess: (result) => {
            setDelivery(result.delivery);
            close();
            toast.success(t('systemAdmin.users.resendSent'));
          },
        }),
    },
    totpReset: {
      title: t('systemAdmin.users.actions.resetTotp'),
      body: t('systemAdmin.users.confirm.resetTotp'),
      run: () =>
        resetTotp.mutate(undefined, {
          onSuccess: () => {
            close();
            toast.success(t('systemAdmin.users.totpReset'));
          },
        }),
    },
    revokeSessions: {
      title: t('systemAdmin.users.actions.revokeSessions'),
      body: t('systemAdmin.users.confirm.revokeSessions'),
      run: () =>
        revokeSessions.mutate(undefined, {
          onSuccess: () => {
            close();
            toast.success(t('systemAdmin.users.sessionsRevoked'));
          },
        }),
    },
  };

  const active = confirm === null ? null : confirmations[confirm];

  return (
    <Card>
      <CardHeader
        title={t('systemAdmin.users.security.title')}
        description={t('systemAdmin.users.security.hint')}
      />
      <CardBody className="space-y-4">
        <Can
          permission="user.resetPassword"
          fallback={
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('systemAdmin.users.security.noAccess')}
            </p>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm('reset')}>
              {t('systemAdmin.users.actions.resetPassword')}
            </Button>
            {user.setupLinkPending && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm('resend')}>
                {t('systemAdmin.users.actions.resend')}
              </Button>
            )}
            {user.totpEnabled && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirm('totpReset')}
              >
                {t('systemAdmin.users.actions.resetTotp')}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                setRequired.mutate(!user.totpRequired, {
                  onSuccess: () =>
                    toast.success(
                      t(
                        user.totpRequired
                          ? 'systemAdmin.users.totpNotRequired'
                          : 'systemAdmin.users.totpRequired',
                      ),
                    ),
                })
              }
            >
              {t(
                user.totpRequired
                  ? 'systemAdmin.users.actions.totpNotRequired'
                  : 'systemAdmin.users.actions.totpRequire',
              )}
            </Button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('systemAdmin.users.security.totpRequireHint')}
          </p>
        </Can>

        {/* P9-A. Its own gate, because reading a link is a stronger act than delivering one — an
            administrator may legitimately hold reset without holding this. Offered only while the
            account has no password: for one that has, this would be a reset, and the server says so
            with 422 rather than obliging. */}
        <Can permission="user.setupLink">
          {awaitingActivation && (
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  issueLink.mutate(undefined, {
                    onSuccess: (result) => setSetupLink(result),
                    onError: () => toast.error(t('systemAdmin.users.setupLink.failed')),
                  })
                }
              >
                {t('systemAdmin.users.actions.setupLink')}
              </Button>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('systemAdmin.users.security.setupLinkHint')}
              </p>
            </div>
          )}
        </Can>

        <Can permission="user.manageSessions">
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button
              size="sm"
              variant="ghost-danger"
              disabled={busy}
              onClick={() => setConfirm('revokeSessions')}
            >
              {t('systemAdmin.users.actions.revokeSessions')}
            </Button>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('systemAdmin.users.security.revokeHint')}
            </p>
          </div>
        </Can>

        {delivery !== null && (
          <div className="space-y-1 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t('systemAdmin.users.security.delivery')}
            </p>
            <DeliveryOutcomes delivery={delivery} />
          </div>
        )}
      </CardBody>

      <Dialog
        open={active !== null}
        onClose={close}
        title={active?.title ?? ''}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => active?.run()}>
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{active?.body ?? ''}</p>
      </Dialog>

      <SetupLinkDialog
        link={setupLink}
        userName={`${user.firstName[locale]} ${user.lastName[locale]}`.trim()}
        onClose={() => setSetupLink(null)}
      />
    </Card>
  );
};
