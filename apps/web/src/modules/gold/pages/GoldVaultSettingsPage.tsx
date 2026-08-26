// إعدادات الخزائن — creating vaults and floors, and laying out the drawer numbering.
//
// The layout dialog is where the module's most consequential decision is taken, and the screen is
// built to make the difference visible:
//
//   GENERATE deletes every drawer and creates them fresh. It is refused while the vault holds
//   bars, because the drawers those bars sit in would be gone.
//   SAVE LAYOUT (reshape) moves the existing drawers instead, keeping their numbers and their
//   contents — which is only possible with the same drawer count and the same starting number.
//
// The panel says which one is available and why, so the choice is never made by accident.
import { useState } from 'react';
import {
  type GenerateGoldLayout,
  type GoldLayoutPreviewDto,
  type GoldVaultDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Button } from '../../../shared/ui/Button';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Dialog } from '../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { ChevronIcon, PlusIcon, TrashIcon, EditIcon, CogIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateGoldFloor,
  useCreateGoldVault,
  useDeleteGoldFloor,
  useDeleteGoldVault,
  useGenerateGoldLayout,
  useGoldFloors,
  useGoldVaults,
  usePreviewGoldLayout,
  useReorderGoldFloors,
  useReorderGoldVaults,
  useReshapeGoldLayout,
  useUpdateGoldFloor,
  useUpdateGoldVault,
} from '../api/gold-queries';
import { BranchTag } from '../components/BranchTag';
import { fmtWeightValue } from '../lib/gold-format';

const DEFAULT_LAYOUT: GenerateGoldLayout = {
  rows: 4,
  cols: 5,
  orientation: 'horizontal',
  horizontalDirection: 'rtl',
  verticalDirection: 'ttb',
  startNumber: 1,
  drawerWeightLimit: 5000,
};

export const GoldVaultSettingsPage = (): JSX.Element => {
  const t = useT();
  const vaultsQuery = useGoldVaults({ pageSize: 100, sortBy: 'order', sortDir: 'asc' });
  const floorsQuery = useGoldFloors();
  const createVault = useCreateGoldVault();
  const updateVault = useUpdateGoldVault();
  const deleteVault = useDeleteGoldVault();
  const reorderVaults = useReorderGoldVaults();
  const createFloor = useCreateGoldFloor();
  const updateFloor = useUpdateGoldFloor();
  const reorderFloors = useReorderGoldFloors();
  const deleteFloor = useDeleteGoldFloor();

  const vaults = vaultsQuery.data?.items ?? [];
  const floors = [...(floorsQuery.data ?? [])].sort((a, b) => a.order - b.order);

  const [vaultDialog, setVaultDialog] = useState<{ open: boolean; vault: GoldVaultDto | null }>({
    open: false,
    vault: null,
  });
  const [layoutVault, setLayoutVault] = useState<GoldVaultDto | null>(null);
  const [floorDialog, setFloorDialog] = useState(false);
  const [floorName, setFloorName] = useState('');

  const fail = (err: unknown): void => {
    toast.error(err instanceof Error ? err.message : t('common.error'));
  };

  /** ▲▼ swap two neighbours' order values — the gold reorder, one pair at a time. */
  const move = async (index: number, direction: -1 | 1, kind: 'vault' | 'floor'): Promise<void> => {
    const list = kind === 'vault' ? vaults : floors;
    const target = index + direction;
    const a = list[index];
    const b = list[target];
    if (a === undefined || b === undefined) return;
    const items = [
      { id: a.id, order: target },
      { id: b.id, order: index },
    ];
    try {
      if (kind === 'vault') await reorderVaults.mutateAsync({ items });
      else await reorderFloors.mutateAsync({ items });
    } catch (err) {
      fail(err);
    }
  };

  const removeVault = async (vault: GoldVaultDto): Promise<void> => {
    if (!window.confirm(t('gold.vaultSettings.deleteVault', { name: vault.name }))) return;
    try {
      await deleteVault.mutateAsync(vault.id);
      toast.success(t('gold.common.deleted'));
    } catch (err) {
      fail(err);
    }
  };

  if (vaultsQuery.isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }

  // Without this the settings screen answered a failed request with "no vaults configured yet" —
  // and this is the screen you would then use to create one that already exists.
  if (vaultsQuery.isError) {
    return (
      <PageContainer>
        <ErrorState error={vaultsQuery.error} onRetry={() => void vaultsQuery.refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('gold.nav.vaultSettings')}
        description={t('gold.vaultSettings.subtitle')}
        breadcrumbs={[
          { label: t('gold.module.title'), to: '/gold' },
          { label: t('gold.nav.vaults'), to: '/gold/vaults' },
          { label: t('gold.nav.vaultSettings') },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title={t('gold.vaultSettings.floors')}
            actions={
              <Can permission="goldVault.create">
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<PlusIcon className="h-4 w-4" />}
                  onClick={() => {
                    setFloorName('');
                    setFloorDialog(true);
                  }}
                >
                  {t('gold.vaultSettings.floor')}
                </Button>
              </Can>
            }
          />
          <CardBody>
            {floors.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('gold.vaultSettings.noFloors')}
              </p>
            ) : (
              <ul className="space-y-2">
                {floors.map((floor, index) => (
                  <li
                    key={floor.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
                  >
                    <span className="flex flex-col">
                      <button
                        type="button"
                        aria-label={t('gold.vaultSettings.moveUp')}
                        disabled={index === 0}
                        onClick={() => void move(index, -1, 'floor')}
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-20 dark:hover:text-slate-200"
                      >
                        <ChevronIcon className="h-3.5 w-3.5 rotate-180" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('gold.vaultSettings.moveDown')}
                        disabled={index === floors.length - 1}
                        onClick={() => void move(index, 1, 'floor')}
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-20 dark:hover:text-slate-200"
                      >
                        <ChevronIcon className="h-3.5 w-3.5" />
                      </button>
                    </span>
                    <Input
                      defaultValue={floor.name}
                      className="flex-1 py-1.5"
                      onBlur={(e) => {
                        if (e.target.value !== floor.name && e.target.value.trim() !== '') {
                          void updateFloor
                            .mutateAsync({
                              id: floor.id,
                              body: { name: e.target.value.trim(), version: floor.version },
                            })
                            .catch(fail);
                        }
                      }}
                    />
                    <BranchTag name={floor.branchName} />
                    <Can permission="goldVault.delete">
                      <Button
                        variant="ghost-danger"
                        size="sm"
                        aria-label={t('gold.common.delete')}
                        onClick={() => {
                          if (
                            window.confirm(
                              t('gold.vaultSettings.deleteFloor', { name: floor.name }),
                            )
                          ) {
                            void deleteFloor.mutateAsync(floor.id).catch(fail);
                          }
                        }}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </Can>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={t('gold.vaultSettings.vaults')}
            actions={
              <Can permission="goldVault.create">
                <Button
                  size="sm"
                  leftIcon={<PlusIcon className="h-4 w-4" />}
                  onClick={() => {
                    setVaultDialog({ open: true, vault: null });
                  }}
                >
                  {t('gold.vaultSettings.vault')}
                </Button>
              </Can>
            }
          />
          <CardBody>
            {vaults.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('gold.vaultSettings.noVaults')}
              </p>
            ) : (
              <ul className="space-y-2">
                {vaults.map((vault, index) => (
                  <li
                    key={vault.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                  >
                    <span className="flex flex-col">
                      <button
                        type="button"
                        aria-label={t('gold.vaultSettings.moveUp')}
                        disabled={index === 0}
                        onClick={() => void move(index, -1, 'vault')}
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-20 dark:hover:text-slate-200"
                      >
                        <ChevronIcon className="h-4 w-4 rotate-180" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('gold.vaultSettings.moveDown')}
                        disabled={index === vaults.length - 1}
                        onClick={() => void move(index, 1, 'vault')}
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-20 dark:hover:text-slate-200"
                      >
                        <ChevronIcon className="h-4 w-4" />
                      </button>
                    </span>
                    <span className="min-w-[140px] flex-1">
                      <span className="block font-medium text-slate-900 dark:text-slate-100">
                        {vault.name}
                        <BranchTag name={vault.branchName} />
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {vault.drawerCount > 0
                          ? t('gold.vaultSettings.drawersLabel', { count: vault.drawerCount })
                          : t('gold.vaultSettings.noDrawersLabel')}
                        {vault.layout !== null && vault.layout.drawerWeightLimit > 0
                          ? ` · ${t('gold.vaultSettings.limitLabel', {
                              weight: t('gold.common.grams', {
                                value: fmtWeightValue(vault.layout.drawerWeightLimit),
                              }),
                            })}`
                          : ''}
                      </span>
                    </span>
                    <Can permission="goldVault.edit">
                      <Select
                        value={vault.floorId ?? ''}
                        className="w-36"
                        onChange={(e) => {
                          void updateVault
                            .mutateAsync({
                              id: vault.id,
                              body: {
                                floorId: e.target.value === '' ? null : e.target.value,
                                version: vault.version,
                              },
                            })
                            .catch(fail);
                        }}
                      >
                        <option value="">{t('gold.vaultSettings.noFloor')}</option>
                        {floors.map((floor) => (
                          <option key={floor.id} value={floor.id}>
                            {floor.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<CogIcon className="h-4 w-4" />}
                        onClick={() => {
                          setLayoutVault(vault);
                        }}
                      >
                        {t('gold.vaultSettings.layout')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('gold.common.edit')}
                        onClick={() => {
                          setVaultDialog({ open: true, vault });
                        }}
                      >
                        <EditIcon className="h-4 w-4" />
                      </Button>
                    </Can>
                    <Can permission="goldVault.delete">
                      <Button
                        variant="ghost-danger"
                        size="sm"
                        aria-label={t('gold.common.delete')}
                        onClick={() => void removeVault(vault)}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </Can>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {vaultDialog.open && (
        <VaultDialog
          vault={vaultDialog.vault}
          floors={floors.map((floor) => ({ id: floor.id, name: floor.name }))}
          onClose={() => {
            setVaultDialog({ open: false, vault: null });
          }}
          onSave={async ({ name, description, floorId }) => {
            try {
              // A cleared description is `null` on edit — that is what clears it. On create there
              // is nothing to clear, so an absent description is simply left out.
              if (vaultDialog.vault === null) {
                await createVault.mutateAsync({
                  name,
                  floorId,
                  ...(description === null ? {} : { description }),
                });
              } else {
                await updateVault.mutateAsync({
                  id: vaultDialog.vault.id,
                  body: { name, description, floorId, version: vaultDialog.vault.version },
                });
              }
              toast.success(t('gold.common.saved'));
              setVaultDialog({ open: false, vault: null });
            } catch (err) {
              fail(err);
            }
          }}
        />
      )}

      {layoutVault !== null && (
        <LayoutDialog
          vault={layoutVault}
          onClose={() => {
            setLayoutVault(null);
          }}
        />
      )}

      <Dialog
        open={floorDialog}
        onClose={() => {
          setFloorDialog(false);
        }}
        title={t('gold.vaultSettings.newFloor')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setFloorDialog(false);
              }}
            >
              {t('gold.common.cancel')}
            </Button>
            <Button
              disabled={floorName.trim() === ''}
              loading={createFloor.isPending}
              onClick={() => {
                void createFloor
                  .mutateAsync({ name: floorName.trim() })
                  .then(() => {
                    toast.success(t('gold.vaultSettings.floorAdded'));
                    setFloorDialog(false);
                  })
                  .catch(fail);
              }}
            >
              {t('gold.common.add')}
            </Button>
          </>
        }
      >
        <Field label={t('gold.vaultSettings.floorName')} required>
          <Input
            value={floorName}
            placeholder={t('gold.vaultSettings.floorNamePlaceholder')}
            onChange={(e) => {
              setFloorName(e.target.value);
            }}
          />
        </Field>
      </Dialog>
    </PageContainer>
  );
};

const VaultDialog = ({
  vault,
  floors,
  onClose,
  onSave,
}: {
  vault: GoldVaultDto | null;
  floors: { id: string; name: string }[];
  onClose: () => void;
  onSave: (body: { name: string; description: string | null; floorId: string | null }) => Promise<void>;
}): JSX.Element => {
  const t = useT();
  const [name, setName] = useState(vault?.name ?? '');
  const [description, setDescription] = useState(vault?.description ?? '');
  const [floorId, setFloorId] = useState(vault?.floorId ?? '');

  return (
    <Dialog
      open
      onClose={onClose}
      title={vault === null ? t('gold.vaultSettings.newVault') : t('gold.vaultSettings.editVault')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('gold.common.cancel')}
          </Button>
          <Button
            disabled={name.trim() === ''}
            onClick={() => {
              void onSave({
                name: name.trim(),
                description: description.trim() === '' ? null : description.trim(),
                floorId: floorId === '' ? null : floorId,
              });
            }}
          >
            {t('gold.common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('gold.vaultSettings.vaultName')} required>
          <Input
            value={name}
            placeholder={t('gold.vaultSettings.vaultNamePlaceholder')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <Field label={t('gold.vaultSettings.floor')}>
          <Select
            value={floorId}
            onChange={(e) => {
              setFloorId(e.target.value);
            }}
          >
            <option value="">{t('gold.vaultSettings.noFloor')}</option>
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('gold.vaultSettings.description')}>
          <Textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
};

const LayoutDialog = ({
  vault,
  onClose,
}: {
  vault: GoldVaultDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const preview = usePreviewGoldLayout();
  const generate = useGenerateGoldLayout();
  const reshape = useReshapeGoldLayout();
  const [previewData, setPreviewData] = useState<GoldLayoutPreviewDto | null>(null);
  const [cfg, setCfg] = useState<GenerateGoldLayout>({
    rows: vault.layout?.rows ?? DEFAULT_LAYOUT.rows,
    cols: vault.layout?.cols ?? DEFAULT_LAYOUT.cols,
    orientation: vault.layout?.orientation ?? DEFAULT_LAYOUT.orientation,
    horizontalDirection: vault.layout?.horizontalDirection ?? DEFAULT_LAYOUT.horizontalDirection,
    verticalDirection: vault.layout?.verticalDirection ?? DEFAULT_LAYOUT.verticalDirection,
    startNumber: vault.layout?.startNumber ?? DEFAULT_LAYOUT.startNumber,
    drawerWeightLimit: vault.layout?.drawerWeightLimit ?? DEFAULT_LAYOUT.drawerWeightLimit,
  });

  const total = cfg.rows * cfg.cols;
  const from = cfg.startNumber;
  const to = from + total - 1;
  const existingStart = vault.layout?.startNumber ?? 1;
  // Reshape keeps every drawer's NUMBER, so it needs the same count and the same start.
  const canReshape =
    vault.drawerCount > 0 && total === vault.drawerCount && cfg.startNumber === existingStart;

  const fail = (err: unknown): void => {
    toast.error(err instanceof Error ? err.message : t('common.error'));
  };

  const num = (key: keyof GenerateGoldLayout) => (value: string) => {
    setCfg((prev) => ({ ...prev, [key]: Number(value) || 0 }));
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('gold.vaultSettings.layoutTitle', { name: vault.name })}
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('gold.vaultSettings.rows')}>
            <Input
              type="number"
              min={1}
              value={cfg.rows}
              onChange={(e) => {
                num('rows')(e.target.value);
              }}
            />
          </Field>
          <Field label={t('gold.vaultSettings.cols')}>
            <Input
              type="number"
              min={1}
              value={cfg.cols}
              onChange={(e) => {
                num('cols')(e.target.value);
              }}
            />
          </Field>
          <Field label={t('gold.vaultSettings.startNumber')}>
            <Input
              type="number"
              min={1}
              value={cfg.startNumber}
              onChange={(e) => {
                num('startNumber')(e.target.value);
              }}
            />
          </Field>
          <Field label={t('gold.vaultSettings.orientation')}>
            <Select
              value={cfg.orientation}
              onChange={(e) => {
                setCfg((prev) => ({
                  ...prev,
                  orientation: e.target.value as GenerateGoldLayout['orientation'],
                }));
              }}
            >
              <option value="horizontal">{t('gold.vaultSettings.orientationHorizontal')}</option>
              <option value="vertical">{t('gold.vaultSettings.orientationVertical')}</option>
            </Select>
          </Field>
          <Field label={t('gold.vaultSettings.hDirection')}>
            <Select
              value={cfg.horizontalDirection}
              onChange={(e) => {
                setCfg((prev) => ({
                  ...prev,
                  horizontalDirection: e.target.value as GenerateGoldLayout['horizontalDirection'],
                }));
              }}
            >
              <option value="rtl">{t('gold.vaultSettings.hRtl')}</option>
              <option value="ltr">{t('gold.vaultSettings.hLtr')}</option>
            </Select>
          </Field>
          <Field label={t('gold.vaultSettings.vDirection')}>
            <Select
              value={cfg.verticalDirection}
              onChange={(e) => {
                setCfg((prev) => ({
                  ...prev,
                  verticalDirection: e.target.value as GenerateGoldLayout['verticalDirection'],
                }));
              }}
            >
              <option value="ttb">{t('gold.vaultSettings.vTtb')}</option>
              <option value="btt">{t('gold.vaultSettings.vBtt')}</option>
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Field label={t('gold.vaultSettings.weightLimit')}>
              <Input
                type="number"
                min={0}
                value={cfg.drawerWeightLimit}
                onChange={(e) => {
                  num('drawerWeightLimit')(e.target.value);
                }}
              />
            </Field>
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('gold.vaultSettings.rangeHint', { from, to, count: total })}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            loading={preview.isPending}
            onClick={() => {
              void preview
                .mutateAsync({ ...cfg, code: vault.code })
                .then(setPreviewData)
                .catch(fail);
            }}
          >
            {t('gold.vaultSettings.preview')}
          </Button>
          <Button
            loading={generate.isPending}
            onClick={() => {
              if (
                vault.drawerCount > 0 &&
                !window.confirm(t('gold.vaultSettings.confirmRegenerate'))
              ) {
                return;
              }
              void generate
                .mutateAsync({ id: vault.id, body: cfg })
                .then(() => {
                  onClose();
                })
                .catch(fail);
            }}
          >
            {generate.isPending
              ? t('gold.vaultSettings.generating')
              : vault.drawerCount > 0
                ? t('gold.vaultSettings.regenerate')
                : t('gold.vaultSettings.generate')}
          </Button>
          {vault.drawerCount > 0 && (
            <Button
              disabled={!canReshape}
              loading={reshape.isPending}
              title={
                canReshape
                  ? t('gold.vaultSettings.reshapeTooltip')
                  : t('gold.vaultSettings.reshapeTooltipBlocked')
              }
              onClick={() => {
                void reshape
                  .mutateAsync({ id: vault.id, body: cfg })
                  .then(() => {
                    toast.success(t('gold.vaultSettings.reshapeDone'));
                    onClose();
                  })
                  .catch(fail);
              }}
            >
              {reshape.isPending
                ? t('gold.vaultSettings.reshaping')
                : t('gold.vaultSettings.reshape')}
            </Button>
          )}
        </div>

        {vault.drawerCount > 0 && (
          <p
            className={`text-[11px] ${canReshape ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
          >
            {canReshape
              ? t('gold.vaultSettings.reshapeAvailable')
              : t('gold.vaultSettings.reshapeBlocked', {
                  count: vault.drawerCount,
                  start: existingStart,
                })}
          </p>
        )}

        {previewData !== null && previewData.drawers.length > 0 && (
          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              {t('gold.vaultSettings.previewTitle', {
                count: previewData.count,
                from: previewData.from ?? 0,
                to: previewData.to ?? 0,
              })}
            </p>
            <div className="space-y-1 overflow-x-auto pb-2">
              {Array.from({ length: cfg.rows }).map((_, row) => (
                <div key={`preview-row-${String(row)}`} className="flex gap-1">
                  {previewData.drawers
                    .filter((drawer) => drawer.row === row)
                    .sort((a, b) => a.col - b.col)
                    .map((drawer) => (
                      <span
                        key={drawer.number}
                        className="grid h-9 w-12 shrink-0 place-items-center rounded-md border border-slate-200 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                      >
                        {drawer.number}
                      </span>
                    ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
};
