// حسابات بوابة العملاء — the staff screen that gives a customer a login.
//
// It creates a PLATFORM account and hands back a one-time setup link; the customer chooses their
// own password from it. There is deliberately no password field on this screen, and no way to read
// one: everything about being an account — resets, unlock, TOTP, sessions, the audit timeline —
// stays where every other account's does, one link away in System Administration.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { type GoldPortalAccountDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { fmtDate } from '../lib/gold-format';
import {
  useChangeGoldPortalAccountStatus,
  useDeleteGoldPortalAccount,
  useGoldPortalAccounts,
  useResendGoldPortalSetupLink,
} from '../api/gold-queries';
import { PortalAccountDialog } from '../components/PortalAccountDialog';

const PAGE_SIZE = 15;

export const GoldPortalAccountsPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const search = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in updates)) next.delete('page');
    setSp(next);
  };

  const params = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, ...(search === '' ? {} : { search }) }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useGoldPortalAccounts(params);
  const changeStatus = useChangeGoldPortalAccountStatus();
  const remove = useDeleteGoldPortalAccount();
  const resend = useResendGoldPortalSetupLink();

  const [dialog, setDialog] = useState<{ open: boolean; row: GoldPortalAccountDto | null }>({
    open: false,
    row: null,
  });

  const fail = (err: unknown): void => {
    toast.error(err instanceof Error ? err.message : t('common.error'));
  };

  const toggle = async (row: GoldPortalAccountDto): Promise<void> => {
    try {
      await changeStatus.mutateAsync({
        id: row.id,
        body: { status: row.status === 'suspended' ? 'active' : 'suspended', version: row.version },
      });
      toast.success(t('gold.common.saved'));
    } catch (err) {
      fail(err);
    }
  };

  const onDelete = async (row: GoldPortalAccountDto): Promise<void> => {
    if (!window.confirm(t('gold.portalAccounts.deletePrompt', { name: row.fullName }))) return;
    try {
      await remove.mutateAsync(row.id);
      toast.success(t('gold.common.deleted'));
    } catch (err) {
      fail(err);
    }
  };

  const onResend = async (row: GoldPortalAccountDto): Promise<void> => {
    try {
      await resend.mutateAsync(row.id);
      toast.success(t('gold.portalAccounts.linkSent'));
    } catch (err) {
      fail(err);
    }
  };

  const columns: Column<GoldPortalAccountDto>[] = [
    {
      key: 'company',
      header: t('gold.portalAccounts.company'),
      render: (r) => (
        <span className="font-medium text-slate-900 dark:text-slate-50">{r.companyName ?? '—'}</span>
      ),
    },
    { key: 'name', header: t('gold.portalAccounts.contact'), render: (r) => r.fullName },
    { key: 'username', header: t('gold.portalAccounts.username'), render: (r) => r.username ?? '—' },
    {
      key: 'state',
      header: t('gold.common.status'),
      // Two different facts, side by side on purpose: `status` is what WE did to the account,
      // `accountStatus` is how far the customer got with it. "Suspended" and "never activated" are
      // different problems with different answers.
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge
            tone={r.status === 'active' ? 'success' : 'neutral'}
            label={t(`systemAdmin.users.status.${r.status}`)}
          />
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t(`systemAdmin.users.accountStatus.${r.accountStatus}`)}
          </span>
        </span>
      ),
    },
    {
      key: 'lastLogin',
      header: t('gold.portalAccounts.lastLogin'),
      render: (r) => (r.lastLoginAt === null ? '—' : fmtDate(r.lastLoginAt)),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Can permission="goldPortalAccount.edit">
            <Button
              variant="ghost"
              onClick={() => {
                void onResend(r);
              }}
            >
              {t('gold.portalAccounts.resend')}
            </Button>
          </Can>
          <Can permission="goldPortalAccount.edit">
            <Button
              variant="ghost"
              onClick={() => {
                void toggle(r);
              }}
            >
              {r.status === 'suspended'
                ? t('gold.portalAccounts.reactivate')
                : t('gold.portalAccounts.suspend')}
            </Button>
          </Can>
          <Can permission="user.view">
            <Link
              to={`/system/users/${r.id}`}
              className="rounded-lg px-2 py-1 text-sm text-brand-700 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800"
            >
              {t('gold.portalAccounts.manageAccount')}
            </Link>
          </Can>
          <Can permission="goldPortalAccount.delete">
            <Button
              variant="ghost"
              onClick={() => {
                void onDelete(r);
              }}
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('gold.portalAccounts.title')}
        description={t('gold.portalAccounts.subtitle')}
        actions={
          <Can permission="goldPortalAccount.create">
            <Button
              onClick={() => {
                setDialog({ open: true, row: null });
              }}
            >
              <PlusIcon className="h-4 w-4" /> {t('gold.portalAccounts.new')}
            </Button>
          </Can>
        }
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={(value) => {
            patch({ q: value });
          }}
          placeholder={t('gold.portalAccounts.searchPlaceholder')}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => {
          void refetch();
        }}
        empty={
          <p className="py-8 text-center text-sm text-slate-500">
            {t('gold.portalAccounts.empty')}
          </p>
        }
      />
      {data !== undefined && data.meta.totalPages > 1 && (
        <Pagination
          meta={data.meta}
          onPageChange={(next) => {
            patch({ page: String(next) });
          }}
        />
      )}

      {dialog.open && (
        <PortalAccountDialog
          account={dialog.row}
          onClose={() => {
            setDialog({ open: false, row: null });
          }}
        />
      )}
    </PageContainer>
  );
};
