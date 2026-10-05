// The four custody dialogs (design §4.3): assign · return · transfer · dispose.
//
// One file because they are one surface — the same asset, the same guards, the same "what happens
// next" question — and splitting them into four would multiply the shared shell four times.
//
// Every one of them is deliberately thin. The SERVER owns the state machine (assign needs the
// asset in stock, return and transfer need an open interval, dispose needs none, disposed is
// terminal), so these dialogs shape a payload and surface the API's verdict. They never pre-judge
// a transition the server would refuse — but they are also never OFFERED for a transition that
// cannot apply, which is the asset detail page's job.
import { useEffect, useState } from 'react';
import {
  IT_DISPOSAL_METHODS,
  IT_HAND_OVER_MAX_LINES,
  type HandOverItAssets,
  type ItAssetAssignmentDto,
  type ItAssetDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { localized } from '../../../shared/lib/format';
import { PrinterIcon, TrashIcon } from '../../../shared/ui/icons';
import { EmployeePicker } from './EmployeePicker';
import { AssetPicker } from './AssetPicker';
import { useReceiptPrinter } from './CustodyReceipt';
import * as api from '../api/it-api';
import { fromLines, toLines } from '../lib/asset-specs';
import {
  useDisposeItAsset,
  useHandOverItAssets,
  useItAsset,
  useItBranchOptions,
  useReturnItAsset,
  useTransferItAsset,
} from '../api/it-queries';

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`; an empty string means "let the server stamp now". */
const nowLocal = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const Shell = ({
  open,
  onClose,
  title,
  description,
  error,
  busy,
  canSubmit,
  submitLabel,
  submitVariant,
  onSubmit,
  extraAction,
  size,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  error: string | null;
  busy: boolean;
  canSubmit: boolean;
  submitLabel: string;
  submitVariant?: 'primary' | 'danger';
  onSubmit: () => void;
  /** A step before the submit — the receipt printed before a hand-over (FR-18). */
  extraAction?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
  children: React.ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(size === undefined ? {} : { size })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {extraAction}
          <Button
            variant={submitVariant ?? 'primary'}
            loading={busy}
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      {error !== null && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <div className="space-y-4">{children}</div>
    </Dialog>
  );
};

const message = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

// ── Assign: the hand-over, receipt first (FR-18) ────────────────────────────
//
// «وأنا بسلم الموظف جهاز او أصل يكون فى طباعة إيصال الأول وبعد الطباعة يسلم الجهاز على السيستم».
// The dialog has two steps and offers them in that order: «طباعة الإيصال» prints the paper the
// employee signs — composed by the server from exactly what will be recorded — and only then does
// «تسليم» record it. Changing anything after printing takes the hand-over away again until the
// receipt is printed afresh: the system must never record something other than what was signed.
// Each device is a page of the acknowledgment, and its accessories («ومشتملاته») start as the
// asset's own list — edited here, they are what that page lists.

/** One device on the receipt being prepared — one page of the acknowledgment. */
interface DraftLine {
  assetId: string;
  condition: string;
  notes: string;
  /**
   * «مشتملاته», one per line. Null until edited: the paper then lists the asset's own accessories,
   * which is what the box shows.
   */
  accessories: string | null;
}

const emptyLine = (assetId: string): DraftLine => ({
  assetId,
  condition: '',
  notes: '',
  accessories: null,
});

/** The line's asset, named the way the receipt will name it. */
const LineAsset = ({ assetId }: { assetId: string }): JSX.Element => {
  const t = useT();
  const asset = useItAsset(assetId);
  return (
    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
      {asset.data === undefined ? (
        t('common.loading')
      ) : (
        <>
          {asset.data.name}{' '}
          <span className="font-mono text-xs text-slate-500" dir="ltr">
            {asset.data.assetCode}
            {asset.data.serialNumber === null ? '' : ` · SN ${asset.data.serialNumber}`}
          </span>
        </>
      )}
    </span>
  );
};

/** What came with the device — the asset's own list until somebody edits it for this paper. */
const LineAccessories = ({
  assetId,
  value,
  onChange,
}: {
  assetId: string;
  value: string | null;
  onChange: (value: string) => void;
}): JSX.Element => {
  const t = useT();
  const asset = useItAsset(assetId);
  return (
    <Textarea
      rows={2}
      value={value ?? toLines(asset.data?.accessories ?? [])}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('it.custody.receipt.accessories')}
      aria-label={t('it.custody.receipt.accessories')}
    />
  );
};

export const AssignAssetDialog = ({
  open,
  onClose,
  asset,
}: {
  open: boolean;
  onClose: () => void;
  /** The asset the hand-over starts from — null to start from an empty receipt. */
  asset: ItAssetDto | null;
}): JSX.Element => {
  const t = useT();
  const handOver = useHandOverItAssets();
  const printer = useReceiptPrinter();
  const [employeeId, setEmployeeId] = useState('');
  const [employeeLabel, setEmployeeLabel] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [assignedAt, setAssignedAt] = useState('');
  const [expectedReturnAt, setExpectedReturnAt] = useState('');
  const [printedFor, setPrintedFor] = useState<string | null>(null);
  // The number on the paper last printed — the one the hand-over records (EGYCASH-IT-F-14-…).
  const [printedNumber, setPrintedNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The id, not the object: a refetch of the asset while the dialog is open must not wipe a
  // receipt that has already been printed.
  const startingAssetId = asset?.id ?? null;

  useEffect(() => {
    if (open) {
      setEmployeeId('');
      setEmployeeLabel('');
      setLines(startingAssetId === null ? [] : [emptyLine(startingAssetId)]);
      setAssignedAt(nowLocal());
      setExpectedReturnAt('');
      setPrintedFor(null);
      setPrintedNumber(null);
      setError(null);
    }
  }, [open, startingAssetId]);

  const orderWrong =
    expectedReturnAt !== '' && assignedAt !== '' && expectedReturnAt < assignedAt;

  const body: HandOverItAssets = {
    employeeId,
    lines: lines.map((line) => ({
      assetId: line.assetId,
      ...(line.condition.trim() === '' ? {} : { conditionOnIssue: line.condition.trim() }),
      ...(line.notes.trim() === '' ? {} : { notes: line.notes.trim() }),
      ...(line.accessories === null ? {} : { accessories: fromLines(line.accessories) }),
    })),
    ...(assignedAt === '' ? {} : { assignedAt: new Date(assignedAt) }),
    ...(expectedReturnAt === '' ? {} : { expectedReturnAt: new Date(expectedReturnAt) }),
  };
  // What was printed, as the server will be asked to record it. Any edit after printing changes
  // this and takes «تسليم» away until the paper matches again.
  const payloadKey = JSON.stringify(body);
  const ready = employeeId !== '' && lines.length > 0 && !orderWrong;
  const printed = printedFor === payloadKey;
  const changedSincePrint = printedFor !== null && !printed;

  const setLine = (index: number, patch: Partial<DraftLine>): void =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const print = async (): Promise<void> => {
    setError(null);
    const key = payloadKey;
    const paper = await printer.print(async () => {
      try {
        return await api.previewCustodyReceipt(body);
      } catch (err) {
        setError(message(err, t('common.error')));
        throw err;
      }
    });
    if (paper !== null) {
      setPrintedFor(key);
      setPrintedNumber(paper.formNumber);
    }
  };

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await handOver.mutateAsync({
        ...body,
        ...(printedNumber === null ? {} : { formNumber: printedNumber }),
      });
      toast.success(t('it.custody.receipt.handedOver'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      size="lg"
      title={t('it.custody.receipt.title')}
      {...(asset === null ? {} : { description: `${asset.assetCode} — ${asset.name}` })}
      error={error}
      busy={handOver.isPending}
      canSubmit={ready && printed}
      submitLabel={t('it.custody.receipt.handOver')}
      onSubmit={() => void submit()}
      extraAction={
        <Button
          variant={printed ? 'secondary' : 'primary'}
          leftIcon={<PrinterIcon className="h-4 w-4" />}
          loading={printer.isPrinting}
          disabled={!ready}
          onClick={() => void print()}
        >
          {t('it.custody.receipt.print')}
        </Button>
      }
    >
      <p
        role="note"
        className={`rounded-lg px-3 py-2 text-sm ${
          printed
            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
            : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
        }`}
      >
        {printed
          ? t('it.custody.receipt.printedNowHandOver')
          : changedSincePrint
            ? t('it.custody.receipt.changedSincePrint')
            : t('it.custody.receipt.printFirst')}
      </p>
      <Field label={t('it.custody.holder')} required>
        <EmployeePicker
          value={employeeId}
          valueLabel={employeeLabel}
          onChange={(id, label) => {
            setEmployeeId(id);
            setEmployeeLabel(label);
          }}
          ariaLabel={t('it.custody.holder')}
        />
      </Field>
      <Field label={t('it.custody.receipt.lines')} required hint={t('it.custody.receipt.linesHint')}>
        <div className="space-y-3">
          {lines.map((line, index) => (
            <div
              key={line.assetId}
              data-receipt-line={line.assetId}
              className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs text-slate-500">{index + 1}.</span>
                <div className="flex-1">
                  <LineAsset assetId={line.assetId} />
                </div>
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  aria-label={t('it.custody.receipt.removeLine')}
                  title={t('it.custody.receipt.removeLine')}
                  className="rounded p-1 text-slate-400 hover:text-red-600"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={line.condition}
                  onChange={(e) => setLine(index, { condition: e.target.value })}
                  placeholder={t('it.custody.receipt.condition')}
                  aria-label={t('it.custody.receipt.condition')}
                />
                <Input
                  value={line.notes}
                  onChange={(e) => setLine(index, { notes: e.target.value })}
                  placeholder={t('it.custody.receipt.lineNotes')}
                  aria-label={t('it.custody.receipt.lineNotes')}
                />
              </div>
              <LineAccessories
                assetId={line.assetId}
                value={line.accessories}
                onChange={(accessories) => setLine(index, { accessories })}
              />
            </div>
          ))}
          {lines.length < IT_HAND_OVER_MAX_LINES && (
            <AssetPicker
              value=""
              status="inStock"
              exclude={lines.map((line) => line.assetId)}
              onChange={(assetId) => {
                if (assetId !== '') setLines((current) => [...current, emptyLine(assetId)]);
              }}
              ariaLabel={t('it.custody.receipt.addLine')}
            />
          )}
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('it.custody.assignedAt')}>
          <Input
            type="datetime-local"
            value={assignedAt}
            onChange={(e) => setAssignedAt(e.target.value)}
          />
        </Field>
        <Field
          label={t('it.custody.expectedReturnAt')}
          error={orderWrong ? t('it.custody.returnBeforeAssign') : undefined}
        >
          <Input
            type="datetime-local"
            value={expectedReturnAt}
            onChange={(e) => setExpectedReturnAt(e.target.value)}
            error={orderWrong}
          />
        </Field>
      </div>
    </Shell>
  );
};

// ── Return ──────────────────────────────────────────────────────────────────

export const ReturnAssetDialog = ({
  open,
  onClose,
  asset,
  holderLabel,
}: {
  open: boolean;
  onClose: () => void;
  asset: ItAssetDto;
  holderLabel: string | null;
}): JSX.Element => {
  const t = useT();
  const back = useReturnItAsset();
  const [returnedAt, setReturnedAt] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReturnedAt(nowLocal());
      setCondition('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await back.mutateAsync({
        id: asset.id,
        body: {
          ...(returnedAt === '' ? {} : { returnedAt: new Date(returnedAt) }),
          ...(condition.trim() === '' ? {} : { conditionOnReturn: condition.trim() }),
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        },
      });
      toast.success(t('it.custody.returned'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t('it.custody.return')}
      description={
        holderLabel === null
          ? `${asset.assetCode} — ${asset.name}`
          : `${asset.assetCode} — ${holderLabel}`
      }
      error={error}
      busy={back.isPending}
      canSubmit
      submitLabel={t('it.custody.return')}
      onSubmit={() => void submit()}
    >
      <Field label={t('it.custody.returnedAt')}>
        <Input
          type="datetime-local"
          value={returnedAt}
          onChange={(e) => setReturnedAt(e.target.value)}
        />
      </Field>
      <Field label={t('it.custody.conditionOnReturn')} hint={t('it.custody.conditionHint')}>
        <Input value={condition} onChange={(e) => setCondition(e.target.value)} />
      </Field>
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── Transfer ────────────────────────────────────────────────────────────────

export const TransferAssetDialog = ({
  open,
  onClose,
  asset,
  current,
  holderLabel,
}: {
  open: boolean;
  onClose: () => void;
  asset: ItAssetDto;
  current: ItAssetAssignmentDto | null;
  holderLabel: string | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const transfer = useTransferItAsset();
  const branches = useItBranchOptions();
  const [employeeId, setEmployeeId] = useState('');
  const [employeeLabel, setEmployeeLabel] = useState('');
  const [branchId, setBranchId] = useState('');
  const [at, setAt] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [printedFor, setPrintedFor] = useState<string | null>(null);
  const [printedNumber, setPrintedNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printer = useReceiptPrinter();

  useEffect(() => {
    if (open) {
      setEmployeeId('');
      setEmployeeLabel('');
      setBranchId('');
      setAt(nowLocal());
      setCondition('');
      setNotes('');
      setPrintedFor(null);
      setPrintedNumber(null);
      setError(null);
    }
  }, [open]);

  // A transfer must MOVE something. The server enforces this too; catching it here saves the user
  // a round trip to be told they changed nothing.
  const movesHolder = employeeId !== '' && employeeId !== current?.assignedToEmployeeId;
  const movesBranch = branchId !== '' && branchId !== asset.branchId;

  const body = {
    ...(movesHolder ? { toEmployeeId: employeeId } : {}),
    ...(movesBranch ? { toBranchId: branchId } : {}),
    ...(at === '' ? {} : { at: new Date(at) }),
    ...(movesHolder && condition.trim() !== '' ? { conditionOnIssue: condition.trim() } : {}),
    ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
  };
  // A NEW holder signs a receipt (FR-18), printed before the transfer is recorded — the same two
  // steps as a hand-over. A move between branches in the same hands needs no new paper.
  const payloadKey = JSON.stringify(body);
  const printed = printedFor === payloadKey;
  const canSubmit = (movesHolder || movesBranch) && (!movesHolder || printed);

  const print = async (): Promise<void> => {
    setError(null);
    const key = payloadKey;
    const paper = await printer.print(async () => {
      try {
        return await api.previewCustodyReceipt({
          kind: 'transfer',
          employeeId,
          lines: [
            {
              assetId: asset.id,
              ...(condition.trim() === '' ? {} : { conditionOnIssue: condition.trim() }),
              ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
            },
          ],
          ...(at === '' ? {} : { assignedAt: new Date(at) }),
        });
      } catch (err) {
        setError(message(err, t('common.error')));
        throw err;
      }
    });
    if (paper !== null) {
      setPrintedFor(key);
      setPrintedNumber(paper.formNumber);
    }
  };

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await transfer.mutateAsync({
        id: asset.id,
        body: {
          ...body,
          ...(movesHolder && printedNumber !== null ? { formNumber: printedNumber } : {}),
        },
      });
      toast.success(t('it.custody.transferred'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t('it.custody.transfer')}
      description={
        holderLabel === null
          ? `${asset.assetCode} — ${asset.name}`
          : `${asset.assetCode} — ${holderLabel}`
      }
      error={error}
      busy={transfer.isPending}
      canSubmit={canSubmit}
      submitLabel={t('it.custody.transfer')}
      onSubmit={() => void submit()}
      extraAction={
        movesHolder ? (
          <Button
            variant={printed ? 'secondary' : 'primary'}
            leftIcon={<PrinterIcon className="h-4 w-4" />}
            loading={printer.isPrinting}
            onClick={() => void print()}
          >
            {t('it.custody.receipt.print')}
          </Button>
        ) : undefined
      }
    >
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('it.custody.transferHint')}</p>
      {movesHolder && (
        <p
          role="note"
          className={`rounded-lg px-3 py-2 text-sm ${
            printed
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
          }`}
        >
          {printed
            ? t('it.custody.receipt.printedNowTransfer')
            : printedFor !== null
              ? t('it.custody.receipt.changedSincePrint')
              : t('it.custody.receipt.transferPrintFirst')}
        </p>
      )}
      <Field label={t('it.custody.newHolder')}>
        <EmployeePicker
          value={employeeId}
          valueLabel={employeeLabel}
          onChange={(id, label) => {
            setEmployeeId(id);
            setEmployeeLabel(label);
          }}
          ariaLabel={t('it.custody.newHolder')}
        />
      </Field>
      <Field label={t('it.custody.newBranch')}>
        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">{t('it.custody.sameBranch')}</option>
          {(branches.data ?? [])
            .filter((branch) => branch.id !== asset.branchId)
            .map((branch) => (
              <option key={branch.id} value={branch.id}>
                {localized(branch.name, locale)}
              </option>
            ))}
        </Select>
      </Field>
      <Field label={t('it.custody.transferredAt')}>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      {movesHolder && (
        <Field label={t('it.custody.conditionOnIssue')} hint={t('it.custody.conditionHint')}>
          <Input value={condition} onChange={(e) => setCondition(e.target.value)} />
        </Field>
      )}
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── Dispose ─────────────────────────────────────────────────────────────────

export const DisposeAssetDialog = ({
  open,
  onClose,
  asset,
}: {
  open: boolean;
  onClose: () => void;
  asset: ItAssetDto;
}): JSX.Element => {
  const t = useT();
  const dispose = useDisposeItAsset();
  const [method, setMethod] = useState<string>('scrapped');
  const [reason, setReason] = useState('');
  const [at, setAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMethod('scrapped');
      setReason('');
      setAt(nowLocal());
      setNotes('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await dispose.mutateAsync({
        id: asset.id,
        body: {
          method: method as (typeof IT_DISPOSAL_METHODS)[number],
          reason: reason.trim(),
          ...(at === '' ? {} : { at: new Date(at) }),
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        },
      });
      toast.success(t('it.custody.disposed'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t('it.custody.dispose')}
      description={`${asset.assetCode} — ${asset.name}`}
      error={error}
      busy={dispose.isPending}
      canSubmit={reason.trim() !== ''}
      submitLabel={t('it.custody.dispose')}
      submitVariant="danger"
      onSubmit={() => void submit()}
    >
      {/* Disposal is terminal and cannot be undone — say so before, not after. */}
      <p
        role="note"
        className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        {t('it.custody.disposeWarning')}
      </p>
      <Field label={t('it.custody.disposalMethod')} required>
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          {IT_DISPOSAL_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`it.custody.method.${m}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('it.custody.disposalReason')} required hint={t('it.custody.reasonHint')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t('it.custody.disposedAt')}>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};
