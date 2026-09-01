// المفاتيح — handing drawer keys to customers' delegates.
//
// ONE KEY PER DRAWER is the rule the whole screen is built around: the three counters at the top
// say how many are out, and a drawer whose key is already out cannot have it handed over again
// until it comes back. The server refuses it and names who is holding it.
import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type GoldKeyHandoverDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Dialog } from '../../../shared/ui/Dialog';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatStrip } from '../../../shared/ui/StatStrip';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Field, Select, Textarea, Input } from '../../../shared/ui/form';
import { PrinterIcon, PlusIcon, ResetIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateGoldKey,
  useDeleteGoldKey,
  useGoldKeys,
  useGoldKeysOverview,
  useGoldVaultDrawers,
  useGoldVaults,
  useGoldRepresentatives,
  useReturnGoldKey,
} from '../api/gold-queries';
import { BranchTag } from '../components/BranchTag';
import { useGoldCompanyOptions } from '../components/useGoldCompanyOptions';
import { fmtDateTime, fmtNumber } from '../lib/gold-format';
import { printReceiptHtml } from '../lib/gold-print';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'status',
] as const;

const PAGE_SIZE = 12;

interface SlipData {
  company: string;
  holder: string;
  vault: string;
  drawer: string;
  handedBy: string;
  date: string;
  notes: string;
}

export const GoldKeysPage = (): JSX.Element => {
  const t = useT();
  const me = useAppSelector((state) => state.auth.me);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const status = sp.get('status') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  const params = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, status: status === '' ? undefined : status }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useGoldKeys(params);
  const overview = useGoldKeysOverview();
  const returnKey = useReturnGoldKey();
  const removeKey = useDeleteGoldKey();
  const [creating, setCreating] = useState(false);

  const printSlip = (slip: SlipData): void => {
    const ok = printReceiptHtml({
      title: t('gold.keys.printTitle'),
      number: '',
      meta: [
        [t('gold.keys.company'), slip.company],
        [t('gold.keys.holder'), slip.holder],
        [t('gold.common.vault'), slip.vault],
        [t('gold.common.drawer'), slip.drawer],
        [t('gold.keys.handedBy'), slip.handedBy],
        [t('gold.common.date'), slip.date],
      ],
      footer: slip.notes === '' ? t('gold.keys.printPledge') : slip.notes,
    });
    if (!ok) toast.error(t('gold.common.popupBlocked'));
  };

  const onReturn = async (row: GoldKeyHandoverDto): Promise<void> => {
    const prompt = t('gold.keys.returnPrompt', {
      drawer: row.drawerNumber ?? '—',
      holder: row.representativeName ?? '—',
    });
    if (!window.confirm(prompt)) return;
    try {
      await returnKey.mutateAsync(row.id);
      toast.success(t('gold.keys.returned'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const onDelete = async (row: GoldKeyHandoverDto): Promise<void> => {
    if (!window.confirm(t('gold.keys.deletePrompt'))) return;
    try {
      await removeKey.mutateAsync(row.id);
      toast.success(t('gold.common.deleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const columns: Column<GoldKeyHandoverDto>[] = [
    {
      key: 'holder',
      header: t('gold.keys.holder'),
      render: (k) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {k.representativeName ?? '—'}
          <BranchTag name={k.branchName} />
        </span>
      ),
    },
    { key: 'company', header: t('gold.keys.company'), render: (k) => k.companyName ?? '—' },
    {
      key: 'location',
      header: t('gold.keys.location'),
      render: (k) =>
        `${k.vaultName ?? '—'} / ${t('gold.common.drawerNumber', { number: k.drawerNumber ?? '—' })}`,
    },
    {
      key: 'handedBy',
      header: t('gold.keys.handedBy'),
      render: (k) => k.handedOverByName ?? '—',
    },
    {
      key: 'handoverDate',
      header: t('gold.keys.handoverDate'),
      render: (k) => fmtDateTime(k.handoverDate),
    },
    {
      key: 'status',
      header: t('gold.common.status'),
      render: (k) => (
        <StatusBadge
          tone={k.status === 'active' ? 'success' : 'neutral'}
          label={
            k.status === 'active' ? t('gold.keys.statusActive') : t('gold.keys.statusReturned')
          }
        />
      ),
    },
    {
      key: 'actions',
      header: t('gold.common.actions'),
      align: 'end',
      render: (k) => (
        <div className="flex justify-end gap-1">
          <Can permission="goldKey.print">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('gold.keys.printSlip')}
              onClick={() => {
                printSlip({
                  company: k.companyName ?? '—',
                  holder: k.representativeName ?? '—',
                  vault: k.vaultName ?? '—',
                  drawer: t('gold.common.drawerNumber', { number: k.drawerNumber ?? '—' }),
                  handedBy: k.handedOverByName ?? '—',
                  date: fmtDateTime(k.handoverDate),
                  notes: k.notes ?? '',
                });
              }}
            >
              <PrinterIcon className="h-4 w-4" />
            </Button>
          </Can>
          {k.status === 'active' && (
            <Can permission="goldKey.return">
              <Button
                variant="ghost-warning"
                size="sm"
                aria-label={t('gold.keys.return')}
                onClick={() => {
                  void onReturn(k);
                }}
              >
                <ResetIcon className="h-4 w-4" />
              </Button>
            </Can>
          )}
          <Can permission="goldKey.delete">
            <Button
              variant="ghost-danger"
              size="sm"
              aria-label={t('gold.common.delete')}
              onClick={() => {
                void onDelete(k);
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
        title={t('gold.nav.keys')}
        description={t('gold.keys.subtitle')}
        breadcrumbs={[
          { label: t('gold.module.title'), to: '/gold' },
          { label: t('gold.nav.keys') },
        ]}
        actions={
          <Can permission="goldKey.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setCreating(true);
              }}
            >
              {t('gold.keys.new')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <StatStrip
          items={[
            {
              key: 'handedOver',
              label: t('gold.keys.handedOver'),
              value: fmtNumber(overview.data?.handedOver),
            },
            {
              key: 'notHandedOver',
              label: t('gold.keys.notHandedOver'),
              value: fmtNumber(overview.data?.notHandedOver),
            },
            {
              key: 'totalDrawers',
              label: t('gold.keys.totalDrawers'),
              value: fmtNumber(overview.data?.totalDrawers),
            },
          ]}
        />

        <FilterBar
          hasActiveFilters={status !== ''}
          onClear={() => {
            patch({ status: null });
          }}
        >
          <Select
            value={status}
            onChange={(e) => {
              patch({ status: e.target.value === '' ? null : e.target.value });
            }}
            className="w-auto"
          >
            <option value="">{t('gold.common.allStatuses')}</option>
            <option value="active">{t('gold.keys.statusActive')}</option>
            <option value="returned">{t('gold.keys.statusReturned')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(k) => k.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={t('gold.keys.empty')}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => {
              patch({ page: String(p) }, false);
            }}
          />
        )}
      </div>

      {creating && (
        <KeyHandoverDialog
          onClose={() => {
            setCreating(false);
          }}
          onPrint={printSlip}
          currentUserName={
            me === null ? '' : `${me.name.firstName.ar} ${me.name.lastName.ar}`.trim()
          }
        />
      )}
    </PageContainer>
  );
};

const KeyHandoverDialog = ({
  onClose,
  onPrint,
  currentUserName,
}: {
  onClose: () => void;
  onPrint: (slip: SlipData) => void;
  currentUserName: string;
}): JSX.Element => {
  const t = useT();
  const create = useCreateGoldKey();
  const companies = useGoldCompanyOptions();
  const [companyId, setCompanyId] = useState('');
  const [representativeId, setRepresentativeId] = useState('');
  const [vaultId, setVaultId] = useState('');
  const [drawerId, setDrawerId] = useState('');
  const [notes, setNotes] = useState('');

  const reps = useGoldRepresentatives({ companyId, pageSize: 100 }, companyId !== '');
  const vaults = useGoldVaults({ pageSize: 100 });
  const drawers = useGoldVaultDrawers(vaultId, vaultId !== '');

  const complete = companyId !== '' && representativeId !== '' && vaultId !== '' && drawerId !== '';

  const slip = (): SlipData => ({
    company: companies.find((c) => c.value === companyId)?.label ?? '—',
    holder: reps.data?.items.find((r) => r.id === representativeId)?.fullName ?? '—',
    vault: vaults.data?.items.find((v) => v.id === vaultId)?.name ?? '—',
    drawer:
      drawers.data?.find((d) => d.id === drawerId)?.label ??
      t('gold.common.drawerNumber', { number: '—' }),
    handedBy: currentUserName,
    date: fmtDateTime(new Date().toISOString()),
    notes,
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!complete) return;
    try {
      await create.mutateAsync({
        companyId,
        representativeId,
        vaultId,
        drawerId,
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      });
      toast.success(t('gold.keys.handedOverDone'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('gold.keys.newTitle')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={!complete}
            leftIcon={<PrinterIcon className="h-4 w-4" />}
            onClick={() => {
              onPrint(slip());
            }}
          >
            {t('gold.keys.printSlip')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('gold.common.cancel')}
          </Button>
          <Button
            form="gold-key-form"
            type="submit"
            loading={create.isPending}
            disabled={!complete}
          >
            {t('gold.keys.new')}
          </Button>
        </>
      }
    >
      <form id="gold-key-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('gold.keys.company')} required>
            <Select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setRepresentativeId('');
              }}
              required
            >
              <option value="">{t('gold.representatives.selectCompany')}</option>
              {companies.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('gold.keys.holderPick')} required>
            <Select
              value={representativeId}
              onChange={(e) => {
                setRepresentativeId(e.target.value);
              }}
              disabled={companyId === ''}
              required
            >
              <option value="">
                {companyId === ''
                  ? t('gold.keys.selectCompanyFirst')
                  : t('gold.receiving.selectDelegate')}
              </option>
              {(reps.data?.items ?? []).map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('gold.common.vault')} required>
            <Select
              value={vaultId}
              onChange={(e) => {
                setVaultId(e.target.value);
                setDrawerId('');
              }}
              required
            >
              <option value="">{t('gold.common.select')}</option>
              {(vaults.data?.items ?? []).map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('gold.common.drawer')} required>
            <Select
              value={drawerId}
              onChange={(e) => {
                setDrawerId(e.target.value);
              }}
              disabled={vaultId === ''}
              required
            >
              <option value="">
                {vaultId === '' ? t('gold.keys.selectVaultFirst') : t('gold.common.select')}
              </option>
              {(drawers.data ?? []).map((drawer) => (
                <option key={drawer.id} value={drawer.id}>
                  {t('gold.common.drawerNumber', { number: drawer.number })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('gold.keys.handedByAuto')}>
            <Input value={currentUserName} readOnly disabled />
          </Field>
        </div>
        <Field label={t('gold.common.notes')}>
          <Textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </Field>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('gold.keys.oneKeyHint')}</p>
      </form>
    </Dialog>
  );
};
