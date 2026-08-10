// Enable / disable an account — the two lifecycle transitions this slice exposes.
//
// The transition map is a copy of the server's (`user.service.ts` §15.5), for the reason the IT
// module states at every transition button: the server still decides, but showing a button that
// can only ever answer 422 is worse than not showing it. The copy is small, closed, and pinned by
// the routes spec beside this module.
//
// ARCHIVE AND DELETE ARE DELIBERATELY ABSENT. Both are irreversible for the account's ability to
// sign in, and the server-side guards that make them safe — refusing an administrator's own
// account, refusing the last holder of a protected system role — do not exist yet; they are P3
// work in the approved plan. Shipping the buttons first would mean relying on this component to
// prevent a lockout, and a client-side guard is the second layer, never the only one. Suspension
// is offered instead: it is fully reversible from this same panel.
import { useState } from 'react';
import { type UserDto, type UserStatus } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { Button, Card, CardBody, CardHeader, Dialog, toast } from '../../../../shared/ui';
import { useChangeUserStatus, useUnlockUser } from '../api/user-queries';

/** The server's own map, narrowed to the targets this slice offers. */
const ENABLE_FROM: readonly UserStatus[] = ['suspended'];
const DISABLE_FROM: readonly UserStatus[] = ['invited', 'active'];

export const UserLifecycleActions = ({ user }: { user: UserDto }): JSX.Element => {
  const t = useT();
  const myUserId = useAppSelector((state) => state.auth.me?.id ?? null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const changeStatus = useChangeUserStatus(user.id);
  const unlock = useUnlockUser(user.id);
  const busy = changeStatus.isPending || unlock.isPending;

  // Suspending your own account revokes your own sessions the moment it succeeds. The server has
  // no guard against it yet, so the screen does not offer the door.
  const isSelf = myUserId !== null && myUserId === user.id;
  const canEnable = ENABLE_FROM.includes(user.status);
  const canDisable = DISABLE_FROM.includes(user.status) && !isSelf;

  const apply = (status: 'active' | 'suspended'): void => {
    changeStatus.mutate(
      { status, version: user.version },
      {
        onSuccess: () => {
          setConfirmDisable(false);
          toast.success(
            t(status === 'active' ? 'systemAdmin.users.enabled' : 'systemAdmin.users.disabled'),
          );
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        title={t('systemAdmin.users.lifecycle.title')}
        description={t('systemAdmin.users.lifecycle.hint')}
      />
      <CardBody className="space-y-3">
        <Can
          permission="user.edit"
          fallback={
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('systemAdmin.users.lifecycle.noAccess')}
            </p>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!canEnable || busy}
              onClick={() => apply('active')}
            >
              {t('systemAdmin.users.actions.enable')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!canDisable || busy}
              onClick={() => setConfirmDisable(true)}
            >
              {t('systemAdmin.users.actions.disable')}
            </Button>
            {/* Offered only while there is a lockout to clear. The account's derived state is the
                only thing that says so — `accountStatus` reports `locked` for a suspended account
                too, and unlocking that one would do nothing, so the lifecycle state is checked as
                well as the derived one. */}
            {user.accountStatus === 'locked' && user.status !== 'suspended' && user.status !== 'archived' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  unlock.mutate(undefined, {
                    onSuccess: () => toast.success(t('systemAdmin.users.unlocked')),
                  })
                }
              >
                {t('systemAdmin.users.actions.unlock')}
              </Button>
            )}
          </div>
          {isSelf && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('systemAdmin.users.lifecycle.selfBlocked')}
            </p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('systemAdmin.users.lifecycle.archiveDeferred')}
          </p>
        </Can>
      </CardBody>

      <Dialog
        open={confirmDisable}
        onClose={() => setConfirmDisable(false)}
        title={t('systemAdmin.users.actions.disable')}
        description={t('systemAdmin.users.confirm.disable')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDisable(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => apply('suspended')}
            >
              {t('systemAdmin.users.actions.disable')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('systemAdmin.users.confirm.disableDetail')}
        </p>
      </Dialog>
    </Card>
  );
};
