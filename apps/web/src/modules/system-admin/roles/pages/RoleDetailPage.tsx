// One role: what it grants, and who holds it.
//
// "Disable this role" is the Users tab's revoke-all action, because that is what disabling a role
// IS — there is no status field and adding one would put a second switch inside the authorization
// path. The revocations are issued one at a time on purpose: each is independently authorized,
// independently audited, and independently refused when it would remove the last Super Admin. A
// single bulk endpoint would have to re-implement all three, and a partial result here is not a
// broken state — it is exactly the set of grants that could legitimately be removed.
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type Locale, type RoleAssignmentDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can, useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { ActorById } from '../../../../platform/directory';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  toast,
  type Column,
} from '../../../../shared/ui';
import { cn } from '../../../../shared/lib/cn';
import { formatDate } from '../../../../shared/lib/format';
import { ManagedRoleBadge } from '../components/ManagedRoleBadge';
import { RoleFormDialog } from '../components/RoleFormDialog';
import { RolePermissionMatrix } from '../components/RolePermissionMatrix';
import { AssignmentScopeBadge } from '../components/AssignmentScopeBadge';
import {
  useAssignments,
  useDeleteRole,
  usePermissionCatalog,
  usePermissionPages,
  useRevokeAssignment,
  useRole,
} from '../api/role-queries';
import { listAssignments, revokeAssignment } from '../api/role-api';
import { revokeAllAssignments } from '../lib/revoke-all';
import { duplicateBlocker } from '../lib/role-duplication';

const TABS = ['permissions', 'users'] as const;
type Tab = (typeof TABS)[number];
const DEFAULT_PAGE_SIZE = 25;

export const RoleDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const can = useCan();
  const { id = '' } = useParams<{ id: string }>();
  const [sp, setSp] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);
  const [revoking, setRevoking] = useState<RoleAssignmentDto | null>(null);

  const tabParam = sp.get('tab');
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'permissions';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);

  const { data: role, isLoading, isError, error, refetch } = useRole(id);
  const { data: catalog = [] } = usePermissionCatalog(can('permission.view'));
  const { data: pages = [] } = usePermissionPages(can('permission.view'));
  const assignments = useAssignments({ roleId: id, page, pageSize: DEFAULT_PAGE_SIZE }, id !== '');
  const revoke = useRevokeAssignment();
  const removeRole = useDeleteRole(id);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || role === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const setTab = (next: Tab): void => {
    const params = new URLSearchParams(sp);
    if (next === 'permissions') params.delete('tab');
    else params.set('tab', next);
    params.delete('page');
    setSp(params, { replace: true });
  };

  const patchPage = (next: number): void => {
    const params = new URLSearchParams(sp);
    params.set('page', String(next));
    setSp(params);
  };

  /**
   * Revoke every grant of this role, one call at a time. Each refusal is reported rather than
   * swallowed: "revoked 6 of 7" is the honest answer when the seventh is the last Super Admin.
   * The loop itself lives in `lib/revoke-all` — its termination is the whole of it, and a hang is
   * not something a render test would catch.
   */
  const revokeAll = async (): Promise<void> => {
    setRevokingAll(true);
    try {
      // Re-read rather than trusting the page on screen — the list may be paginated.
      const { removed, refused } = await revokeAllAssignments(
        (page) => listAssignments({ roleId: id, page, pageSize: DEFAULT_PAGE_SIZE }),
        revokeAssignment,
      );
      toast.success(t('systemAdmin.roles.revokedAll', { removed, refused }));
    } finally {
      setRevokingAll(false);
      setConfirmRevokeAll(false);
      await assignments.refetch();
    }
  };

  const columns: Column<RoleAssignmentDto>[] = [
    {
      key: 'userId',
      header: t('systemAdmin.roles.users.holder'),
      // "Who holds this role" and "what else does that account hold" are the same investigation, and
      // it used to end here: the name was rendered by `ActorById`, whose click opens the platform
      // profile drawer — a read-only card that is not this module's to change. A real link to the
      // administration screen sits beside it, so the trail continues without the drawer moving.
      render: (a) => (
        <div className="flex min-w-0 items-center gap-2">
          <ActorById userId={a.userId} />
          <Link
            to={`/system/users/${a.userId}`}
            title={t('systemAdmin.roles.users.openAccount')}
            aria-label={t('systemAdmin.roles.users.openAccount')}
            className="shrink-0 rounded text-xs font-medium text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300"
          >
            {t('systemAdmin.roles.users.openAccount')}
          </Link>
        </div>
      ),
    },
    {
      key: 'scope',
      header: t('systemAdmin.assignments.scope'),
      render: (a) => <AssignmentScopeBadge scope={a.scope} />,
    },
    {
      key: 'validity',
      header: t('systemAdmin.assignments.validity'),
      render: (a) => (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {a.validFrom === null && a.validTo === null
            ? t('systemAdmin.assignments.always')
            : `${a.validFrom === null ? '—' : formatDate(a.validFrom, locale)} → ${
                a.validTo === null ? '—' : formatDate(a.validTo, locale)
              }`}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (a) =>
        can('role.assign') ? (
          <Button
            size="sm"
            variant="ghost-danger"
            disabled={revoke.isPending || revokingAll}
            onClick={() => setRevoking(a)}
          >
            {t('systemAdmin.assignments.revoke')}
          </Button>
        ) : null,
    },
  ];

  const holders = assignments.data?.items ?? [];
  // The TOTAL, not the page: a role held by 30 accounts shows 25 rows, and deleting it must still
  // be refused. `meta.totalItems` is the count the server computed for the same filter.
  const holderCount = assignments.data?.meta.totalItems ?? 0;
  // Whether this role can be copied AT ALL, and by THIS actor. Computed here rather than inside the
  // dialog so the answer is visible before the dialog opens — the server refuses either way.
  const blocker = duplicateBlocker(role, catalog, can);

  return (
    <PageContainer>
      <PageHeader
        title={role.name[locale]}
        {...(role.description === null ? {} : { description: role.description })}
        breadcrumbs={[
          { label: t('systemAdmin.module.title') },
          { label: t('systemAdmin.roles.title'), to: '/system/roles' },
          { label: role.name[locale] },
        ]}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <ManagedRoleBadge managed={role.managed} />
            <Badge size="sm" tone="neutral">
              {t('systemAdmin.roles.permissionCount', { count: role.permissionKeys.length })}
            </Badge>
          </div>
        }
        actions={
          role.managed === 'none' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Can permission="role.edit">
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  {t('systemAdmin.roles.actions.edit')}
                </Button>
              </Can>
              {/* Duplicating is creating, so it is gated on `role.create` rather than `role.edit` —
                  and refused OUTRIGHT when the copy could not be made whole. A partial copy would
                  succeed, look right, and quietly grant less than the role it is named after. */}
              <Can permission="role.create">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={blocker !== null}
                  title={
                    blocker === null
                      ? undefined
                      : t(
                          blocker.reason === 'unknown-keys'
                            ? 'systemAdmin.roles.duplicateBlockedUnknown'
                            : 'systemAdmin.roles.duplicateBlockedNotHeld',
                          { keys: blocker.keys.join(', ') },
                        )
                  }
                  onClick={() => setDuplicating(true)}
                >
                  {t('systemAdmin.roles.actions.duplicate')}
                </Button>
              </Can>
              {/* Offered only while nobody holds it. The server refuses a held role anyway
                  ("revoke them first"), so a button that looked available would be a promise the
                  click breaks — the same reasoning the permission matrix applies to a locked grant. */}
              <Can permission="role.delete">
                <Button
                  size="sm"
                  variant="ghost-danger"
                  disabled={holderCount > 0 || removeRole.isPending}
                  title={holderCount > 0 ? t('systemAdmin.roles.deleteBlocked') : undefined}
                  onClick={() => setConfirmDelete(true)}
                >
                  {t('systemAdmin.roles.actions.delete')}
                </Button>
              </Can>
            </div>
          ) : undefined
        }
      />

      {editing && (
        <RoleFormDialog
          key={`${role.id}:${String(role.version)}`}
          open
          role={role}
          onClose={() => setEditing(false)}
        />
      )}

      {/* `role={null}` is the whole point: this is a CREATE, pre-filled. It goes to `createRole`
          and through every guard a hand-built role passes. */}
      {duplicating && (
        <RoleFormDialog
          key={`duplicate:${role.id}:${String(role.version)}`}
          open
          role={null}
          duplicateOf={role}
          onClose={() => setDuplicating(false)}
          onCreated={(created) => navigate(`/system/roles/${created.id}`)}
        />
      )}

      <div
        className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
        aria-label={t('systemAdmin.roles.title')}
      >
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              '-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === name
                ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
            )}
          >
            {t(`systemAdmin.roles.tabs.${name}`)}
          </button>
        ))}
      </div>

      {tab === 'permissions' &&
        (can('permission.view') ? (
          <RolePermissionMatrix
            catalog={catalog}
            pages={pages}
            selected={role.permissionKeys}
            managed={role.managed}
          />
        ) : (
          <Card>
            <CardBody>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('systemAdmin.permissions.noAccess')}
              </p>
            </CardBody>
          </Card>
        ))}

      {tab === 'users' && (
        <Card>
          <CardHeader
            title={t('systemAdmin.roles.users.title')}
            description={t('systemAdmin.roles.users.hint')}
            actions={
              can('role.assign') && holders.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost-danger"
                  disabled={revokingAll}
                  onClick={() => setConfirmRevokeAll(true)}
                >
                  {t('systemAdmin.roles.actions.revokeAll')}
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            <DataTable
              columns={columns}
              rows={holders}
              rowKey={(a) => a.id}
              loading={assignments.isLoading}
              error={assignments.isError ? assignments.error : undefined}
              onRetry={() => void assignments.refetch()}
              empty={<EmptyState title={t('systemAdmin.roles.users.empty')} />}
              embedded
            />
            {assignments.data !== undefined && assignments.data.meta.totalItems > 0 && (
              <div className="pt-4">
                <Pagination meta={assignments.data.meta} onPageChange={patchPage} />
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Dialog
        open={confirmRevokeAll}
        onClose={() => setConfirmRevokeAll(false)}
        size="sm"
        title={t('systemAdmin.roles.actions.revokeAll')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmRevokeAll(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={revokingAll}
              onClick={() => void revokeAll()}
            >
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('systemAdmin.roles.confirmRevokeAll')}
        </p>
      </Dialog>

      {/* Same three facts the account-side dialog states — WHO, WHICH role, at WHAT reach — but the
          holder is a row of ids here, not a loaded account, so the name comes from the directory
          component the table already uses rather than from an interpolated string. */}
      <Dialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        size="sm"
        title={t('systemAdmin.assignments.revoke')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRevoking(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={revoke.isPending}
              onClick={() => {
                if (revoking === null) return;
                revoke.mutate(revoking.id, {
                  onSuccess: () => {
                    setRevoking(null);
                    toast.success(t('systemAdmin.assignments.revoked'));
                  },
                });
              }}
            >
              {t('systemAdmin.assignments.revoke')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('systemAdmin.roles.users.confirmRevoke', {
            role: role.name[locale],
            scope: t(`systemAdmin.assignments.scopes.${revoking?.scope ?? 'own'}`),
          })}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500 dark:text-slate-400">
            {t('systemAdmin.roles.users.holder')}:
          </span>
          {revoking !== null && <ActorById userId={revoking.userId} />}
          {revoking !== null && <AssignmentScopeBadge scope={revoking.scope} />}
        </div>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title={t('systemAdmin.roles.actions.delete')}
        description={t('systemAdmin.roles.confirmDelete')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={removeRole.isPending}
              onClick={() =>
                removeRole.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    toast.success(t('systemAdmin.roles.deleted'));
                    navigate('/system/roles');
                  },
                })
              }
            >
              {t('systemAdmin.roles.actions.delete')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('systemAdmin.roles.confirmDeleteDetail')}
        </p>
      </Dialog>

      <div className="mt-6">
        <Button size="sm" variant="ghost" onClick={() => navigate('/system/roles')}>
          {t('systemAdmin.roles.backToList')}
        </Button>
      </div>
    </PageContainer>
  );
};
