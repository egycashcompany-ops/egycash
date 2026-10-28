// The /atm/data-edit entry forms, in the fleet-catalogs shape: one item per dialog, version-aware
// on edit, `isActive` as the archive switch rather than a delete.
//
// The legacy's BULK paste is not lost — it lives in `BulkMachinesDialog` below, reached from the
// machines tab. Pasting a column of codes beside a column of names is how a bank's new batch of
// ATMs actually arrives (contad_app.js:2412-2466), and a per-item form is a poor way to enter
// forty of them; the per-item form is the better way to fix ONE of them, which the legacy had no
// way to do at all.
//
// Who opens which (D2, docs/12-planning/atm-efficiency-register.md §8.4). The page does the gating:
//   · `MachineDialog` and `BulkMachinesDialog` are `atmMachine.manage` only. Adding, archiving and
//     deleting a machine decide whether it exists, and the Efficiency register decides that now.
//   · `RefLabelDialog` also serves Operations: add under `atmRefLabel.create`, rename and the
//     archive toggle under `atmRefLabel.edit`. A label is never deleted from this page.
//   · `MachineAreaDialog` is Operations' area move (`atmMachine.moveArea`): the area and nothing
//     else.
//
// WHAT THE PICKERS OFFER (DEC-35, DEC-38). Every machine dialog reads `GET /atm/ref-labels/options`
// for ONE branch — the acting branch on add, the machine's own on edit and move — so the lists are
// whole (no 100-row page), hold no other branch's labels, and need no `atmMachine.view`:
//   · banks grouped by catalog bank («البنك الأهلي المصري» → NBE, NBE FOREX); the value is the text
//     the machine stores, and the server resolves its bank;
//   · areas in the reader's language, with the stored name after it when the two differ;
//   · the machine's CURRENT bank and area always (critic gap 3: a value that is not a label —
//     typed by the register, or archived — used to leave the select on its placeholder).
//
// AN ADD LANDS IN THE REGISTER (DEC-36). The owner's call (final): a machine added here is recorded
// in the Efficiency register as an OPEN receipt dated the add day, linked to the machine and flagged
// «بيانات ناقصة». The server answers what it did on the register's side and the toast says so — and
// the dialog says BEFORE the click when this branch cannot be recorded at all (the register is not
// mapped to it).
//
// AN ADD SAYS WHERE IT FILES (GM-20 for ATM, 2026-10-28). The add forms open on «الفرع: …», the
// branch the server will write: for an organization-wide user the top bar's, never their home
// placement — the owner's report was a machine that showed only under «كل الشركة». On «الشركة كلها»
// in a company of several branches the server names none, and the form asks for a branch in the
// top bar instead of letting the add through. The bulk delete-by-codes waits for that branch too:
// it finds the codes in the acting branch exactly as the add files there (DEC-39, `addBranchOf`),
// so without one every delete was refused with the add's own message.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ErrorCodes,
  normalizeAtmMachineCode,
  splitAtmFormLines,
  type AtmMachineCreateResultDto,
  type AtmMachineDto,
  type AtmRefLabelDto,
  type AtmRefLabelOptionsDto,
  type BulkCreateAtmMachinesResultDto,
  type CreateAtmRefLabel,
  type Locale,
  type UpdateAtmMachineArea,
  type UpdateAtmRefLabel,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast, type ToastVariant } from '../../../shared/ui/toast/toast-store';
import {
  useAtmBankLookup,
  useAtmRefLabelOptions,
  useBulkCreateAtmMachines,
  useBulkDeleteAtmMachines,
  useCreateAtmMachine,
  useCreateAtmRefLabel,
  useUpdateAtmMachine,
  useUpdateAtmMachineArea,
  useUpdateAtmRefLabel,
} from '../api/atm-queries';
import { areaOptionText, bankOptionGroups, labelText, type BankLookup } from '../lib/bank-catalog';

/**
 * A refused label save in the reader's words. Only the 409 is "already exists" — the legacy's
 * «موجود قبل كدا» (:2474); a 403 (no reach over the branch) or anything else says what it is
 * (review finding F1: every failure used to read "already exists"). Two 409s say more:
 *   · a spelling that is already a catalog bank's own Operations label (`ATM_BANK_LABEL_TAKEN`) —
 *     it needs no spelling, the bank already answers to it;
 *   · a NEW area whose name is taken: areas are one label per spelling (EG-6), so the way forward
 *     is to give the existing label its other language, which the text says.
 */
export const refLabelErrorText = (
  error: unknown,
  t: (key: string) => string,
  locale: Locale,
  options: { areaCreate?: boolean } = {},
): string => {
  if (!(error instanceof ApiError) || error.status !== 409) return errorMessage(error, locale);
  if (error.code === ErrorCodes.ATM_BANK_LABEL_TAKEN) return t('atm.dataEdit.spellingIsBankLabel');
  return t(options.areaCreate === true ? 'atm.dataEdit.areaExists' : 'atm.dataEdit.labelExists');
};

/**
 * The register's «+ منطقة» refused because the branch already has an area under that name: the
 * name to put in the entry's area box instead, else null. Only for a NEW area (a 409 that is not
 * `ATM_BANK_LABEL_TAKEN`): the unique index matches `name` exactly and a dialog area stores its
 * English name trimmed, so the typed English text IS the existing row's stored name — archived or
 * not, and the register accepts that text when typed (its label upsert never revives an archived
 * one). The data-edit text («…من «تعديل»») sends the reader to an edit Efficiency neither has on the
 * register nor holds the key for (review finding).
 */
export const existingAreaName = (
  error: unknown,
  kind: 'bank' | 'area',
  creating: boolean,
  form: Pick<RefLabelForm, 'nameEn'>,
): string | null => {
  if (kind !== 'area' || !creating) return null;
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  if (error.code === ErrorCodes.ATM_BANK_LABEL_TAKEN) return null;
  const name = form.nameEn.trim();
  return name === '' ? null : name;
};

// ── What an add did, and why it was refused ─────────────────────────────────────────────────────

/** The two refusals the add reuses from the register (D6, DEC-9) — the other branch is not named. */
const ADD_REFUSALS: Readonly<Record<string, string>> = {
  [ErrorCodes.ATM_REGISTER_CODE_ACTIVE_ELSEWHERE]: 'atm.dataEdit.error.activeElsewhere',
  [ErrorCodes.ATM_REGISTER_OPEN_PERIOD_EXISTS]: 'atm.dataEdit.error.openElsewhere',
};

/**
 * A refused single add in the reader's words: the code active or open in ANOTHER branch, an
 * archived catalog bank (`body.bankName INACTIVE`), the code already active here — and anything
 * else as itself, where every failure used to read "already registered".
 */
export const machineAddErrorText = (
  error: unknown,
  t: (key: string) => string,
  locale: Locale,
): string => {
  if (error instanceof ApiError) {
    const refusal = ADD_REFUSALS[error.code];
    if (refusal !== undefined) return t(refusal);
    if ((error.details ?? []).some((d) => d.field === 'body.bankName' && d.code === 'INACTIVE')) {
      return t('atm.dataEdit.error.bankInactive');
    }
    if (error.status === 409) return t('atm.dataEdit.codeTaken');
  }
  return errorMessage(error, locale);
};

export interface AddToast {
  variant: ToastVariant;
  title: string;
  description: string;
}

/**
 * An add's answer as an OLDER server sends it — a rollback, or a tab on this bundle during a rolling
 * deploy: the bare machine (single) or `{ created, skippedCodes }` (bulk), with none of the register
 * fields. Read through these so a machine the server DID add is never reported as a failure (and a
 * retry then refused as a taken code).
 */
type OlderAddResult = Omit<AtmMachineCreateResultDto, 'register' | 'reactivated'> &
  Partial<Pick<AtmMachineCreateResultDto, 'register' | 'reactivated'>>;
type OlderBulkAddResult = Pick<BulkCreateAtmMachinesResultDto, 'created' | 'skippedCodes'> &
  Partial<Omit<BulkCreateAtmMachinesResultDto, 'created' | 'skippedCodes'>>;

/**
 * The single add's toast: what happened to the machine (added, or an archived one brought back to
 * work), then what the register recorded. `none/noBank` is a warning — the machine works, but
 * Efficiency will not see it until its bank text is linked to a bank. An answer with no register
 * block (an older server) is a plain «added»: the server never said what the register did.
 */
export const machineAddToast = (result: OlderAddResult, t: (key: string) => string): AddToast => {
  const title = t(
    result.reactivated === true ? 'atm.dataEdit.machineReactivated' : 'atm.dataEdit.machineAdded',
  );
  if (result.register === undefined) return { variant: 'success', title, description: '' };
  const { action, reason } = result.register;
  const outcome =
    action === 'created' || action === 'received'
      ? 'recorded'
      : action === 'linked' || action === 'existing'
        ? 'linked'
        : (reason ?? 'noBank');
  return {
    variant: outcome === 'noBank' ? 'warning' : 'success',
    title,
    description: t(`atm.dataEdit.register.${outcome}`),
  };
};

/** A bulk answer with every register field present — empty where an older server sent none. */
export const bulkAddResultOf = (result: OlderBulkAddResult): BulkCreateAtmMachinesResultDto => ({
  created: result.created,
  skippedCodes: result.skippedCodes,
  reactivatedCodes: result.reactivatedCodes ?? [],
  refused: result.refused ?? [],
  register: {
    created: result.register?.created ?? [],
    received: result.register?.received ?? [],
    linked: result.register?.linked ?? [],
    existing: result.register?.existing ?? [],
    notRecorded: result.register?.notRecorded ?? [],
  },
});

/**
 * The bulk add's report, one toast per kind of answer: how many were added and recorded, then the
 * codes the reader must act on or know about — brought back from the archive, refused because the
 * code lives in another branch, or added but not recorded in the register (and why).
 */
export const bulkAddToasts = (
  answer: OlderBulkAddResult,
  t: (key: string, params?: Record<string, string | number>) => string,
): { variant: ToastVariant; title: string }[] => {
  const result = bulkAddResultOf(answer);
  const codes = (list: readonly string[]): string => list.join('، ');
  const out: { variant: ToastVariant; title: string }[] = [];
  if (result.created.length > 0) {
    out.push({
      variant: 'success',
      title: t('atm.dataEdit.machinesAdded', { count: result.created.length }),
    });
  }
  const recorded = result.register.created.length + result.register.received.length;
  if (recorded > 0) {
    out.push({
      variant: 'success',
      title: t('atm.dataEdit.machinesRecorded', { count: recorded }),
    });
  }
  const linked = result.register.linked.length + result.register.existing.length;
  if (linked > 0) {
    out.push({ variant: 'success', title: t('atm.dataEdit.machinesLinked', { count: linked }) });
  }
  if (result.reactivatedCodes.length > 0) {
    out.push({
      variant: 'info',
      title: t('atm.dataEdit.machinesReactivated', { codes: codes(result.reactivatedCodes) }),
    });
  }
  if (result.skippedCodes.length > 0) {
    out.push({
      variant: 'error',
      title: t('atm.dataEdit.machinesSkipped', { codes: codes(result.skippedCodes) }),
    });
  }
  for (const reason of ['activeElsewhere', 'openElsewhere'] as const) {
    const refused = result.refused.filter((r) => r.reason === reason).map((r) => r.machineCode);
    if (refused.length > 0) {
      out.push({
        variant: 'error',
        title: t(`atm.dataEdit.machinesRefused.${reason}`, { codes: codes(refused) }),
      });
    }
  }
  for (const reason of ['branchUnmapped', 'placeholderCode', 'noBank'] as const) {
    const missed = result.register.notRecorded
      .filter((r) => r.reason === reason)
      .map((r) => r.machineCode);
    if (missed.length > 0) {
      out.push({
        variant: 'warning',
        title: t(`atm.dataEdit.notRecorded.${reason}`, { codes: codes(missed) }),
      });
    }
  }
  return out;
};

/** Code/name line pairs → machine rows; blank lines dropped, as the legacy loop did. */
export const buildMachineRows = (
  codesRaw: string,
  namesRaw: string,
): { machineCode: string; name: string }[] => {
  const codes = splitAtmFormLines(codesRaw);
  const names = splitAtmFormLines(namesRaw);
  return codes
    .map((code, index) => ({
      machineCode: normalizeAtmMachineCode(code),
      name: names[index] ?? '',
    }))
    .filter((row) => row.machineCode !== '' && row.name !== '');
};

// ── The pick lists ──────────────────────────────────────────────────────────────────────────────

/**
 * The bank select's options: one group per catalog bank, each value the text the machine stores.
 * `current` (the machine's own text) leads when no group offers it, so the select opens on the
 * truth and an edit of the name alone keeps the bank as it was.
 */
export const BankOptions = ({
  options,
  lookup,
  locale,
  current = '',
}: {
  options: AtmRefLabelOptionsDto | undefined;
  lookup: BankLookup;
  locale: Locale;
  current?: string;
}): JSX.Element => {
  const groups = bankOptionGroups(options?.banks ?? [], lookup, locale);
  const listed = current === '' || groups.some((group) => group.values.includes(current));
  return (
    <>
      {!listed && <option value={current}>{current}</option>}
      {groups.map((group) => (
        <optgroup key={group.code} label={group.label}>
          {group.values.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
};

/** The branch's areas in the reader's language, by that text. */
const sortedAreas = (
  options: AtmRefLabelOptionsDto | undefined,
  locale: Locale,
): AtmRefLabelOptionsDto['areas'] =>
  [...(options?.areas ?? [])].sort((a, b) =>
    labelText(a, locale).localeCompare(labelText(b, locale), locale),
  );

/**
 * The area select's options; `current` as in `BankOptions`. `currentDisabled` keeps it from being
 * picked again where the choice must CHANGE it (the area move).
 */
export const AreaOptions = ({
  options,
  locale,
  current = '',
  currentDisabled = false,
}: {
  options: AtmRefLabelOptionsDto | undefined;
  locale: Locale;
  current?: string;
  currentDisabled?: boolean;
}): JSX.Element => {
  const areas = sortedAreas(options, locale);
  const listed = current === '' || areas.some((area) => area.name === current);
  return (
    <>
      {!listed && (
        <option value={current} disabled={currentDisabled}>
          {current}
        </option>
      )}
      {areas.map((area) => (
        <option key={area.name} value={area.name}>
          {areaOptionText(area, locale)}
        </option>
      ))}
    </>
  );
};

/**
 * No branch to add in: the server named none (`branch: null` — «الشركة كلها» while the company has
 * several branches), so the add — and the bulk delete-by-codes, which looks its codes up in that
 * same branch — waits for a branch chosen in the top bar. An older server that names no branch at
 * all (`branch` absent) blocks nothing, as before.
 */
export const addBlocked = (options: AtmRefLabelOptionsDto | undefined): boolean =>
  options?.branch === null;

/**
 * The top of an add form (of the whole bulk dialog): the branch the add files into, «الفرع: …», as
 * the top bar names it — or, when there is none, the request to choose one there first.
 */
const AddBranchLine = ({
  options,
}: {
  options: AtmRefLabelOptionsDto | undefined;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branch = options?.branch;
  if (branch === undefined) return null;
  return branch === null ? (
    <p
      role="status"
      data-add-branch="none"
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
    >
      {t('atm.dataEdit.chooseBranch')}
    </p>
  ) : (
    <p
      data-add-branch={branch.id}
      className="text-sm font-medium text-slate-700 dark:text-slate-200"
    >
      {t('atm.dataEdit.addInBranch', { name: branch.name[locale] })}
    </p>
  );
};

/**
 * Said BEFORE an add when the register is not mapped to the branch (DEC-10): the machine still
 * works for Operations, but nothing can be recorded in the register for it. Not when there is no
 * branch at all — `AddBranchLine` says that.
 */
const UnmappedBranchNotice = ({
  options,
}: {
  options: AtmRefLabelOptionsDto | undefined;
}): JSX.Element | null => {
  const t = useT();
  return options?.registerMapped === false && !addBlocked(options) ? (
    <p
      data-register-unmapped="true"
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
    >
      {t('atm.dataEdit.notRegisterMapped')}
    </p>
  ) : null;
};

export const MachineDialog = ({
  open,
  onClose,
  machine,
}: {
  open: boolean;
  onClose: () => void;
  /** null = add; a document = version-aware edit (the code is identity and stays read-only). */
  machine: AtmMachineDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // Seeded from the props — the dialog opens on the machine's values — and re-seeded on each open.
  const [machineCode, setMachineCode] = useState(machine?.machineCode ?? '');
  const [name, setName] = useState(machine?.name ?? '');
  const [bankName, setBankName] = useState(machine?.bankName ?? '');
  const [area, setArea] = useState(machine?.area ?? '');
  const [isActive, setIsActive] = useState(machine?.isActive ?? true);

  useEffect(() => {
    if (!open) return;
    setMachineCode(machine?.machineCode ?? '');
    setName(machine?.name ?? '');
    setBankName(machine?.bankName ?? '');
    setArea(machine?.area ?? '');
    setIsActive(machine?.isActive ?? true);
  }, [open, machine]);

  // An add files into the acting branch; an edit offers the machine's OWN branch's lists.
  const options = useAtmRefLabelOptions(machine?.branchId ?? null, open);
  const lookup = useAtmBankLookup();
  const create = useCreateAtmMachine();
  const update = useUpdateAtmMachine();
  const pending = create.isPending || update.isPending;
  const complete =
    name.trim() !== '' &&
    bankName !== '' &&
    area !== '' &&
    (machine !== null ||
      (normalizeAtmMachineCode(machineCode) !== '' && !addBlocked(options.data)));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!complete) return;
    if (machine === null) {
      try {
        const result = await create.mutateAsync({
          machineCode: normalizeAtmMachineCode(machineCode),
          name: name.trim(),
          bankName,
          area,
        });
        const shown = machineAddToast(result, t);
        toast[shown.variant](shown.title, shown.description);
        onClose();
      } catch (error) {
        toast.error(machineAddErrorText(error, t, locale));
      }
      return;
    }
    try {
      await update.mutateAsync({
        id: machine.id,
        body: { name: name.trim(), bankName, area, isActive, version: machine.version },
      });
      toast.success(t('atm.dataEdit.machineSaved'));
      onClose();
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={machine === null ? t('atm.dataEdit.addMachine') : t('atm.dataEdit.editMachine')}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {machine === null && <AddBranchLine options={options.data} />}
        {machine === null && <UnmappedBranchNotice options={options.data} />}
        <Field
          label={t('atm.common.machineId')}
          required
          hint={machine === null ? undefined : t('atm.dataEdit.codeIsIdentity')}
        >
          <Input
            value={machineCode}
            onChange={(e) => setMachineCode(e.target.value)}
            disabled={machine !== null}
            required={machine === null}
            dir="ltr"
          />
        </Field>
        <Field label={t('atm.dataEdit.machineName')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t('atm.common.bank')} required>
          <Select value={bankName} onChange={(e) => setBankName(e.target.value)} required>
            <option value="" disabled>
              {t('atm.dataEdit.pickBank')}
            </option>
            <BankOptions
              options={options.data}
              lookup={lookup}
              locale={locale}
              current={machine?.bankName ?? ''}
            />
          </Select>
        </Field>
        <Field label={t('atm.common.area')} required>
          <Select value={area} onChange={(e) => setArea(e.target.value)} required>
            <option value="" disabled>
              {t('atm.dataEdit.pickArea')}
            </option>
            <AreaOptions options={options.data} locale={locale} current={machine?.area ?? ''} />
          </Select>
        </Field>
        {machine !== null && (
          <div className="space-y-1">
            <Checkbox
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              label={t('atm.dataEdit.isActive')}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('atm.dataEdit.isActiveHint')}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button type="submit" loading={pending} disabled={!complete}>
            {t('atm.common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

/** The area move's whole request: the new area and the row's version. The schema is strict. */
export const machineAreaBody = (machine: AtmMachineDto, area: string): UpdateAtmMachineArea => ({
  area,
  version: machine.version,
});

/**
 * Operations' «نقل ماكينة لمنطقة» (contad_app.js:2529-2541). The legacy form took a typed machine
 * number and a new area and set the area alone. This dialog opens on a row, so the code and name
 * are shown read-only and only the area can change. The server moves the machine's open register
 * period to the same area in the same write (DEC-4), and the hint says so before the click.
 */
export const MachineAreaDialog = ({
  open,
  onClose,
  machine,
}: {
  open: boolean;
  onClose: () => void;
  machine: AtmMachineDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The machine's own branch's ACTIVE areas — the same list its full edit offers.
  const options = useAtmRefLabelOptions(machine?.branchId ?? null, open && machine !== null);
  const [area, setArea] = useState(machine?.area ?? '');

  useEffect(() => {
    if (!open) return;
    setArea(machine?.area ?? '');
  }, [open, machine]);

  const move = useUpdateAtmMachineArea();
  const current = machine?.area ?? '';
  // A machine may be moved BECAUSE its area was archived. That area is then missing from the
  // active list, and a select with no matching option would show the first area as if it were
  // the current one. So it stays listed but cannot be picked, and the dialog opens on the truth.
  const changed = area !== '' && area !== current;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (machine === null || !changed) return;
    try {
      await move.mutateAsync({ id: machine.id, body: machineAreaBody(machine, area) });
      toast.success(t('atm.dataEdit.areaMoved'));
      onClose();
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('atm.dataEdit.moveAreaTitle', { code: machine?.machineCode ?? '' })}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label={t('atm.common.machineId')}>
          <Input value={machine?.machineCode ?? ''} disabled dir="ltr" />
        </Field>
        <Field label={t('atm.dataEdit.machineName')}>
          <Input value={machine?.name ?? ''} disabled />
        </Field>
        <Field label={t('atm.common.area')} required hint={t('atm.dataEdit.moveAreaHint')}>
          <Select value={area} onChange={(e) => setArea(e.target.value)} required>
            <option value="" disabled>
              {t('atm.dataEdit.pickArea')}
            </option>
            <AreaOptions options={options.data} locale={locale} current={current} currentDisabled />
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button type="submit" loading={move.isPending} disabled={!changed}>
            {t('atm.common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

/** The label dialog's fields as typed. */
export interface RefLabelForm {
  /** Spellings: the text. Areas: the stored name (edit only — a new area's is its English name). */
  name: string;
  nameAr: string;
  nameEn: string;
  /** Spellings: the catalog bank; '' = not linked (edit only). */
  bankCode: string;
  isActive: boolean;
}

/** The form a label dialog opens on. */
/**
 * The form a label dialog opens on. `activate` opens an existing row ACTIVE whatever its state: the
 * spellings callout's «ربط ببنك» means "make this text count as its bank", and a row left archived
 * would leave the text unmapped and the callout entry in place after the save.
 */
export const refLabelFormOf = (
  label: AtmRefLabelDto | null,
  presetName = '',
  activate = false,
): RefLabelForm => ({
  name: label?.name ?? presetName,
  nameAr: label?.nameAr ?? '',
  nameEn: label?.nameEn ?? '',
  bankCode: label?.bankCode ?? '',
  isActive: activate || (label?.isActive ?? true),
});

/**
 * POST /atm/ref-labels/:kind. A spelling names its bank (the server requires an ACTIVE one); a new
 * area gives BOTH names and the server stores the English one on machines (the owner: «الإنجليزي
 * تمام» — stored areas are Latin, MOHNDESSEN, ALEX, and the import's ` FX` rule reads Latin).
 */
export const refLabelCreateBody = (
  kind: 'bank' | 'area',
  form: RefLabelForm,
  branchId?: string,
): CreateAtmRefLabel => ({
  ...(kind === 'bank'
    ? { name: form.name.trim(), bankCode: form.bankCode }
    : { nameAr: form.nameAr.trim(), nameEn: form.nameEn.trim() }),
  // Absent = the acting branch, as before; the register names the branch of the entry it edits.
  ...(branchId === undefined ? {} : { branchId }),
});

/**
 * PATCH /atm/ref-labels/:kind/:id — only what changed, and the version. An unchanged name is not
 * sent, so a save that only adds a translation never records a rename (`formerNames`); an unchanged
 * bank is not sent, so a spelling of a bank archived since still saves its other fields.
 */
export const refLabelUpdateBody = (
  kind: 'bank' | 'area',
  label: AtmRefLabelDto,
  form: RefLabelForm,
): UpdateAtmRefLabel => {
  const name = form.name.trim();
  const body: UpdateAtmRefLabel = { isActive: form.isActive, version: label.version };
  if (name !== label.name) body.name = name;
  if (kind === 'bank') {
    const bankCode = form.bankCode === '' ? null : form.bankCode;
    if (bankCode !== label.bankCode) body.bankCode = bankCode;
  } else {
    const nameAr = form.nameAr.trim() === '' ? null : form.nameAr.trim();
    const nameEn = form.nameEn.trim() === '' ? null : form.nameEn.trim();
    if (nameAr !== label.nameAr) body.nameAr = nameAr;
    if (nameEn !== label.nameEn) body.nameEn = nameEn;
  }
  return body;
};

/** Whether the label form can be sent. */
export const refLabelFormComplete = (
  kind: 'bank' | 'area',
  creating: boolean,
  form: RefLabelForm,
): boolean => {
  if (kind === 'area' && creating) return form.nameAr.trim() !== '' && form.nameEn.trim() !== '';
  if (form.name.trim() === '') return false;
  return kind === 'area' || !creating || form.bankCode !== '';
};

/**
 * One label — an Operations spelling of a catalog bank (`kind: 'bank'`) or an area.
 *
 *   · A spelling is a text Operations write for a bank (`NBE FOREX` → NBE): the dialog asks for the
 *     text and its bank. `presetName` comes from «ربط ببنك» on the unmapped callout, which offers
 *     the very text machines already carry.
 *   · A new area asks for its name in Arabic AND English, and shows the name machines will store
 *     before the click: «يُحفظ على الماكينات باسم: …».
 *   · Editing an area shows the stored name beside the two display names. A rename does not move
 *     the machines (it never did): the dialog says so when the stored name changes.
 *   · The register's «+ منطقة» opens it too, for the branch of the entry being filled in
 *     (`branchId`) — Efficiency add areas with the register keys they hold (DEC-39) — and puts the
 *     stored name of the new area into the form (`onSaved`), or, when the branch already has an
 *     area by that name, that one (`onExisting`).
 */
export const RefLabelDialog = ({
  open,
  onClose,
  kind,
  label,
  presetName = '',
  activate = false,
  branchId,
  onSaved,
  onExisting,
}: {
  open: boolean;
  onClose: () => void;
  kind: 'bank' | 'area';
  label: AtmRefLabelDto | null;
  /** A new spelling's text, filled in («ربط ببنك»). */
  presetName?: string;
  /** Open an existing row active (`refLabelFormOf`) — «ربط ببنك» on an archived spelling. */
  activate?: boolean;
  /** The branch a NEW label is filed in; absent = the acting branch. */
  branchId?: string;
  /** After a successful save, with the label as the server stored it. */
  onSaved?: (label: AtmRefLabelDto) => void;
  /**
   * The register only: a new area whose name the branch already holds is not an error to read but
   * the area to use — it is put in the box (`existingAreaName`) and the dialog closes.
   */
  onExisting?: (storedName: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const lookup = useAtmBankLookup();
  // Seeded from the props — the dialog opens on the label's values — and re-seeded on each open.
  const [form, setForm] = useState<RefLabelForm>(() => refLabelFormOf(label, presetName, activate));
  const set = (patch: Partial<RefLabelForm>): void =>
    setForm((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (open) setForm(refLabelFormOf(label, presetName, activate));
  }, [open, label, presetName, activate]);

  const create = useCreateAtmRefLabel(kind);
  const update = useUpdateAtmRefLabel(kind);
  const pending = create.isPending || update.isPending;
  const creating = label === null;
  const complete = refLabelFormComplete(kind, creating, form);
  // The ACTIVE banks, plus the spelling's own bank when it has been archived since.
  const banks = useMemo(
    () =>
      lookup.ordered.filter(
        (bank) => bank.isActive || (label !== null && bank.code === label.bankCode),
      ),
    [lookup, label],
  );
  const storedAs = form.nameEn.trim();
  const renamed = label !== null && form.name.trim() !== label.name;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!complete) return;
    try {
      const saved =
        label === null
          ? await create.mutateAsync(refLabelCreateBody(kind, form, branchId))
          : await update.mutateAsync({ id: label.id, body: refLabelUpdateBody(kind, label, form) });
      toast.success(t(label === null ? 'atm.dataEdit.labelAdded' : 'atm.dataEdit.labelSaved'));
      onSaved?.(saved);
      onClose();
    } catch (error) {
      const existing =
        onExisting === undefined ? null : existingAreaName(error, kind, creating, form);
      if (existing !== null && onExisting !== undefined) {
        onExisting(existing);
        toast.info(t('atm.register.form.areaExistsPicked'));
        onClose();
        return;
      }
      toast.error(refLabelErrorText(error, t, locale, { areaCreate: kind === 'area' && creating }));
    }
  };

  const title =
    label === null
      ? t(kind === 'bank' ? 'atm.dataEdit.addSpelling' : 'atm.dataEdit.addArea')
      : t(kind === 'bank' ? 'atm.dataEdit.editSpelling' : 'atm.dataEdit.editArea');

  return (
    // A form you fill in, and since the register's «+ منطقة» also one opened OVER the receipt
    // form, whose own dialogs already ignore a stray click: «لو دوست في اى حته الموديل ميتقفلش غير
    // لما ادوس على الاكس» (Dialog.tsx). The × and Escape still close it.
    <Dialog open={open} onClose={onClose} title={title} dismissOnOutsideClick={false}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {(kind === 'bank' || !creating) && (
          <Field
            label={t(kind === 'bank' ? 'atm.dataEdit.labelName' : 'atm.dataEdit.storedName')}
            required
            // An area's rename never moves its machines: said on every edit, and in amber once
            // the stored name has actually been changed.
            hint={kind === 'area' ? t('atm.dataEdit.renameKeepsMachines') : undefined}
            warning={kind === 'area' && renamed ? t('atm.dataEdit.renameKeepsMachines') : undefined}
          >
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} required />
          </Field>
        )}
        {kind === 'bank' && (
          <Field
            label={t('atm.common.bank')}
            required={creating}
            hint={t('atm.dataEdit.spellingBankHint')}
          >
            <Select
              value={form.bankCode}
              onChange={(e) => set({ bankCode: e.target.value })}
              required={creating}
            >
              <option value="" disabled={creating}>
                {t(creating ? 'atm.dataEdit.pickBank' : 'atm.dataEdit.notLinked')}
              </option>
              {banks.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {`${lookup.name(bank.code, locale)} — ${bank.code}`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {kind === 'area' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t('atm.dataEdit.nameAr')}
              required={creating}
              hint={creating ? undefined : t('atm.dataEdit.displayNameHint')}
            >
              <Input
                value={form.nameAr}
                onChange={(e) => set({ nameAr: e.target.value })}
                required={creating}
                maxLength={120}
                dir="rtl"
              />
            </Field>
            <Field
              label={t('atm.dataEdit.nameEn')}
              required={creating}
              hint={creating ? undefined : t('atm.dataEdit.displayNameHint')}
            >
              <Input
                value={form.nameEn}
                onChange={(e) => set({ nameEn: e.target.value })}
                required={creating}
                maxLength={120}
                dir="ltr"
              />
            </Field>
          </div>
        )}
        {/* Said before the click, and kept in view while typing: the English name is the one
            every machine and operation in this area will carry. */}
        {kind === 'area' && creating && (
          <p data-area-stored-as="true" className="text-xs text-slate-500 dark:text-slate-400">
            {t('atm.dataEdit.storedAs', { name: storedAs === '' ? '—' : storedAs })}
          </p>
        )}
        {label !== null && (
          <div className="space-y-1">
            <Checkbox
              checked={form.isActive}
              onChange={(e) => set({ isActive: e.target.checked })}
              label={t('atm.dataEdit.isActive')}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('atm.dataEdit.labelActiveHint')}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button type="submit" loading={pending} disabled={!complete}>
            {t('atm.common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

/**
 * The legacy bulk forms, kept whole: paste a column of codes beside a column of names to register
 * a batch (existing codes are skipped and NAMED), and paste a column of codes to delete a batch
 * (soft delete + the `-D` rename that frees each code for re-registration).
 *
 * `atmMachine.manage` only (D2): both halves decide whether a machine exists, and Operations no
 * longer do that. The page offers the dialog only behind that key, and the server refuses both
 * routes without it. Both halves work in the acting branch, named once above them.
 */
export const BulkMachinesDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The batch files into the acting branch, so its lists are that branch's.
  const options = useAtmRefLabelOptions(null, open);
  const lookup = useAtmBankLookup();
  const [codes, setCodes] = useState('');
  const [names, setNames] = useState('');
  const [bankName, setBankName] = useState('');
  const [area, setArea] = useState('');
  const [deleteCodes, setDeleteCodes] = useState('');

  useEffect(() => {
    if (!open) return;
    setCodes('');
    setNames('');
    setBankName('');
    setArea('');
    setDeleteCodes('');
  }, [open]);

  const bulkCreate = useBulkCreateAtmMachines();
  const bulkDelete = useBulkDeleteAtmMachines();

  const submitAdd = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const machines = buildMachineRows(codes, names);
    if (machines.length === 0 || bankName === '' || area === '' || addBlocked(options.data)) return;
    try {
      const result = bulkAddResultOf(await bulkCreate.mutateAsync({ bankName, area, machines }));
      if (result.created.length > 0 || result.reactivatedCodes.length > 0) {
        setCodes('');
        setNames('');
      }
      for (const shown of bulkAddToasts(result, t)) toast[shown.variant](shown.title);
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  const submitDelete = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const machineCodes = splitAtmFormLines(deleteCodes).filter((code) => code !== '');
    if (machineCodes.length === 0 || addBlocked(options.data)) return;
    try {
      const result = await bulkDelete.mutateAsync({ machineCodes });
      toast.success(t('atm.dataEdit.machinesDeleted', { count: result.deletedCodes.length }));
      if (result.unknownCodes.length > 0) {
        toast.error(t('atm.common.unknownCodes', { codes: result.unknownCodes.join('، ') }));
      }
      setDeleteCodes('');
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('atm.dataEdit.bulkTitle')}>
      <div className="space-y-6">
        {/* Over both halves: the delete finds its codes in the branch the add files into. */}
        <AddBranchLine options={options.data} />
        <form onSubmit={(e) => void submitAdd(e)} className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('atm.dataEdit.addMachines')}
          </h3>
          <UnmappedBranchNotice options={options.data} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('atm.replenishments.machineCodes')} required>
              <Textarea
                value={codes}
                onChange={(e) => setCodes(e.target.value)}
                rows={5}
                required
                dir="ltr"
                className="text-center"
              />
            </Field>
            <Field
              label={t('atm.dataEdit.machineNames')}
              required
              hint={t('atm.dataEdit.lineAlignHint')}
            >
              <Textarea
                value={names}
                onChange={(e) => setNames(e.target.value)}
                rows={5}
                required
                className="text-center"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('atm.common.bank')} required>
              <Select value={bankName} onChange={(e) => setBankName(e.target.value)} required>
                <option value="" disabled>
                  {t('atm.dataEdit.pickBank')}
                </option>
                <BankOptions options={options.data} lookup={lookup} locale={locale} />
              </Select>
            </Field>
            <Field label={t('atm.common.area')} required>
              <Select value={area} onChange={(e) => setArea(e.target.value)} required>
                <option value="" disabled>
                  {t('atm.dataEdit.pickArea')}
                </option>
                <AreaOptions options={options.data} locale={locale} />
              </Select>
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              loading={bulkCreate.isPending}
              disabled={addBlocked(options.data)}
            >
              {t('atm.common.add')}
            </Button>
          </div>
        </form>

        <form
          onSubmit={(e) => void submitDelete(e)}
          className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
        >
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('atm.dataEdit.deleteMachines')}
          </h3>
          <Field
            label={t('atm.replenishments.machineCodes')}
            required
            hint={t('atm.dataEdit.deleteHint')}
          >
            <Textarea
              value={deleteCodes}
              onChange={(e) => setDeleteCodes(e.target.value)}
              rows={4}
              required
              dir="ltr"
              className="text-center"
            />
          </Field>
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="danger"
              loading={bulkDelete.isPending}
              disabled={addBlocked(options.data)}
            >
              {t('atm.common.delete')}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
};
