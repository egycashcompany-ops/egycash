// Create a ticket, and the transitions that carry a required fact (design §4.4).
//
// Each dialog is thin: the SERVER owns the state machine, so these shape a payload and surface the
// verdict. What they DO decide is which action is even offered — that lives on the detail page, and
// an action the machine could not accept is never rendered.
import { useEffect, useState } from 'react';
import { type ItTicketDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { localized } from '../../../shared/lib/format';
import { ItCatalogSelect } from './ItCatalogSelect';
import { UserPicker } from './UserPicker';
import {
  useAssignItTicket,
  useCancelItTicket,
  useChangeItTicketStatus,
  useCloseItTicket,
  useCreateItTicket,
  useItTicketPriorities,
  useReopenItTicket,
  useResolveItTicket,
  useUpdateItTicket,
} from '../api/it-queries';

const message = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

// ── Create ──────────────────────────────────────────────────────────────────

export const CreateTicketDialog = ({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (ticket: ItTicketDto) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const create = useCreateItTicket();
  const priorities = useItTicketPriorities();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setCategoryId('');
      setPriorityId('');
      setError(null);
    }
  }, [open]);

  // Default to the mildest ACTIVE priority rather than the first row, so a careless Enter never
  // opens a critical ticket.
  const active = (priorities.data?.items ?? []).filter((p) => p.isActive);
  useEffect(() => {
    if (open && priorityId === '' && active.length > 0) {
      setPriorityId(active[active.length - 1]?.id ?? '');
    }
  }, [open, active.length]);

  const complete = title.trim() !== '' && description.trim() !== '' && categoryId !== '' && priorityId !== '';

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      const ticket = await create.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        categoryId,
        priorityId,
      });
      toast.success(t('it.tickets.created'));
      onCreated?.(ticket);
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('it.tickets.create')}
      description={t('it.tickets.createHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} disabled={!complete} onClick={() => void submit()}>
            {t('it.tickets.submit')}
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
      <div className="space-y-4">
        <Field label={t('it.tickets.fields.title')} required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('it.tickets.fields.description')} required hint={t('it.tickets.descriptionHint')}>
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('it.tickets.fields.category')} required>
            <ItCatalogSelect
              kind="ticketCategory"
              value={categoryId}
              onChange={setCategoryId}
              className="w-full"
              ariaLabel={t('it.tickets.fields.category')}
            />
          </Field>
          <Field label={t('it.tickets.fields.priority')} required hint={t('it.tickets.priorityHint')}>
            <Select value={priorityId} onChange={(e) => setPriorityId(e.target.value)}>
              <option value="">{t('common.select')}</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {localized(p.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
};

// ── Edit ────────────────────────────────────────────────────────────────────

/**
 * Editing the ticket's OWN fields — never its status, which moves only through a named transition
 * (§4.4), and never its SLA, which was snapshotted at creation and is not recomputed when the
 * priority changes (§2.6). Changing the priority here writes a `priorityChanged` row and moves
 * nothing else; the dialog says so rather than letting an editor assume otherwise.
 *
 * `version` rides along, so a concurrent edit answers 409 instead of silently winning.
 */
export const EditTicketDialog = ({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket: ItTicketDto;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const update = useUpdateItTicket();
  const priorities = useItTicketPriorities();
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [categoryId, setCategoryId] = useState(ticket.categoryId);
  const [priorityId, setPriorityId] = useState(ticket.priorityId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(ticket.title);
      setDescription(ticket.description);
      setCategoryId(ticket.categoryId);
      setPriorityId(ticket.priorityId);
      setError(null);
    }
  }, [open, ticket]);

  // An archived priority still shows while it is the ticket's own, so the select never silently
  // reassigns a ticket to a different SLA just because an admin retired the row.
  const options = (priorities.data?.items ?? []).filter(
    (p) => p.isActive || p.id === ticket.priorityId,
  );
  const complete = title.trim() !== '' && description.trim() !== '' && categoryId !== '' && priorityId !== '';

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await update.mutateAsync({
        id: ticket.id,
        body: {
          title: title.trim(),
          description: description.trim(),
          categoryId,
          priorityId,
          version: ticket.version,
        },
      });
      toast.success(t('it.tickets.updated'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('it.tickets.editTitle')}
      description={ticket.ticketCode}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={update.isPending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
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
      <div className="space-y-4">
        <Field label={t('it.tickets.fields.title')} required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('it.tickets.fields.description')} required>
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('it.tickets.fields.category')} required>
            <ItCatalogSelect
              kind="ticketCategory"
              value={categoryId}
              onChange={setCategoryId}
              className="w-full"
              ariaLabel={t('it.tickets.fields.category')}
            />
          </Field>
          <Field
            label={t('it.tickets.fields.priority')}
            required
            hint={t('it.tickets.priorityEditHint')}
          >
            <Select value={priorityId} onChange={(e) => setPriorityId(e.target.value)}>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {localized(p.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
};

// ── The transitions that carry a required fact ─────────────────────────────

const ActionDialog = ({
  open,
  onClose,
  title,
  description,
  label,
  hint,
  required,
  submitLabel,
  variant,
  busy,
  run,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  label: string;
  hint?: string;
  required: boolean;
  submitLabel: string;
  variant?: 'primary' | 'danger';
  busy: boolean;
  run: (text: string) => Promise<void>;
}): JSX.Element => {
  const t = useT();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await run(text.trim());
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={variant ?? 'primary'}
            loading={busy}
            disabled={required && text.trim() === ''}
            onClick={() => void submit()}
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
      <Field label={label} required={required} {...(hint === undefined ? {} : { hint })}>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Dialog>
  );
};

export const ResolveTicketDialog = ({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket: ItTicketDto;
}): JSX.Element => {
  const t = useT();
  const resolve = useResolveItTicket();
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('it.tickets.resolve')}
      description={ticket.ticketCode}
      label={t('it.tickets.resolutionSummary')}
      hint={t('it.tickets.resolutionHint')}
      required
      submitLabel={t('it.tickets.resolve')}
      busy={resolve.isPending}
      run={async (summary) => {
        await resolve.mutateAsync({ id: ticket.id, body: { summary } });
        toast.success(t('it.tickets.resolved'));
      }}
    />
  );
};

export const HoldTicketDialog = ({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket: ItTicketDto;
}): JSX.Element => {
  const t = useT();
  const change = useChangeItTicketStatus();
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('it.tickets.hold')}
      description={ticket.ticketCode}
      label={t('it.tickets.holdReason')}
      hint={t('it.tickets.holdHint')}
      required
      submitLabel={t('it.tickets.hold')}
      busy={change.isPending}
      run={async (reason) => {
        await change.mutateAsync({ id: ticket.id, body: { to: 'onHold', reason } });
        toast.success(t('it.tickets.held'));
      }}
    />
  );
};

export const ReopenTicketDialog = ({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket: ItTicketDto;
}): JSX.Element => {
  const t = useT();
  const reopen = useReopenItTicket();
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('it.tickets.reopen')}
      description={ticket.ticketCode}
      label={t('it.tickets.reopenReason')}
      required
      submitLabel={t('it.tickets.reopen')}
      busy={reopen.isPending}
      run={async (reason) => {
        await reopen.mutateAsync({ id: ticket.id, body: { reason } });
        toast.success(t('it.tickets.reopened'));
      }}
    />
  );
};

export const CancelTicketDialog = ({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket: ItTicketDto;
}): JSX.Element => {
  const t = useT();
  const cancel = useCancelItTicket();
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('it.tickets.cancel')}
      description={ticket.ticketCode}
      label={t('it.tickets.cancelReason')}
      hint={t('it.tickets.cancelHint')}
      required
      submitLabel={t('it.tickets.cancel')}
      variant="danger"
      busy={cancel.isPending}
      run={async (reason) => {
        await cancel.mutateAsync({ id: ticket.id, body: { reason } });
        toast.success(t('it.tickets.cancelled'));
      }}
    />
  );
};

export const CloseTicketDialog = ({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket: ItTicketDto;
}): JSX.Element => {
  const t = useT();
  const close = useCloseItTicket();
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('it.tickets.close')}
      description={ticket.ticketCode}
      label={t('it.tickets.closeNote')}
      required={false}
      submitLabel={t('it.tickets.close')}
      busy={close.isPending}
      run={async (note) => {
        await close.mutateAsync({ id: ticket.id, body: note === '' ? {} : { note } });
        toast.success(t('it.tickets.closed'));
      }}
    />
  );
};

// ── Assign ──────────────────────────────────────────────────────────────────

export const AssignTicketDialog = ({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket: ItTicketDto;
}): JSX.Element => {
  const t = useT();
  const assign = useAssignItTicket();
  const [userId, setUserId] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setUserId('');
      setLabel('');
      setNote('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await assign.mutateAsync({
        id: ticket.id,
        body: { technicianUserId: userId, ...(note.trim() === '' ? {} : { note: note.trim() }) },
      });
      toast.success(t('it.tickets.assigned'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('it.tickets.assign')}
      description={ticket.ticketCode}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={assign.isPending} disabled={userId === ''} onClick={() => void submit()}>
            {t('it.tickets.assign')}
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
      <div className="space-y-4">
        {/* Assigning an `open` ticket also starts it (§4.4) — say so, do not surprise. */}
        {ticket.status === 'open' && (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:bg-brand-950/40 dark:text-brand-200">
            {t('it.tickets.assignStartsWork')}
          </p>
        )}
        <Field label={t('it.tickets.technician')} required>
          <UserPicker
            value={userId}
            valueLabel={label}
            onChange={(id, name) => {
              setUserId(id);
              setLabel(name);
            }}
            ariaLabel={t('it.tickets.technician')}
          />
        </Field>
        <Field label={t('it.assets.fields.notes')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
