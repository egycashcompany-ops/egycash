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
import { EmployeePicker } from './EmployeePicker';
import {
  useAssignItAsset,
  useDisposeItAsset,
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
  children: React.ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      {...(description === undefined ? {} : { description })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
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

// ── Assign ──────────────────────────────────────────────────────────────────

export const AssignAssetDialog = ({
  open,
  onClose,
  asset,
}: {
  open: boolean;
  onClose: () => void;
  asset: ItAssetDto;
}): JSX.Element => {
  const t = useT();
  const assign = useAssignItAsset();
  const [employeeId, setEmployeeId] = useState('');
  const [employeeLabel, setEmployeeLabel] = useState('');
  const [assignedAt, setAssignedAt] = useState('');
  const [expectedReturnAt, setExpectedReturnAt] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmployeeId('');
      setEmployeeLabel('');
      setAssignedAt(nowLocal());
      setExpectedReturnAt('');
      setCondition('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  const orderWrong =
    expectedReturnAt !== '' && assignedAt !== '' && expectedReturnAt < assignedAt;

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await assign.mutateAsync({
        id: asset.id,
        body: {
          employeeId,
          ...(assignedAt === '' ? {} : { assignedAt: new Date(assignedAt) }),
          ...(expectedReturnAt === ''
            ? {}
            : { expectedReturnAt: new Date(expectedReturnAt) }),
          ...(condition.trim() === '' ? {} : { conditionOnIssue: condition.trim() }),
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        },
      });
      toast.success(t('it.custody.assigned'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t('it.custody.assign')}
      description={`${asset.assetCode} — ${asset.name}`}
      error={error}
      busy={assign.isPending}
      canSubmit={employeeId !== '' && !orderWrong}
      submitLabel={t('it.custody.assign')}
      onSubmit={() => void submit()}
    >
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
      <Field label={t('it.custody.conditionOnIssue')} hint={t('it.custody.conditionHint')}>
        <Input value={condition} onChange={(e) => setCondition(e.target.value)} />
      </Field>
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
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
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmployeeId('');
      setEmployeeLabel('');
      setBranchId('');
      setAt(nowLocal());
      setNotes('');
      setError(null);
    }
  }, [open]);

  // A transfer must MOVE something. The server enforces this too; catching it here saves the user
  // a round trip to be told they changed nothing.
  const movesHolder = employeeId !== '' && employeeId !== current?.assignedToEmployeeId;
  const movesBranch = branchId !== '' && branchId !== asset.branchId;
  const canSubmit = movesHolder || movesBranch;

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await transfer.mutateAsync({
        id: asset.id,
        body: {
          ...(movesHolder ? { toEmployeeId: employeeId } : {}),
          ...(movesBranch ? { toBranchId: branchId } : {}),
          ...(at === '' ? {} : { at: new Date(at) }),
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
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
    >
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('it.custody.transferHint')}</p>
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
