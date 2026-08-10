// What one account is allowed to do, and where.
//
// It lives in the roles feature and is rendered by the account screen, because the record it edits
// is a role assignment: putting a copy of the grant list under `users/` would mean two clients for
// one resource, drifting the moment either changes.
//
// The list shows LAPSED grants too, greyed rather than dropped. Expiry is enforced when the
// permission set is computed — there is no cleanup job — so a grant with a past `validTo` is still
// a row in the database, and an administrator asking "why can they not do X" needs to see that the
// grant exists and has ended, not an empty space.
import { useState } from 'react';
import { type Locale, type RoleAssignmentDto, type UserDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Pagination,
  toast,
  type Column,
} from '../../../../shared/ui';
import { formatDate } from '../../../../shared/lib/format';
import { AssignRoleDialog } from './AssignRoleDialog';
import { AssignmentWindowDialog } from './AssignmentWindowDialog';
import { AssignmentScopeBadge } from './AssignmentScopeBadge';
import { ManagedRoleBadge } from './ManagedRoleBadge';
import { useAssignments, useRevokeAssignment } from '../api/role-queries';

const PAGE_SIZE = 25;

/** A grant whose window has closed still exists; it simply grants nothing today. */
const isLapsed = (assignment: RoleAssignmentDto, now: number): boolean =>
  (assignment.validTo !== null && Date.parse(assignment.validTo) < now) ||
  (assignment.validFrom !== null && Date.parse(assignment.validFrom) > now);

export const UserRolesTab = ({ user }: { user: UserDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const [page, setPage] = useState(1);
  const [granting, setGranting] = useState(false);
  const [editing, setEditing] = useState<RoleAssignmentDto | null>(null);

  const mayView = can('role.view');
  const mayAssign = can('role.assign');
  const assignments = useAssignments({ userId: user.id, page, pageSize: PAGE_SIZE }, mayView);
  const revoke = useRevokeAssignment();

  if (!mayView) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('systemAdmin.assignments.noAccess')}
          </p>
        </CardBody>
      </Card>
    );
  }

  const rows = assignments.data?.items ?? [];
  const now = Date.now();

  const columns: Column<RoleAssignmentDto>[] = [
    {
      key: 'role',
      header: t('systemAdmin.assignments.role'),
      render: (a) => (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-medium text-slate-800 dark:text-slate-100">
            {/* `role` is resolved server-side for the page; null means the role was deleted out
                from under the grant, which the raw id is the only honest thing to show for. */}
            {a.role === null ? a.roleId : a.role.name[locale]}
          </span>
          {a.role !== null && <ManagedRoleBadge managed={a.role.managed} />}
          {isLapsed(a, now) && (
            <Badge size="sm" tone="neutral">
              {t('systemAdmin.assignments.lapsed')}
            </Badge>
          )}
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
        mayAssign ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
              {t('systemAdmin.assignments.editWindow')}
            </Button>
            <Button
              size="sm"
              variant="ghost-danger"
              disabled={revoke.isPending}
              onClick={() =>
                revoke.mutate(a.id, {
                  onSuccess: () => toast.success(t('systemAdmin.assignments.revoked')),
                })
              }
            >
              {t('systemAdmin.assignments.revoke')}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Card>
      <CardHeader
        title={t('systemAdmin.assignments.title')}
        description={t('systemAdmin.assignments.hint')}
        actions={
          mayAssign ? (
            <Button size="sm" onClick={() => setGranting(true)}>
              {t('systemAdmin.assignments.grant')}
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          loading={assignments.isLoading}
          error={assignments.isError ? assignments.error : undefined}
          onRetry={() => void assignments.refetch()}
          empty={<EmptyState title={t('systemAdmin.assignments.empty')} />}
          embedded
        />
        {assignments.data !== undefined && assignments.data.meta.totalItems > 0 && (
          <div className="pt-4">
            <Pagination meta={assignments.data.meta} onPageChange={setPage} />
          </div>
        )}
      </CardBody>

      {granting && (
        <AssignRoleDialog
          user={user}
          heldRoleIds={rows.map((a) => a.roleId)}
          onClose={() => setGranting(false)}
        />
      )}
      {editing !== null && (
        <AssignmentWindowDialog
          key={`${editing.id}:${String(editing.version)}`}
          assignment={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
};
