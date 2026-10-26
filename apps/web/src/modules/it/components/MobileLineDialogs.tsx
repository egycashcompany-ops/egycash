// The mobile-line dialogs (FR-19): the line's form, the hand-over, the return, suspend and
// reactivate, and the line's history.
//
// Their own file, not the asset custody's (`CustodyDialogs.tsx`): a line is not an asset — no
// category, no serial plate, no condition on issue — and its hand-over has a second kind of holder,
// a CAR, which no asset has. What the two share is the department's paper and its rule: an employee
// signs before the system records anything.
//
// Every dialog is thin, as the custody ones are. The SERVER owns the state machine (a hand-over
// needs the line in stock, a return needs it held, a suspension needs it in stock, a reactivation
// needs it suspended), so these shape a payload and surface the API's verdict; the register only
// OFFERS the action a line's status allows.
import { useEffect, useState } from 'react';
import {
  IT_MOBILE_NETWORKS,
  IT_MOBILE_SIM_KINDS,
  ItMobileSimSerialSchema,
  PhoneNumberSchema,
  type AssignItMobileLine,
  type CreateItMobileLine,
  type ItMobileLineAssignmentDto,
  type ItMobileLineDto,
  type ItMobileLineEventType,
  type ItMobileLineHistoryEntryDto,
  type ItMobileNetwork,
  type ItMobileSimKind,
  type Locale,
  type PreviewItMobileLineReceipt,
  type UpdateItMobileLine,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Badge, type Tone } from '../../../shared/ui/Badge';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { Pagination } from '../../../shared/ui/Pagination';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ClipboardIcon, PrinterIcon } from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { formatDate, formatDateTime, localized } from '../../../shared/lib/format';
import * as api from '../api/it-api';
import {
  useAssignItMobileLine,
  useCreateItMobileLine,
  useItBranchOptions,
  useItMobileLineAssignments,
  useItMobileLineHistory,
  useReactivateItMobileLine,
  useReturnItMobileLine,
  useSuspendItMobileLine,
  useUpdateItMobileLine,
} from '../api/it-queries';
import { mobileLineHolderLabel } from '../lib/mobile-line-register-export';
import { EmployeePicker } from './EmployeePicker';
import { MobileLineReceiptActions, useLineReceiptPrinter } from './MobileLineReceipt';
import { MobileNetworkLogo } from './MobileNetworkLogo';

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`; an empty string means "let the server stamp now". */
const nowLocal = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const message = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

/** «فودافون — 01012345678»: which line a dialog is about, in its subtitle. */
const useLineCaption = (): ((line: ItMobileLineDto) => string) => {
  const t = useT();
  return (line) => `${t(`it.mobileLines.network.${line.network}`)} — ${line.phoneNumber}`;
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
  /** A step before the submit — the acknowledgment printed before a hand-over. */
  extraAction?: React.ReactNode;
  size?: 'md' | 'lg';
  children: React.ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      // A dialog that is FILLED IN keeps its typing: only the × and Escape close it.
      dismissOnOutsideClick={false}
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

// ── The line's form: register one, or correct its facts ────────────────────
//
// Never the status or the holder — only the actions move those. The number and the SIM serial are
// checked here by the CONTRACT's own schemas, the ones the API parses with, so a typo is named
// beside its box rather than after a round trip; uniqueness is the server's to judge.

interface LineForm {
  network: ItMobileNetwork | '';
  phoneNumber: string;
  simKind: ItMobileSimKind;
  simSerial: string;
  ratePlan: string;
  accountNumber: string;
  branchId: string;
  notes: string;
}

const formFrom = (line: ItMobileLineDto | null): LineForm => ({
  network: line?.network ?? '',
  phoneNumber: line?.phoneNumber ?? '',
  simKind: line?.simKind ?? 'physical',
  simSerial: line?.simSerial ?? '',
  ratePlan: line?.ratePlan ?? '',
  accountNumber: line?.accountNumber ?? '',
  branchId: line?.branchId ?? '',
  notes: line?.notes ?? '',
});

/** A box left empty is «nothing», which an edit writes as null. */
const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export const MobileLineFormDialog = ({
  open,
  onClose,
  line,
}: {
  open: boolean;
  onClose: () => void;
  /** null → a new line. */
  line: ItMobileLineDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const create = useCreateItMobileLine();
  const update = useUpdateItMobileLine();
  const caption = useLineCaption();
  const [form, setForm] = useState<LineForm>(formFrom(line));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(formFrom(line));
      setError(null);
    }
  }, [open, line]);

  const set = <K extends keyof LineForm>(key: K, value: LineForm[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const phone = PhoneNumberSchema.safeParse(form.phoneNumber);
  const phoneError = form.phoneNumber.trim() !== '' && !phone.success;
  const physical = form.simKind === 'physical';
  const serial = ItMobileSimSerialSchema.safeParse(form.simSerial);
  const serialError = physical && form.simSerial.trim() !== '' && !serial.success;
  const serialValue = physical && serial.success ? serial.data : null;
  // A held line keeps its branch: the server refuses the move until the line is returned.
  const branchLocked = line !== null && line.status === 'assigned';

  const complete = form.network !== '' && phone.success && form.branchId !== '';
  const busy = create.isPending || update.isPending;

  /** What an edit changes — only the facts that moved, so the history names exactly those. */
  const changes = (current: ItMobileLineDto): Omit<UpdateItMobileLine, 'version'> => {
    const network = form.network === '' ? current.network : form.network;
    const phoneNumber = phone.success ? phone.data : current.phoneNumber;
    const accountNumber = orNull(form.accountNumber);
    const ratePlan = orNull(form.ratePlan);
    const notes = orNull(form.notes);
    return {
      ...(network === current.network ? {} : { network }),
      ...(phoneNumber === current.phoneNumber ? {} : { phoneNumber }),
      ...(accountNumber === current.accountNumber ? {} : { accountNumber }),
      ...(ratePlan === current.ratePlan ? {} : { ratePlan }),
      ...(form.simKind === current.simKind ? {} : { simKind: form.simKind }),
      ...(serialValue === current.simSerial ? {} : { simSerial: serialValue }),
      ...(form.branchId === current.branchId ? {} : { branchId: form.branchId }),
      ...(notes === current.notes ? {} : { notes }),
    };
  };
  const edits = line === null ? null : changes(line);
  const changed = edits === null || Object.keys(edits).length > 0;

  const submit = async (): Promise<void> => {
    if (!complete || form.network === '' || !phone.success) return;
    setError(null);
    try {
      if (line === null) {
        const body: CreateItMobileLine = {
          network: form.network,
          phoneNumber: phone.data,
          simKind: form.simKind,
          branchId: form.branchId,
          ...(serialValue === null ? {} : { simSerial: serialValue }),
          ...(orNull(form.ratePlan) === null ? {} : { ratePlan: form.ratePlan.trim() }),
          ...(orNull(form.accountNumber) === null
            ? {}
            : { accountNumber: form.accountNumber.trim() }),
          ...(orNull(form.notes) === null ? {} : { notes: form.notes.trim() }),
        };
        await create.mutateAsync(body);
        toast.success(t('it.mobileLines.created'));
      } else {
        await update.mutateAsync({
          id: line.id,
          body: { ...changes(line), version: line.version },
        });
        toast.success(t('it.mobileLines.updated'));
      }
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
      title={line === null ? t('it.mobileLines.create') : t('it.mobileLines.edit')}
      {...(line === null ? {} : { description: caption(line) })}
      error={error}
      busy={busy}
      canSubmit={complete && !serialError && changed}
      submitLabel={t('common.save')}
      onSubmit={() => void submit()}
    >
      <Field label={t('it.mobileLines.columns.network')} required>
        {/* The networks by their marks, as the register's filter shows them. */}
        <div className="grid grid-cols-3 gap-2">
          {IT_MOBILE_NETWORKS.map((network) => {
            const chosen = form.network === network;
            return (
              <button
                key={network}
                type="button"
                data-network-choice={network}
                aria-pressed={chosen}
                onClick={() => set('network', network)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl border px-2 py-2 text-sm font-semibold transition-colors',
                  chosen
                    ? 'border-brand-500 bg-brand-50 text-slate-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-white'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
              >
                <MobileNetworkLogo network={network} decorative />
                {t(`it.mobileLines.network.${network}`)}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('it.mobileLines.columns.number')}
          required
          hint={t('it.mobileLines.fields.phoneHint')}
          error={phoneError ? t('it.mobileLines.errors.phone') : undefined}
        >
          <Input
            dir="ltr"
            inputMode="tel"
            rule="phone"
            value={form.phoneNumber}
            onChange={(e) => set('phoneNumber', e.target.value)}
            error={phoneError}
          />
        </Field>
        <Field label={t('it.assets.columns.branch')} required>
          <Select
            value={form.branchId}
            disabled={branchLocked}
            onChange={(e) => set('branchId', e.target.value)}
          >
            <option value="">{t('it.mobileLines.chooseBranch')}</option>
            {(branches.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {localized(branch.name, locale)}
              </option>
            ))}
          </Select>
          {branchLocked && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('it.mobileLines.fields.branchLocked')}
            </p>
          )}
        </Field>
        <Field label={t('it.mobileLines.fields.simKind')}>
          <Select
            value={form.simKind}
            onChange={(e) => set('simKind', e.target.value as ItMobileSimKind)}
          >
            {IT_MOBILE_SIM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`it.mobileLines.simKind.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        {physical ? (
          <Field
            label={t('it.mobileLines.columns.simSerial')}
            hint={t('it.mobileLines.fields.simSerialHint')}
            error={serialError ? t('it.mobileLines.errors.simSerial') : undefined}
          >
            <Input
              dir="ltr"
              inputMode="numeric"
              rule="digits"
              value={form.simSerial}
              onChange={(e) => set('simSerial', e.target.value)}
              error={serialError}
            />
          </Field>
        ) : (
          // An eSIM has no card to read a serial from — the box is not offered at all.
          <p className="self-end pb-2 text-xs text-slate-500 dark:text-slate-400">
            {t('it.mobileLines.fields.esimNoSerial')}
          </p>
        )}
        <Field label={t('it.mobileLines.columns.plan')}>
          <Input value={form.ratePlan} onChange={(e) => set('ratePlan', e.target.value)} />
        </Field>
        <Field label={t('it.mobileLines.columns.account')}>
          <Input
            dir="ltr"
            value={form.accountNumber}
            onChange={(e) => set('accountNumber', e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── Hand over: to an employee, acknowledgment first — or to a car ───────────
//
// «وأنا بسلم الموظف جهاز او أصل يكون فى طباعة إيصال الأول وبعد الطباعة يسلم الجهاز على السيستم» —
// the device rule, for a line: «طباعة الإيصال» prints the acknowledgment the employee signs, composed
// by the server from exactly what will be recorded, and only then does «تسليم» record it. Changing
// the employee or the date after printing takes the hand-over away again until the paper is printed
// afresh, and the hand-over sends the printed paper's own number (F-14).
//
// A tracker SIM goes to a CAR, written as the network's sheet names it — its code and/or its plate
// — and a car signs nothing, so that hand-over prints nothing.

type HolderKind = 'employee' | 'vehicle';

export const HandOverMobileLineDialog = ({
  open,
  onClose,
  line,
}: {
  open: boolean;
  onClose: () => void;
  line: ItMobileLineDto;
}): JSX.Element => {
  const t = useT();
  const assign = useAssignItMobileLine();
  const printer = useLineReceiptPrinter();
  const caption = useLineCaption();
  const [to, setTo] = useState<HolderKind>('employee');
  const [employeeId, setEmployeeId] = useState('');
  const [employeeLabel, setEmployeeLabel] = useState('');
  const [vehicleCode, setVehicleCode] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [assignedAt, setAssignedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [printedFor, setPrintedFor] = useState<string | null>(null);
  // The number on the paper last printed — the one the hand-over records (EGYCASH-IT-F-14-…).
  const [printedNumber, setPrintedNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTo('employee');
      setEmployeeId('');
      setEmployeeLabel('');
      setVehicleCode('');
      setVehiclePlate('');
      setAssignedAt(nowLocal());
      setNotes('');
      setPrintedFor(null);
      setPrintedNumber(null);
      setError(null);
    }
  }, [open]);

  const when = assignedAt === '' ? {} : { assignedAt: new Date(assignedAt) };
  // What the paper says, as the server will be asked to record it. Any edit after printing
  // changes this and takes «تسليم» away until the paper matches again.
  const preview: PreviewItMobileLineReceipt = { lineId: line.id, employeeId, ...when };
  const payloadKey = JSON.stringify(preview);
  const printed = printedFor === payloadKey;
  const changedSincePrint = printedFor !== null && !printed;
  const code = vehicleCode.trim();
  const plate = vehiclePlate.trim();
  const toEmployee = to === 'employee';
  const ready = toEmployee ? employeeId !== '' : code !== '' || plate !== '';

  const print = async (): Promise<void> => {
    setError(null);
    const key = payloadKey;
    const paper = await printer.print(async () => {
      try {
        return await api.previewMobileLineReceipt(preview);
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
    const note = notes.trim() === '' ? {} : { notes: notes.trim() };
    const body: AssignItMobileLine = toEmployee
      ? {
          employeeId,
          ...when,
          ...note,
          ...(printedNumber === null ? {} : { formNumber: printedNumber }),
        }
      : {
          ...(code === '' ? {} : { vehicleCode: code }),
          ...(plate === '' ? {} : { vehiclePlate: plate }),
          ...when,
          ...note,
        };
    try {
      await assign.mutateAsync({ id: line.id, body });
      toast.success(
        toEmployee ? t('it.mobileLines.handedOver') : t('it.mobileLines.handedOverToCar'),
      );
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
      title={t('it.mobileLines.handOver.title')}
      description={caption(line)}
      error={error}
      busy={assign.isPending}
      canSubmit={ready && (!toEmployee || printed)}
      submitLabel={t('it.custody.receipt.handOver')}
      onSubmit={() => void submit()}
      extraAction={
        toEmployee ? (
          <Button
            variant={printed ? 'secondary' : 'primary'}
            leftIcon={<PrinterIcon className="h-4 w-4" />}
            loading={printer.isPrinting}
            disabled={!ready}
            onClick={() => void print()}
          >
            {t('it.custody.receipt.print')}
          </Button>
        ) : undefined
      }
    >
      <Field label={t('it.mobileLines.handOver.to')} required>
        <Select value={to} onChange={(e) => setTo(e.target.value as HolderKind)}>
          <option value="employee">{t('it.mobileLines.holderKind.employee')}</option>
          <option value="vehicle">{t('it.mobileLines.holderKind.vehicle')}</option>
        </Select>
      </Field>
      {toEmployee ? (
        <>
          <p
            role="note"
            className={cn(
              'rounded-lg px-3 py-2 text-sm',
              printed
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
            )}
          >
            {printed
              ? t('it.custody.receipt.printedNowHandOver')
              : changedSincePrint
                ? t('it.custody.receipt.changedSincePrint')
                : t('it.custody.receipt.printFirst')}
          </p>
          {/* A hand-over: the people who work here today, and nobody else. */}
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
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('it.mobileLines.handOver.vehicleHint')}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('it.mobileLines.handOver.vehicleCode')}>
              <Input
                dir="ltr"
                value={vehicleCode}
                onChange={(e) => setVehicleCode(e.target.value)}
              />
            </Field>
            <Field label={t('it.mobileLines.handOver.vehiclePlate')}>
              <Input
                rule="plate"
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
              />
            </Field>
          </div>
        </>
      )}
      <Field label={t('it.custody.assignedAt')}>
        <Input
          type="datetime-local"
          value={assignedAt}
          onChange={(e) => setAssignedAt(e.target.value)}
        />
      </Field>
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── Return ──────────────────────────────────────────────────────────────────

export const ReturnMobileLineDialog = ({
  open,
  onClose,
  line,
}: {
  open: boolean;
  onClose: () => void;
  line: ItMobileLineDto;
}): JSX.Element => {
  const t = useT();
  const back = useReturnItMobileLine();
  const caption = useLineCaption();
  const [returnedAt, setReturnedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReturnedAt(nowLocal());
      setNotes('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await back.mutateAsync({
        id: line.id,
        body: {
          ...(returnedAt === '' ? {} : { returnedAt: new Date(returnedAt) }),
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        },
      });
      toast.success(t('it.mobileLines.returned'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  const holder = line.holder === null ? null : mobileLineHolderLabel(t, line.holder);
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t('it.mobileLines.actions.return')}
      description={holder === null ? caption(line) : `${caption(line)} — ${holder}`}
      error={error}
      busy={back.isPending}
      canSubmit
      submitLabel={t('it.mobileLines.actions.return')}
      onSubmit={() => void submit()}
    >
      <Field label={t('it.custody.returnedAt')}>
        <Input
          type="datetime-local"
          value={returnedAt}
          onChange={(e) => setReturnedAt(e.target.value)}
        />
      </Field>
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── Suspend / reactivate ────────────────────────────────────────────────────
//
// A line stopped on the network is held by nobody until it is reactivated — a suspension is a fact
// about the line, not a custody, so it is its own pair of actions rather than a status to type.

export const MobileLineStatusDialog = ({
  open,
  onClose,
  line,
  action,
}: {
  open: boolean;
  onClose: () => void;
  line: ItMobileLineDto;
  action: 'suspend' | 'reactivate';
}): JSX.Element => {
  const t = useT();
  const suspend = useSuspendItMobileLine();
  const reactivate = useReactivateItMobileLine();
  const mutation = action === 'suspend' ? suspend : reactivate;
  const caption = useLineCaption();
  const [at, setAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAt(nowLocal());
      setNotes('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await mutation.mutateAsync({
        id: line.id,
        body: {
          ...(at === '' ? {} : { at: new Date(at) }),
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        },
      });
      toast.success(
        action === 'suspend' ? t('it.mobileLines.suspended') : t('it.mobileLines.reactivated'),
      );
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  const label =
    action === 'suspend'
      ? t('it.mobileLines.actions.suspend')
      : t('it.mobileLines.actions.reactivate');
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={label}
      description={caption(line)}
      error={error}
      busy={mutation.isPending}
      canSubmit
      submitLabel={label}
      {...(action === 'suspend' ? { submitVariant: 'danger' as const } : {})}
      onSubmit={() => void submit()}
    >
      <p
        role="note"
        className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        {action === 'suspend'
          ? t('it.mobileLines.suspendHint')
          : t('it.mobileLines.reactivateHint')}
      </p>
      <Field label={t('it.mobileLines.statusAt')}>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── History: what happened to the line, and who held it ────────────────────
//
// Rendered from the line's own events, never the audit trail — a chronology in business language
// for anyone who can see the line. Entries are read BY TYPE: an `assigned` entry names its holder;
// no other type's metadata is guessed at.

const EVENT_TONE: Readonly<Record<ItMobileLineEventType, Tone>> = {
  registered: 'neutral',
  updated: 'neutral',
  assigned: 'info',
  returned: 'success',
  suspended: 'warning',
  reactivated: 'brand',
};

/** A metadata value as a short string, or null when there is nothing to show. */
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const HISTORY_PAGE_SIZE = 20;

const LineEvents = ({ lineId }: { lineId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [page, setPage] = useState(1);
  const history = useItMobileLineHistory(lineId, { page, pageSize: HISTORY_PAGE_SIZE });

  /** «إلى: محمد أحمد (0100052)» or «إلى: سيارة 204 — س ص 63» for a hand-over. */
  const holderOf = (entry: ItMobileLineHistoryEntryDto): string | null => {
    if (entry.type !== 'assigned') return null;
    const meta = entry.metadata;
    const name = text(meta.employeeName);
    const code = text(meta.employeeCode);
    const label =
      meta.holderKind === 'vehicle'
        ? mobileLineHolderLabel(t, {
            kind: 'vehicle',
            employeeId: null,
            employeeName: null,
            employeeCode: null,
            vehicleCode: text(meta.vehicleCode),
            vehiclePlate: text(meta.vehiclePlate),
          })
        : name === null
          ? code
          : code === null
            ? name
            : `${name} (${code})`;
    return label === null ? null : t('it.mobileLines.history.to', { name: label });
  };

  if (history.isPending) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (history.isError) {
    return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  }
  const entries = history.data.items;
  if (entries.length === 0) {
    return (
      <EmptyState
        title={t('it.custody.historyEmptyTitle')}
        description={t('it.custody.historyEmptyBody')}
      />
    );
  }
  return (
    <>
      <ol className="space-y-3">
        {entries.map((entry) => {
          const holder = holderOf(entry);
          return (
            <li
              key={entry.id}
              data-line-event={entry.type}
              className="flex gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
            >
              <span className="mt-0.5 shrink-0">
                <Badge tone={EVENT_TONE[entry.type]}>
                  {t(`it.mobileLines.event.${entry.type}`)}
                </Badge>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800 dark:text-slate-100">
                  {formatDateTime(entry.at, locale)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {entry.actorName === ''
                    ? t('it.custody.systemActor')
                    : `${t('it.custody.by')} ${entry.actorName}`}
                </p>
                {holder !== null && (
                  <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">{holder}</p>
                )}
                {entry.notes !== null && entry.notes !== '' && (
                  <p className="mt-1 flex items-start gap-1 text-xs text-slate-600 dark:text-slate-300">
                    <ClipboardIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>{entry.notes}</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {history.data.meta.totalPages > 1 && (
        <Pagination meta={history.data.meta} onPageChange={setPage} />
      )}
    </>
  );
};

export const MobileLineHistoryDialog = ({
  open,
  onClose,
  line,
}: {
  open: boolean;
  onClose: () => void;
  line: ItMobileLineDto;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const caption = useLineCaption();
  const custody = useItMobileLineAssignments(
    { lineId: line.id, pageSize: 50, sortBy: 'assignedAt', sortDir: 'desc' },
    open,
  );

  const columns: Column<ItMobileLineAssignmentDto>[] = [
    {
      key: 'holder',
      header: t('it.custody.holder'),
      render: (a) =>
        mobileLineHolderLabel(t, {
          kind: a.holderKind,
          employeeId: a.assignedToEmployeeId,
          employeeName: a.assignedToEmployeeName,
          employeeCode: a.assignedToEmployeeCode,
          vehicleCode: a.vehicleCode,
          vehiclePlate: a.vehiclePlate,
        }),
    },
    {
      key: 'assignedAt',
      header: t('it.custody.assignedAt'),
      render: (a) => <span className="tabular-nums">{formatDate(a.assignedAt, locale)}</span>,
    },
    {
      key: 'returnedAt',
      header: t('it.custody.returnedAt'),
      render: (a) =>
        a.returnedAt === null ? (
          t('it.custody.open')
        ) : (
          <span className="tabular-nums">{formatDate(a.returnedAt, locale)}</span>
        ),
    },
    {
      key: 'receipt',
      header: t('it.custody.receipt.column'),
      render: (a) => (
        <MobileLineReceiptActions receiptId={a.receiptId} receiptSigned={a.receiptSigned} />
      ),
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('it.mobileLines.history.title')}
      description={caption(line)}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t('it.mobileLines.history.custody')}
          </h4>
          <DataTable
            embedded
            columns={columns}
            rows={custody.data?.items ?? []}
            rowKey={(a) => a.id}
            loading={custody.isLoading}
            error={custody.isError ? custody.error : undefined}
            onRetry={() => void custody.refetch()}
            empty={t('it.mobileLines.history.noCustody')}
          />
        </section>
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t('it.mobileLines.history.events')}
          </h4>
          {open && <LineEvents lineId={line.id} />}
        </section>
      </div>
    </Dialog>
  );
};
