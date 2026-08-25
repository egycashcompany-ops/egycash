// الخزائن — the visual board.
//
// Every vault in the branch, drawn as its real grid, grouped by floor. Each drawer shows how full
// it is against its limit, and whether its key is out. This screen is how an operator finds space
// and how a supervisor sees, in one look, which drawers are over their limit — so the fill colours
// and the key dots are the whole point of it and are carried over exactly.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { type GoldDrawerDto, type GoldVaultDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Checkbox } from '../../../shared/ui/form';
import { ClipboardIcon, CogIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useGoldDrawer,
  useGoldFloors,
  useGoldKeysOverview,
  useGoldVaultDrawers,
  useGoldVaults,
} from '../api/gold-queries';
import { BranchTag } from '../components/BranchTag';
import { DrawerCell } from '../components/DrawerCell';
import { KeyIcon } from '../components/GoldIcons';
import { useGoldCompanyOptions } from '../components/useGoldCompanyOptions';
import { companyColor, fillColor, fmtWeightValue } from '../lib/gold-format';
import { printDrawerAuditHtml } from '../lib/gold-print';
import { metalLabel } from '../components/gold-labels';

const CELL = 88;

interface KeyMap {
  [drawerId: string]: { holder: string; company: string };
}

const VaultBlock = ({
  vault,
  keys,
  showOwners,
  ownerFilter,
  onSelect,
}: {
  vault: GoldVaultDto;
  keys: KeyMap;
  showOwners: boolean;
  ownerFilter: string[];
  onSelect: (drawer: GoldDrawerDto) => void;
}): JSX.Element => {
  const t = useT();
  const { data: drawers = [] } = useGoldVaultDrawers(vault.id);
  const cols = vault.layout?.cols ?? 5;

  // The grid is drawn from the drawers' PHYSICAL positions, so what the screen shows is the wall.
  const matrix = useMemo(() => {
    const byPosition = new Map<string, GoldDrawerDto>();
    let maxRow = 0;
    for (const drawer of drawers) {
      byPosition.set(`${String(drawer.row)},${String(drawer.col)}`, drawer);
      if (drawer.row > maxRow) maxRow = drawer.row;
    }
    const rows: (GoldDrawerDto | null)[][] = [];
    for (let r = 0; r <= maxRow; r += 1) {
      const row: (GoldDrawerDto | null)[] = [];
      for (let c = 0; c < cols; c += 1)
        row.push(byPosition.get(`${String(r)},${String(c)}`) ?? null);
      rows.push(row);
    }
    return rows;
  }, [drawers, cols]);

  const totalWeight = drawers.reduce((sum, d) => sum + d.totalWeight, 0);
  const vaultMax = Math.max(0, ...drawers.map((d) => d.totalWeight));

  return (
    <div className="shrink-0 rounded-lg border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between gap-4">
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          {vault.name}
          <BranchTag name={vault.branchName} />
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {t('gold.vaults.drawerCount', {
            count: drawers.length,
            weight: t('gold.common.grams', { value: fmtWeightValue(totalWeight) }),
          })}
        </span>
      </div>
      {drawers.length === 0 ? (
        <p className="w-64 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {t('gold.vaults.noDrawers')}
        </p>
      ) : (
        <div className="space-y-1.5">
          {matrix.map((row, rowIndex) => (
            <div key={`row-${String(rowIndex)}`} className="flex gap-1.5">
              {row.map((drawer, colIndex) => {
                const matches =
                  drawer !== null &&
                  (ownerFilter.length === 0 ||
                    drawer.companies.some((owner) => ownerFilter.includes(owner.id)));
                if (drawer === null || !matches) {
                  return (
                    <div
                      key={`cell-${String(rowIndex)}-${String(colIndex)}`}
                      className="shrink-0 rounded-xl border border-dashed border-slate-200 dark:border-slate-800"
                      style={{
                        width: CELL,
                        minHeight: CELL,
                        alignSelf: 'stretch',
                        ...(showOwners ? {} : { height: CELL }),
                      }}
                    />
                  );
                }
                const key = keys[drawer.id];
                return (
                  <DrawerCell
                    key={drawer.id}
                    number={drawer.number}
                    weight={drawer.totalWeight}
                    limit={drawer.weightLimit}
                    barsCount={drawer.barsCount}
                    owners={drawer.companies}
                    size={CELL}
                    vaultMax={vaultMax}
                    showOwners={showOwners}
                    keyHolder={key === undefined ? null : key.holder}
                    ownerColor={companyColor}
                    title={`${t('gold.common.drawerNumber', { number: drawer.number })} · ${t('gold.common.grams', { value: fmtWeightValue(drawer.totalWeight) })} · ${t('gold.common.barsCount', { count: drawer.barsCount })}`}
                    keyTitle={
                      key === undefined
                        ? t('gold.vaults.keyFree')
                        : t('gold.vaults.keyHeldBy', { holder: key.holder, company: key.company })
                    }
                    onClick={() => {
                      onSelect(drawer);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const DrawerDialog = ({
  drawerId,
  branchName,
  onClose,
}: {
  drawerId: string;
  branchName: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const { data, isLoading } = useGoldDrawer(drawerId);

  const owners = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; weight: number }>();
    for (const bar of data?.bars ?? []) {
      if (bar.companyId === null) continue;
      const entry = map.get(bar.companyId) ?? {
        id: bar.companyId,
        name: bar.companyName ?? '؟',
        count: 0,
        weight: 0,
      };
      entry.count += 1;
      entry.weight += bar.weight;
      map.set(bar.companyId, entry);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [data]);

  const audit = (): void => {
    const ok = printDrawerAuditHtml({
      drawerNumber: data?.drawer.number ?? null,
      company: owners[0]?.name ?? '',
      branch: branchName,
      bars: (data?.bars ?? []).map((bar) => ({ metalType: bar.metalType, weight: bar.weight })),
      metalLabel: (metal) => metalLabel(t, metal),
    });
    if (!ok) toast.error(t('gold.common.popupBlocked'));
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        data === undefined
          ? t('gold.vaults.drawerDetails')
          : t('gold.vaults.drawerTitle', { number: data.drawer.number })
      }
      size="lg"
    >
      {isLoading && <LoadingState />}
      {data !== undefined && (
        <div className="space-y-4">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ClipboardIcon className="h-4 w-4" />}
            onClick={audit}
          >
            {t('gold.vaults.drawerAudit')}
          </Button>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-slate-500 dark:text-slate-400">
                {t('gold.vaults.drawerNo')}:{' '}
              </span>
              {data.drawer.number}
            </span>
            <span>
              <span className="text-slate-500 dark:text-slate-400">{t('gold.common.bars')}: </span>
              {data.bars.length}
            </span>
            <span>
              <span className="text-slate-500 dark:text-slate-400">
                {t('gold.common.weight')}:{' '}
              </span>
              {t('gold.common.grams', { value: fmtWeightValue(data.drawer.totalWeight) })}
            </span>
            {data.drawer.weightLimit > 0 && (
              <span>
                <span className="text-slate-500 dark:text-slate-400">
                  {t('gold.vaults.drawerLimit')}:{' '}
                </span>
                {t('gold.common.grams', { value: fmtWeightValue(data.drawer.weightLimit) })} (
                {Math.round((data.drawer.totalWeight / data.drawer.weightLimit) * 100)}%)
              </span>
            )}
          </div>

          {owners.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">
                {t('gold.vaults.drawerOwners')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {owners.map((owner) => (
                  <span
                    key={owner.id}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold"
                    style={{ background: companyColor(owner.id), color: '#16110a' }}
                    title={`${owner.name} — ${t('gold.common.grams', { value: fmtWeightValue(owner.weight) })}`}
                  >
                    {owner.name}
                    <span className="rounded-md bg-black/20 px-1.5 py-0.5 text-[10px]">
                      {owner.count}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.bars.length === 0 ? (
            <p className="py-8 text-center text-slate-500 dark:text-slate-400">
              {t('gold.vaults.drawerEmpty')}
            </p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {data.bars.map((bar) => (
                <li
                  key={bar.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-900 dark:text-slate-100">
                      {bar.serialNumber}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {bar.companyName ?? '—'}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-slate-600 dark:text-slate-300">
                    {t('gold.common.grams', { value: fmtWeightValue(bar.weight) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
};

const LegendSwatch = ({ colour, label }: { colour: string; label: string }): JSX.Element => (
  <span className="flex items-center gap-1.5">
    <span className="h-3 w-3 rounded" style={{ background: colour }} />
    {label}
  </span>
);

export const GoldVaultsBoardPage = (): JSX.Element => {
  const t = useT();
  const vaults = useGoldVaults({ pageSize: 100, sortBy: 'order', sortDir: 'asc' });
  const floors = useGoldFloors();
  const keysOverview = useGoldKeysOverview();
  const owners = useGoldCompanyOptions();
  const [showOwners, setShowOwners] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<GoldDrawerDto | null>(null);

  const keyMap: KeyMap = keysOverview.data?.byDrawer ?? {};
  const list = vaults.data?.items ?? [];

  // Vaults grouped by floor, in the administrator's own order, with the unassigned ones last.
  const groups = useMemo(() => {
    const sortedFloors = [...(floors.data ?? [])].sort((a, b) => a.order - b.order);
    const result = sortedFloors.map((floor) => ({
      floor,
      vaults: list.filter((vault) => vault.floorId === floor.id),
    }));
    const orphans = list.filter((vault) => vault.floorId === null);
    if (orphans.length > 0) result.push({ floor: null as never, vaults: orphans });
    return result.filter((group) => group.vaults.length > 0);
  }, [floors.data, list]);

  if (vaults.isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }

  // A failed request is not an empty vault.
  //
  // This page had no error branch at all: it guarded `isLoading`, read `data?.items ?? []`, and a
  // settled failure — which leaves `isLoading` false and `data` undefined — fell straight through
  // to the empty state. So a board that could not be loaded was drawn as a company with no
  // vaults, which is a claim about the business, not about the network.
  if (vaults.isError) {
    return (
      <PageContainer>
        <ErrorState error={vaults.error} onRetry={() => void vaults.refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('gold.nav.vaults')}
        description={t('gold.vaults.subtitle')}
        breadcrumbs={[
          { label: t('gold.module.title'), to: '/gold' },
          { label: t('gold.nav.vaults') },
        ]}
        actions={
          <Can permission="goldVault.edit">
            <Link to="/gold/vault-settings">
              <Button variant="secondary" size="sm" leftIcon={<CogIcon className="h-4 w-4" />}>
                {t('gold.vaults.settingsLink')}
              </Button>
            </Link>
          </Can>
        }
      />

      {/*
        The key overlay is not the board, so its failure must not blank the board — but it must not
        pass unremarked either. `keyMap` falls back to `{}`, and an empty key map draws every drawer
        as NOT handed over: the same picture a vault with all its keys in the safe would draw. That
        is the one wrong answer a custodian must never be given silently.
      */}
      {keysOverview.isError && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
          {t('gold.vaults.keyOverlayFailed')}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <LegendSwatch colour={fillColor(0)} label={t('gold.vaults.legendEmpty')} />
        <LegendSwatch colour={fillColor(0.15)} label={t('gold.vaults.legendLow')} />
        <LegendSwatch colour={fillColor(0.5)} label={t('gold.vaults.legendMid')} />
        <LegendSwatch colour={fillColor(0.9)} label={t('gold.vaults.legendHigh')} />
        <LegendSwatch colour={fillColor(1.1)} label={t('gold.vaults.legendOver')} />
        <span className="flex items-center gap-1.5 border-s border-slate-200 ps-3 dark:border-slate-700">
          <KeyIcon className="h-3.5 w-3.5" style={{ color: '#2f9e5f' }} />
          {t('gold.vaults.keyOut')}
        </span>
        <span className="flex items-center gap-1.5">
          <KeyIcon className="h-3.5 w-3.5" style={{ color: '#c0392b' }} />
          {t('gold.vaults.keyIn')}
        </span>
        <span className="border-s border-slate-200 ps-3 dark:border-slate-700">
          <Checkbox
            label={t('gold.vaults.showOwners')}
            checked={showOwners}
            onChange={(e) => {
              setShowOwners(e.target.checked);
            }}
          />
        </span>
        <span className="border-s border-slate-200 ps-3 dark:border-slate-700">
          <MultiSelect
            label={t('gold.vaults.filterByOwner')}
            options={owners}
            value={ownerFilter}
            onChange={setOwnerFilter}
          />
        </span>
      </div>

      {list.length === 0 ? (
        <EmptyState title={t('gold.vaults.empty')} description={t('gold.vaults.emptyHint')} />
      ) : (
        <div className="space-y-6">
          {groups.map((group, index) => (
            <div key={group.floor === null ? `unassigned-${String(index)}` : group.floor.id}>
              {group.floor !== null && (
                <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                  {group.floor.name}
                  <BranchTag name={group.floor.branchName} />
                </h2>
              )}
              <div className="flex gap-4 overflow-x-auto pb-2">
                {group.vaults.map((vault) => (
                  <VaultBlock
                    key={vault.id}
                    vault={vault}
                    keys={keyMap}
                    showOwners={showOwners}
                    ownerFilter={ownerFilter}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected !== null && (
        <DrawerDialog
          drawerId={selected.id}
          branchName={list.find((vault) => vault.id === selected.vaultId)?.branchName ?? ''}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}
    </PageContainer>
  );
};
