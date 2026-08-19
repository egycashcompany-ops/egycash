// عمليات الدخول — the receipt editor, and the busiest screen in the module.
//
// Three columns, as the gold screen had them:
//   LEFT   the header — who owns the shipment, who delivered it, who signed for it.
//   MIDDLE one row per bar, with its destination vault and drawer.
//   RIGHT  a live read-out of what those drawers will weigh AFTER the receipt is approved.
//
// The right-hand panel is not decoration: a drawer has a weight limit, and the operator needs to
// see they are about to exceed it BEFORE approving, not as a refusal afterwards.
//
// Nothing here writes bars. Saving stores a draft, and only APPROVE turns the lines into bars —
// which is why a confirmed receipt is read-only and the footer says so.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type CreateGoldReceiving,
  type GoldMetalType,
  type GoldReceivingReceiptDto,
  type GoldVaultDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can, useCan } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Checkbox, Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { PlusIcon, PrinterIcon, TrashIcon, UploadIcon, CheckIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { listVaultDrawers, receivingNextNumber } from '../api/gold-api';
import {
  useConfirmGoldReceiving,
  useCreateGoldReceiving,
  useGoldRepresentatives,
  useGoldVaultDrawers,
  useGoldVaults,
  useUpdateGoldReceiving,
} from '../api/gold-queries';
import { EmployeePicker } from './EmployeePicker';
import { VehiclePicker } from './VehiclePicker';
import { metalOptions } from './gold-labels';
import { useGoldCompanyOptions } from './useGoldCompanyOptions';
import { fillColor, fillRatio, fmtWeightValue, todayInput, toDateInput } from '../lib/gold-format';
import { printReceiptHtml } from '../lib/gold-print';
import { parseImportFile } from './receiving-import';
import { printReceiving } from '../api/gold-api';

interface Line {
  serialNumber: string;
  brand: string;
  metalType: GoldMetalType;
  purity: string;
  weight: string;
  weightBeforePacking: string;
  weightAfterPacking: string;
  vaultId: string;
  drawerId: string;
}

const emptyLine = (): Line => ({
  serialNumber: '',
  brand: '',
  metalType: 'gold',
  purity: '',
  weight: '',
  weightBeforePacking: '',
  weightAfterPacking: '',
  vaultId: '',
  drawerId: '',
});

/** One bar's row. Its drawer list depends on its vault, so the query lives with the row. */
const LineRow = ({
  line,
  vaults,
  duplicate,
  readOnly,
  onChange,
  onRemove,
}: {
  line: Line;
  vaults: GoldVaultDto[];
  duplicate: boolean;
  readOnly: boolean;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
}): JSX.Element => {
  const t = useT();
  const { data: drawers = [] } = useGoldVaultDrawers(line.vaultId, line.vaultId !== '');
  return (
    <div
      className="flex items-end gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700"
      style={{ minWidth: 900 }}
    >
      <Field label={t('gold.common.serial')}>
        <Input
          value={line.serialNumber}
          disabled={readOnly}
          error={duplicate}
          style={{ width: 130 }}
          onChange={(e) => {
            onChange({ serialNumber: e.target.value });
          }}
        />
      </Field>
      <Field label={t('gold.common.brand')}>
        <Input
          value={line.brand}
          disabled={readOnly}
          style={{ width: 110 }}
          onChange={(e) => {
            onChange({ brand: e.target.value });
          }}
        />
      </Field>
      <Field label={t('gold.common.metalType')}>
        <Select
          value={line.metalType}
          disabled={readOnly}
          style={{ width: 92 }}
          onChange={(e) => {
            onChange({ metalType: e.target.value as GoldMetalType });
          }}
        >
          {metalOptions(t).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('gold.common.weight')}>
        <Input
          type="number"
          step="0.001"
          value={line.weight}
          disabled={readOnly}
          style={{ width: 92 }}
          onChange={(e) => {
            onChange({ weight: e.target.value });
          }}
        />
      </Field>
      <Field label={t('gold.common.purity')}>
        <Input
          value={line.purity}
          disabled={readOnly}
          style={{ width: 78 }}
          onChange={(e) => {
            onChange({ purity: e.target.value });
          }}
        />
      </Field>
      <Field label={t('gold.common.vault')}>
        <Select
          value={line.vaultId}
          disabled={readOnly}
          style={{ width: 92 }}
          onChange={(e) => {
            onChange({ vaultId: e.target.value, drawerId: '' });
          }}
        >
          <option value="">—</option>
          {vaults.map((vault) => (
            <option key={vault.id} value={vault.id}>
              {vault.code}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('gold.common.drawer')}>
        <Select
          value={line.drawerId}
          disabled={readOnly || line.vaultId === ''}
          style={{ width: 88 }}
          onChange={(e) => {
            onChange({ drawerId: e.target.value });
          }}
        >
          <option value="">—</option>
          {drawers.map((drawer) => (
            <option key={drawer.id} value={drawer.id}>
              {drawer.number}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('gold.receiving.weightBeforePacking')}>
        <Input
          type="number"
          step="0.001"
          value={line.weightBeforePacking}
          disabled={readOnly}
          style={{ width: 100 }}
          onChange={(e) => {
            onChange({ weightBeforePacking: e.target.value });
          }}
        />
      </Field>
      <Field label={t('gold.receiving.weightAfterPacking')}>
        <Input
          type="number"
          step="0.001"
          value={line.weightAfterPacking}
          disabled={readOnly}
          style={{ width: 100 }}
          onChange={(e) => {
            onChange({ weightAfterPacking: e.target.value });
          }}
        />
      </Field>
      {!readOnly && (
        <Button
          variant="ghost-danger"
          size="sm"
          aria-label={t('gold.common.delete')}
          onClick={onRemove}
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};

/** What one vault's target drawers will hold once this receipt is approved. */
const VaultImpact = ({
  vaultId,
  vaultCode,
  lines,
}: {
  vaultId: string;
  vaultCode: string;
  lines: Line[];
}): JSX.Element | null => {
  const t = useT();
  const { data: drawers = [] } = useGoldVaultDrawers(vaultId);
  const added = new Map<string, number>();
  for (const line of lines) {
    if (line.drawerId === '') continue;
    added.set(line.drawerId, (added.get(line.drawerId) ?? 0) + (Number(line.weight) || 0));
  }
  if (added.size === 0) return null;

  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium text-brand-700 dark:text-brand-300">{vaultCode}</p>
      <div className="space-y-2">
        {[...added.entries()].map(([drawerId, extra]) => {
          const drawer = drawers.find((d) => d.id === drawerId);
          if (drawer === undefined) return null;
          const before = drawer.totalWeight;
          const after = before + extra;
          const limit = drawer.weightLimit;
          const ratio = fillRatio(after, limit);
          const pct = limit > 0 ? Math.round((after / limit) * 100) : null;
          const over = limit > 0 && after > limit;
          return (
            <div
              key={drawerId}
              className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
            >
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {t('gold.common.drawerNumber', { number: drawer.number })}
                </span>
                {pct !== null && (
                  <span className={over ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}>
                    {pct}%{over ? ' ⚠' : ''}
                  </span>
                )}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${String(Math.min(ratio, 1) * 100)}%`,
                    background: fillColor(ratio),
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>{t('gold.receiving.before', { weight: Math.round(before) })}</span>
                <span className="text-slate-700 dark:text-slate-200">
                  {t('gold.receiving.after', { weight: Math.round(after) })}
                </span>
                {limit > 0 && <span>{t('gold.receiving.limit', { weight: limit })}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const ReceivingEditorDialog = ({
  existing,
  loading,
  onClose,
}: {
  existing: GoldReceivingReceiptDto | null;
  loading: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const vaultsQuery = useGoldVaults({ pageSize: 100 });
  const vaults = vaultsQuery.data?.items ?? [];
  const companies = useGoldCompanyOptions();
  const create = useCreateGoldReceiving();
  const update = useUpdateGoldReceiving();
  const confirm = useConfirmGoldReceiving();
  const fileRef = useRef<HTMLInputElement>(null);

  const [id, setId] = useState<string | null>(existing?.id ?? null);
  const [version, setVersion] = useState(existing?.version ?? 0);
  // A NEW receipt defaults to server numbering; an existing one keeps what it was saved with.
  const [deliveredByUs, setDeliveredByUs] = useState(existing?.deliveredByUs ?? false);
  const [receiptNumber, setReceiptNumber] = useState(existing?.receiptNumber ?? '');
  const [receiptDate, setReceiptDate] = useState(
    existing === null ? todayInput() : toDateInput(existing.receiptDate),
  );
  const [companyId, setCompanyId] = useState(existing?.companyId ?? '');
  const [companyDelegateId, setCompanyDelegateId] = useState(existing?.companyDelegateId ?? '');
  const [companyDelegateNationalId, setCompanyDelegateNationalId] = useState(
    existing?.companyDelegateNationalId ?? '',
  );
  const [storageDelegateId, setStorageDelegateId] = useState(existing?.storageDelegateId ?? '');
  const [storageDelegateNationalId, setStorageDelegateNationalId] = useState(
    existing?.storageDelegateNationalId ?? '',
  );
  const [leader, setLeader] = useState({
    id: existing?.teamLeaderEmployeeId ?? '',
    name: existing?.teamLeaderName ?? '',
  });
  const [vehicle, setVehicle] = useState({
    id: existing?.vehicleId ?? '',
    plate: existing?.vehicleNumber ?? '',
  });
  const [supervisor1, setSupervisor1] = useState({
    id: existing?.supervisor1EmployeeId ?? '',
    name: existing?.supervisor1Name ?? '',
  });
  const [supervisor2, setSupervisor2] = useState({
    id: existing?.supervisor2EmployeeId ?? '',
    name: existing?.supervisor2Name ?? '',
  });
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(
    existing !== null && existing.lines.length > 0
      ? existing.lines.map((line) => ({
          serialNumber: line.serialNumber,
          brand: line.brand ?? '',
          metalType: line.metalType,
          purity: line.purity ?? '',
          weight: String(line.weight),
          weightBeforePacking:
            line.weightBeforePacking === null ? '' : String(line.weightBeforePacking),
          weightAfterPacking:
            line.weightAfterPacking === null ? '' : String(line.weightAfterPacking),
          vaultId: line.vaultId ?? '',
          drawerId: line.drawerId ?? '',
        }))
      : [emptyLine()],
  );

  const readOnly = existing?.status === 'confirmed';
  const companyReps = useGoldRepresentatives({ companyId, pageSize: 200 }, companyId !== '');

  // A server-numbered draft shows its number the moment the operator switches to that mode.
  useEffect(() => {
    if (id !== null || deliveredByUs || receiptNumber !== '') return;
    void receivingNextNumber()
      .then((next) => {
        setReceiptNumber(next.number);
      })
      .catch(() => null);
  }, [id, deliveredByUs, receiptNumber]);

  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of lines) {
      const serial = line.serialNumber.trim().toLowerCase();
      if (serial === '') continue;
      counts.set(serial, (counts.get(serial) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s));
  }, [lines]);
  const isDuplicate = (line: Line): boolean =>
    line.serialNumber.trim() !== '' && duplicates.has(line.serialNumber.trim().toLowerCase());

  const total = lines.reduce((sum, line) => sum + (Number(line.weight) || 0), 0);

  const setLine = (index: number, patch: Partial<Line>): void => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const onImport = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      const parsed = await parseImportFile(file);
      if (parsed.length === 0) {
        toast.error(t('gold.receiving.importEmpty'));
        return;
      }
      const norm = (value: string): string => value.trim().toLowerCase();
      const drawerCache = new Map<string, { id: string; number: number; label: string }[]>();
      let unresolved = 0;
      const imported: Line[] = [];
      for (const row of parsed) {
        const vault =
          norm(row.vaultRaw) === ''
            ? undefined
            : vaults.find(
                (v) => norm(v.code) === norm(row.vaultRaw) || norm(v.name) === norm(row.vaultRaw),
              );
        let drawerId = '';
        if (vault !== undefined && row.drawerRaw.trim() !== '') {
          if (!drawerCache.has(vault.id)) {
            drawerCache.set(vault.id, await listVaultDrawers(vault.id));
          }
          const wanted = norm(row.drawerRaw);
          const drawer = (drawerCache.get(vault.id) ?? []).find(
            (d) => String(d.number) === wanted || norm(d.label) === wanted,
          );
          if (drawer === undefined) unresolved += 1;
          else drawerId = drawer.id;
        } else if (row.vaultRaw.trim() !== '' && vault === undefined) {
          unresolved += 1;
        }
        imported.push({
          serialNumber: row.serialNumber,
          brand: row.brand,
          metalType: row.metalType,
          purity: row.purity,
          weight: row.weight,
          weightBeforePacking: row.weightBeforePacking,
          weightAfterPacking: row.weightAfterPacking,
          vaultId: vault?.id ?? '',
          drawerId,
        });
      }
      setLines((prev) => [
        ...prev.filter((line) => line.serialNumber !== '' || line.weight !== ''),
        ...imported,
      ]);
      toast.success(
        t('gold.receiving.importDone', { count: imported.length }) +
          (unresolved > 0 ? t('gold.receiving.importUnresolved', { count: unresolved }) : ''),
      );
    } catch {
      toast.error(t('gold.receiving.importFailed'));
    }
  };

  const payload = (): CreateGoldReceiving => ({
    deliveredByUs,
    receiptDate: new Date(receiptDate),
    companyId: companyId === '' ? null : companyId,
    companyDelegateId: companyDelegateId === '' ? null : companyDelegateId,
    companyDelegateNationalId: companyDelegateNationalId === '' ? null : companyDelegateNationalId,
    storageDelegateId: storageDelegateId === '' ? null : storageDelegateId,
    storageDelegateNationalId: storageDelegateNationalId === '' ? null : storageDelegateNationalId,
    teamLeaderEmployeeId: leader.id === '' ? null : leader.id,
    vehicleId: vehicle.id === '' ? null : vehicle.id,
    supervisor1EmployeeId: supervisor1.id === '' ? null : supervisor1.id,
    supervisor2EmployeeId: supervisor2.id === '' ? null : supervisor2.id,
    notes: notes === '' ? null : notes,
    ...(deliveredByUs ? { receiptNumber } : {}),
    lines: lines
      .filter((line) => line.serialNumber !== '' || line.weight !== '')
      .map((line) => ({
        serialNumber: line.serialNumber,
        brand: line.brand === '' ? undefined : line.brand,
        metalType: line.metalType,
        purity: line.purity === '' ? undefined : line.purity,
        weight: Number(line.weight) || 0,
        weightBeforePacking:
          line.weightBeforePacking === '' ? null : Number(line.weightBeforePacking),
        weightAfterPacking: line.weightAfterPacking === '' ? null : Number(line.weightAfterPacking),
        vaultId: line.vaultId === '' ? null : line.vaultId,
        drawerId: line.drawerId === '' ? null : line.drawerId,
      })),
  });

  /** The two checks the operator should never discover as a server error. */
  const preflight = (): boolean => {
    if (duplicates.size > 0) {
      toast.error(t('gold.receiving.duplicateBlocked'));
      return false;
    }
    if (deliveredByUs && receiptNumber.trim() === '') {
      toast.error(t('gold.receiving.numberRequired'));
      return false;
    }
    return true;
  };

  /**
   * Save whatever is on screen and hand back the receipt AS THE SERVER NOW HAS IT.
   *
   * The saved document is returned rather than just its id because the very next thing a confirm
   * does is send a version, and the version has just moved — guessing it would 409 the operator
   * out of their own save.
   */
  const persist = async (): Promise<GoldReceivingReceiptDto> => {
    if (id === null) {
      const saved = await create.mutateAsync(payload());
      setId(saved.id);
      setVersion(saved.version);
      setReceiptNumber(saved.receiptNumber);
      return saved;
    }
    const saved = await update.mutateAsync({ id, body: { ...payload(), version } });
    setVersion(saved.version);
    return saved;
  };

  const saveDraft = async (): Promise<void> => {
    if (!preflight()) return;
    try {
      await persist();
      toast.success(t('gold.common.draftSaved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const doConfirm = async (): Promise<void> => {
    if (!preflight()) return;
    try {
      const saved = await persist();
      await confirm.mutateAsync({ id: saved.id, version: saved.version });
      toast.success(t('gold.receiving.confirmed'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('gold.receiving.confirmFailed'));
    }
  };

  const doPrint = async (): Promise<void> => {
    if (id !== null) await printReceiving(id).catch(() => null);
    const vaultCodes = new Map(vaults.map((vault) => [vault.id, vault.code]));
    const delegate = (delegateId: string): string =>
      companyReps.data?.items.find((rep) => rep.id === delegateId)?.fullName ?? '—';
    const meta: [string, string][] = [
      [t('gold.receiving.company'), companies.find((c) => c.value === companyId)?.label ?? '—'],
      [
        t('gold.receiving.companyDelegate'),
        `${delegate(companyDelegateId)}${companyDelegateNationalId === '' ? '' : ` — ${companyDelegateNationalId}`}`,
      ],
      [
        t('gold.receiving.storageDelegate'),
        `${delegate(storageDelegateId)}${storageDelegateNationalId === '' ? '' : ` — ${storageDelegateNationalId}`}`,
      ],
      [t('gold.common.supervisor1'), supervisor1.name === '' ? '—' : supervisor1.name],
      [t('gold.common.supervisor2'), supervisor2.name === '' ? '—' : supervisor2.name],
      [
        t('gold.receiving.printTransportedBy'),
        deliveredByUs ? t('gold.receiving.printByUs') : t('gold.receiving.printByOwner'),
      ],
    ];
    if (deliveredByUs) {
      meta.push(
        [t('gold.receiving.teamLeader'), leader.name === '' ? '—' : leader.name],
        [t('gold.receiving.vehicle'), vehicle.plate === '' ? '—' : vehicle.plate],
      );
    }
    meta.push(
      [t('gold.receiving.printBarsCount'), String(lines.length)],
      [t('gold.common.totalWeight'), t('gold.common.grams', { value: fmtWeightValue(total) })],
    );
    const ok = printReceiptHtml({
      title: t('gold.receiving.printTitle'),
      number: receiptNumber === '' ? t('gold.receiving.printDraft') : receiptNumber,
      branch: existing?.branchName ?? '',
      meta,
      table: {
        head: [
          '#',
          t('gold.common.serial'),
          t('gold.common.metalType'),
          t('gold.common.purity'),
          t('gold.common.weight'),
          t('gold.receiving.weightBeforePacking'),
          t('gold.receiving.weightAfterPacking'),
          t('gold.common.vault'),
        ],
        rows: lines.map((line, index) => [
          index + 1,
          line.serialNumber,
          line.metalType,
          line.purity,
          line.weight,
          line.weightBeforePacking,
          line.weightAfterPacking,
          vaultCodes.get(line.vaultId) ?? '—',
        ]),
      },
      footer: notes,
    });
    if (!ok) toast.error(t('gold.common.popupBlocked'));
  };

  const referencedVaults = useMemo(() => {
    const ids = [...new Set(lines.map((line) => line.vaultId).filter((v) => v !== ''))];
    return ids.map((vaultId) => ({
      vaultId,
      code: vaults.find((vault) => vault.id === vaultId)?.code ?? '—',
    }));
  }, [lines, vaults]);

  const title = readOnly
    ? t('gold.receiving.viewTitle', { number: receiptNumber })
    : id !== null
      ? t('gold.receiving.editTitle', { number: receiptNumber === '' ? '—' : receiptNumber })
      : t('gold.receiving.newTitle');

  if (loading) {
    return (
      <Dialog open onClose={onClose} title={t('gold.common.loading')} size="lg">
        <LoadingState />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="full"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {readOnly
              ? t('gold.receiving.lockedHint')
              : existing?.status === 'reverted'
                ? t('gold.receiving.revertedHint')
                : t('gold.receiving.draftHint')}
          </span>
          <span className="flex gap-2">
            <Can permission="goldReceiving.print">
              <Button
                variant="secondary"
                leftIcon={<PrinterIcon className="h-4 w-4" />}
                onClick={() => void doPrint()}
              >
                {t('gold.common.print')}
              </Button>
            </Can>
            {!readOnly && (
              <Button
                variant="secondary"
                loading={create.isPending || update.isPending}
                onClick={() => void saveDraft()}
              >
                {t('gold.common.saveDraft')}
              </Button>
            )}
            {!readOnly && (
              <Can permission="goldReceiving.confirm">
                <Button
                  leftIcon={<CheckIcon className="h-4 w-4" />}
                  loading={confirm.isPending}
                  onClick={() => void doConfirm()}
                >
                  {t('gold.receiving.confirm')}
                </Button>
              </Can>
            )}
          </span>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_2.5fr_1fr]">
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <Field label={t('gold.receiving.receiptDate')}>
              <Input
                type="date"
                value={receiptDate}
                disabled={readOnly}
                onChange={(e) => {
                  setReceiptDate(e.target.value);
                }}
              />
            </Field>
            <Checkbox
              label={t('gold.receiving.deliveredByUs')}
              checked={deliveredByUs}
              disabled={readOnly}
              onChange={(e) => {
                setDeliveredByUs(e.target.checked);
                if (id === null) setReceiptNumber('');
              }}
            />
            <Field label={t('gold.receiving.number')}>
              {deliveredByUs ? (
                <Input
                  value={receiptNumber}
                  disabled={readOnly}
                  placeholder={t('gold.receiving.numberManual')}
                  onChange={(e) => {
                    setReceiptNumber(e.target.value);
                  }}
                />
              ) : (
                <p className="rounded-lg border border-slate-200 px-3 py-2 font-bold tracking-wide text-brand-700 dark:border-slate-700 dark:text-brand-300">
                  {receiptNumber === '' ? '…' : receiptNumber}
                </p>
              )}
            </Field>
            {deliveredByUs && (
              <>
                <EmployeePicker
                  label={t('gold.receiving.teamLeader')}
                  value={leader.id}
                  valueLabel={leader.name}
                  disabled={readOnly}
                  onChange={(employeeId, name) => {
                    setLeader({ id: employeeId, name });
                  }}
                />
                <VehiclePicker
                  label={t('gold.receiving.vehicle')}
                  value={vehicle.id}
                  valueLabel={vehicle.plate}
                  disabled={readOnly}
                  onChange={(vehicleId, plate) => {
                    setVehicle({ id: vehicleId, plate });
                  }}
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t('gold.receiving.transportHint')}
                </p>
              </>
            )}
          </div>

          <div className="grid gap-3">
            <Field label={t('gold.receiving.company')}>
              <Select
                value={companyId}
                disabled={readOnly}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setCompanyDelegateId('');
                  setCompanyDelegateNationalId('');
                  setStorageDelegateId('');
                  setStorageDelegateNationalId('');
                }}
              >
                <option value="">{t('gold.common.select')}</option>
                {companies.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('gold.receiving.companyDelegate')}>
              <Select
                value={companyDelegateId}
                disabled={readOnly || companyId === ''}
                onChange={(e) => {
                  setCompanyDelegateId(e.target.value);
                  setCompanyDelegateNationalId(
                    companyReps.data?.items.find((rep) => rep.id === e.target.value)?.nationalId ??
                      '',
                  );
                }}
              >
                <option value="">
                  {companyId === ''
                    ? t('gold.receiving.selectCompanyFirst')
                    : t('gold.receiving.selectDelegate')}
                </option>
                {(companyReps.data?.items ?? []).map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('gold.receiving.companyDelegateNationalId')}>
              <Input
                value={companyDelegateNationalId}
                dir="ltr"
                disabled={readOnly}
                onChange={(e) => {
                  setCompanyDelegateNationalId(e.target.value);
                }}
              />
            </Field>
            <Field label={t('gold.receiving.storageDelegate')}>
              <Select
                value={storageDelegateId}
                disabled={readOnly || companyId === ''}
                onChange={(e) => {
                  setStorageDelegateId(e.target.value);
                  setStorageDelegateNationalId(
                    companyReps.data?.items.find((rep) => rep.id === e.target.value)?.nationalId ??
                      '',
                  );
                }}
              >
                <option value="">
                  {companyId === ''
                    ? t('gold.receiving.selectCompanyFirst')
                    : t('gold.receiving.selectDelegate')}
                </option>
                {(companyReps.data?.items ?? []).map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('gold.receiving.storageDelegateNationalId')}>
              <Input
                value={storageDelegateNationalId}
                dir="ltr"
                disabled={readOnly}
                onChange={(e) => {
                  setStorageDelegateNationalId(e.target.value);
                }}
              />
            </Field>
            <EmployeePicker
              label={t('gold.common.supervisor1')}
              value={supervisor1.id}
              valueLabel={supervisor1.name}
              disabled={readOnly}
              onChange={(employeeId, name) => {
                setSupervisor1({ id: employeeId, name });
              }}
            />
            <EmployeePicker
              label={t('gold.common.supervisor2')}
              value={supervisor2.id}
              valueLabel={supervisor2.name}
              disabled={readOnly}
              onChange={(employeeId, name) => {
                setSupervisor2({ id: employeeId, name });
              }}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('gold.common.custodianHint')}
            </p>
            <Field label={t('gold.common.notes')}>
              <Textarea
                value={notes}
                disabled={readOnly}
                onChange={(e) => {
                  setNotes(e.target.value);
                }}
              />
            </Field>
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          {!readOnly && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('gold.receiving.barsHeading', { count: lines.length })}
                {duplicates.size > 0 && (
                  <span className="text-xs text-red-600 dark:text-red-400">
                    {t('gold.receiving.duplicateWarning')}
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    void onImport(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {can('goldReceiving.import') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<UploadIcon className="h-3.5 w-3.5" />}
                    onClick={() => {
                      fileRef.current?.click();
                    }}
                  >
                    {t('gold.receiving.import')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<PlusIcon className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setLines((prev) => [...prev, emptyLine()]);
                  }}
                >
                  {t('gold.receiving.addBar')}
                </Button>
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-x-auto">
            <div className="h-full min-h-[40vh] space-y-2 overflow-y-auto pe-1">
              {lines.map((line, index) => (
                <LineRow
                  key={`line-${String(index)}`}
                  line={line}
                  vaults={vaults}
                  duplicate={isDuplicate(line)}
                  readOnly={readOnly}
                  onChange={(patch) => {
                    setLine(index, patch);
                  }}
                  onRemove={() => {
                    setLines((prev) => prev.filter((_, i) => i !== index));
                  }}
                />
              ))}
            </div>
          </div>
          <p className="mt-3 shrink-0 text-sm text-slate-600 dark:text-slate-300">
            {t('gold.common.totalWeight')}:{' '}
            <span className="font-bold text-brand-700 dark:text-brand-300">
              {t('gold.common.grams', { value: fmtWeightValue(total) })}
            </span>
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t('gold.receiving.targetDrawers')}
          </p>
          {referencedVaults.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('gold.receiving.targetHint')}
            </p>
          ) : (
            referencedVaults.map((entry) => (
              <VaultImpact
                key={entry.vaultId}
                vaultId={entry.vaultId}
                vaultCode={entry.code}
                lines={lines.filter((line) => line.vaultId === entry.vaultId)}
              />
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
};
