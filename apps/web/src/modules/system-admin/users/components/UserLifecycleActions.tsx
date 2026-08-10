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
import { useNavigate } from 'react-router-dom';
import { type UserDto, type UserStatus } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { Button, Card, CardBody, CardHeader, Dialog, toast } from '../../../../shared/ui';
import { useChangeUserStatus, useDeleteUser, useUnlockUser } from '../api/user-queries';

/** The server's own map, narrowed to the targets this slice offers. */
const ENABLE_FROM: readonly UserStatus[] = ['suspended'];
const DISABLE_FROM: readonly UserStatus[] = ['invited', 'active'];

export const UserLifecycleActions = ({ user }: { user: UserDto }): JSX.Element => {
  const t = useT();
  const myUserId = useAppSelector((state) => state.auth.me?.id ?? null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const changeStatus = useChangeUserStatus(user.id);
  const unlock = useUnlockUser(user.id);
  const remove = useDeleteUser(user.id);
  const navigate = useNavigate();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = changeStatus.isPending || unlock.isPending || remove.isPending;

  // Suspending your own account revokes your own sessions the moment it succeeds. The server has no
  // guard against THAT one, so the screen does not offer the door. Archiving and deleting are
  // different: SA-5 refuses both server-side, for yourself and for the last Super Admin, and the
  // buttons below are disabled to say so before the round trip rather than instead of it.
  const isSelf = myUserId !== null && myUserId === user.id;
  const canEnable = ENABLE_FROM.includes(user.status);
  const canDisable = DISABLE_FROM.includes(user.status) && !isSelf;
  // `archived: []` in the service — there is no transition out, so an archived account is done.
  const canArchive = user.status !== 'archived' && !isSelf;

  const apply = (status: 'active' | 'suspended' | 'archived'): void => {
    changeStatus.mutate(
      { status, version: user.version },
      {
        onSuccess: () => {
          setConfirmDisable(false);
          setConfirmArchive(false);
          toast.success(
            t(
              status === 'active'
                ? 'systemAdmin.users.enabled'
                : status === 'archived'
                  ? 'systemAdmin.users.archived'
                  : 'systemAdmin.users.disabled',
            ),
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
            <Button
              size="sm"
              variant="secondary"
              disabled={!canArchive || busy}
              onClick={() => setConfirmArchive(true)}
            >
              {t('systemAdmin.users.actions.archive')}
            </Button>
          </div>
          {isSelf && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('systemAdmin.users.lifecycle.selfBlocked')}
            </p>
          )}
        </Can>
        {/* Its own permission, and its own row: deleting is not a lifecycle transition, it retires
            the record. `user.delete` is separate from `user.edit` precisely so an administrator can
            be trusted with one and not the other. */}
        <Can permission="user.delete">
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <Button
              size="sm"
              variant="ghost-danger"
              disabled={isSelf || busy}
              onClick={() => setConfirmDelete(true)}
            >
              {t('systemAdmin.users.actions.delete')}
            </Button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('systemAdmin.users.lifecycle.deleteHint')}
            </span>
          </div>
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

      {/* Archiving is TERMINAL — there is no transition out of it — so the confirmation says that
          rather than asking a generic "are you sure?". */}
      <Dialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={t('systemAdmin.users.actions.archive')}
        description={t('systemAdmin.users.confirm.archive')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => apply('archived')}>
              {t('systemAdmin.users.actions.archive')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('systemAdmin.users.confirm.archiveDetail')}
        </p>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('systemAdmin.users.actions.delete')}
        description={t('systemAdmin.users.confirm.delete')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    toast.success(t('systemAdmin.users.deleted'));
                    // The record answers 404 from here on, so staying on its page would show an
                    // error panel for something that just succeeded.
                    navigate('/system/users');
                  },
                })
              }
            >
              {t('systemAdmin.users.actions.delete')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('systemAdmin.users.confirm.deleteDetail')}
        </p>
      </Dialog>
    </Card>
  );
};
