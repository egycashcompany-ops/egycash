// The register entry form — the sheet's 49 columns as one form, in the grid's own group order
// (Identity · Keys · Cassettes · Hours & notes · Combination · Location · Receipt & handover ·
// HUB), shared by Receive and Edit so the two cannot ask for a field differently.
//
// What a field may do is the server's rule (§5.6), and the form only mirrors it so nobody types
// into a box the server will refuse:
//   · Branch is chosen once, on receipt; a move is a handover here and a receipt there (D4).
//   · The ATM ID is fixed once the machine is linked to the Operations list — editable while the
//     entry is pending, or open and still unlinked (an imported row that may yet need its code).
//   · End date, delivered name and notes delivered belong to the handover; Edit shows them on a
//     handed-back entry, and read-only on an open imported one that already carries them.
//   · Keys, the two K notes and the combination are drawn only for a reader allowed them — on a
//     receipt by the key, on an edit by the entry's own `secretsVisible` (DEC-7: whoever cannot
//     see a value must not overwrite it blind). The combination box starts EMPTY on edit: empty
//     keeps the recorded value, and the form has no way to show it.
//
// Free-text columns (area, operation type, ATM type, model, HUB) are typed with suggestions from
// the branch — the sheet's own values plus the Operations labels — never forced onto a list: the
// workbook has no catalogue for them, and refusing a new model would refuse the machine.
//
// Banks and areas are the catalog's (DEC-35, DEC-38), and the form can add to both without leaving
// the receipt — the owner's complaint was that the register's banks and areas were «مش مسمعه» on
// /atm/data-edit:
//   · the bank is one of the catalog's ACTIVE banks (a bank added at runtime is a full register
//     bank, the owner's call), plus the bank the entry already carries; «+» adds one
//     (`atmBank.create`, organization scope on the server);
//   · the Operations name is a spelling of THAT bank only — the server refuses another bank's;
//   · an area is suggested in the reader's language while the stored name is what is saved, and
//     «+ منطقة» adds one in Arabic and English for the entry's branch — Efficiency do it with the
//     register keys they hold (DEC-39). A typed area nobody has listed yet is still accepted: it is
//     listed for the branch when the entry is saved, and the box says so before the click.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  ATM_REGISTER_COLUMNS,
  ErrorCodes,
  atmRegisterIdFormatOk,
  normalizeAtmMachineCode,
  type AtmBankCode,
  type AtmRegisterBranchOptionsDto,
  type AtmRegisterCassettesInput,
  type AtmRegisterEntryDto,
  type AtmRegisterField,
  type AtmRegisterGroup,
  type AtmRegisterKeysInput,
  type AtmRegisterMetaDto,
  type AtmRegisterWriteResultDto,
  type Locale,
  type ReceiveAtmRegisterEntry,
  type UpdateAtmRegisterEntry,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { ApiError } from '../../../../shared/lib/api-client';
import { errorMessage } from '../../../../shared/lib/errors';
import { cn } from '../../../../shared/lib/cn';
import { Button } from '../../../../shared/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { PlusIcon } from '../../../../shared/ui/icons';
import { PasswordInput } from '../../../../shared/ui/PasswordInput';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { RefLabelDialog } from '../DataEditDialogs';
import { BankDialog } from '../catalog/BankDialog';
import { inCatalogOrder, labelText, makeBankLookup, type BankLookup } from '../../lib/bank-catalog';
import { REGISTER_LTR_FIELDS, registerFieldText } from '../../lib/register-grid';
import { columnHeaderKey } from '../../lib/register-labels';
import { registerBranchOptionLabel } from './RegisterFilters';

// ── Form values ─────────────────────────────────────────────────────────────────────────────────

/**
 * Every box of the form, as typed: the column fields (minus the branch code), branch, ops label,
 * and the «بيانات ناقصة» tick of an edit (`'1'` ticked, `''` not — every value here is text).
 */
export type EntryFormKey =
  Exclude<AtmRegisterField, 'branchCode'> | 'branchId' | 'opsBankLabel' | 'dataIncomplete';
export type EntryFormValues = Record<EntryFormKey, string>;

const fieldsOf = (group: AtmRegisterGroup): AtmRegisterField[] =>
  ATM_REGISTER_COLUMNS.filter((c) => c.group === group).map((c) => c.field);

const KEY_FIELDS = fieldsOf('keys');
const CASSETTE_FIELDS = fieldsOf('cassettes');
/**
 * The cassette columns as the sheet groups them — withdrawal R..X, deposit and recycle Y..AD,
 * spare AE..AJ — each set on a grid of five, so the five numbered cassettes of a set stand on one
 * line and the withdrawal and spare cassettes line up under each other.
 */
const CASSETTE_SETS: readonly (readonly { field: AtmRegisterField; span?: string }[])[] = [
  [
    { field: 'cassettes.withdrawalType', span: 'sm:col-span-3' },
    { field: 'cassettes.withdrawalCount', span: 'sm:col-span-2' },
    { field: 'cassettes.withdrawal1' },
    { field: 'cassettes.withdrawal2' },
    { field: 'cassettes.withdrawal3' },
    { field: 'cassettes.withdrawal4' },
    { field: 'cassettes.withdrawal5' },
  ],
  [
    { field: 'cassettes.depositType', span: 'sm:col-span-3' },
    { field: 'cassettes.depositCount', span: 'sm:col-span-2' },
    { field: 'cassettes.collectionCount' },
    { field: 'cassettes.recycle200' },
    { field: 'cassettes.recycle100' },
    { field: 'cassettes.recycle50' },
  ],
  [
    { field: 'cassettes.spareCount', span: 'sm:col-span-3' },
    { field: 'cassettes.spare1', span: 'sm:col-start-1' },
    { field: 'cassettes.spare2' },
    { field: 'cassettes.spare3' },
    { field: 'cassettes.spare4' },
    { field: 'cassettes.spare5' },
  ],
];

/** Plain text boxes every write may change (keys, cassettes and lifecycle are handled apart). */
const TEXT_FIELDS = [
  'area',
  'operationType',
  'vendor',
  'model',
  'serial',
  'openTime',
  'closeTime',
  'accessHoursNotes',
  'locationPlusCode',
  'locationUrl',
  'hub',
  'receivedByName',
] as const satisfies readonly EntryFormKey[];

/** The contract's own caps (§3.7), so a box cannot hold what the server would refuse. */
const MAX_LENGTH: Partial<Record<EntryFormKey, number>> = {
  machineCode: 64,
  opsBankLabel: 64,
  name: 300,
  accessHoursNotes: 2000,
  receiptNotes: 4000,
  handoverNotes: 4000,
  safeCombination: 200,
  locationPlusCode: 500,
  locationUrl: 2048,
  hub: 200,
  receivedByName: 300,
  handoverName: 300,
  'keys.supervisorCode': 500,
  'keys.combinationKeyCode': 500,
  'keys.cashUnitCode': 500,
  'keys.supervisorCount': 200,
  'keys.safeDoorCount': 200,
  'keys.alanki': 200,
  'keys.combinationKeyCount': 200,
  'keys.cashUnitCount': 200,
};
const maxLengthOf = (key: EntryFormKey): number => MAX_LENGTH[key] ?? 120;

/** The form as an entry fills it — or blank for a receipt. The combination is never pre-filled. */
export const entryFormValues = (
  entry: AtmRegisterEntryDto | null,
  branchId = '',
): EntryFormValues => {
  const values = {
    branchId: entry?.branchId ?? branchId,
    opsBankLabel: entry?.opsBankLabel ?? '',
    dataIncomplete: entry?.dataIncomplete === true ? '1' : '',
  } as EntryFormValues;
  for (const column of ATM_REGISTER_COLUMNS) {
    if (column.field === 'branchCode') continue;
    values[column.field] = entry === null ? '' : (registerFieldText(entry, column.field) ?? '');
  }
  return values;
};

const clean = (value: string): string | null => (value.trim() === '' ? null : value.trim());
const sub = (field: AtmRegisterField): string => field.slice(field.indexOf('.') + 1);

/** The POST body of a receipt (or of a pending entry, when no start date is given). */
export const receiveBody = (values: EntryFormValues, secrets: boolean): ReceiveAtmRegisterEntry => {
  const body: ReceiveAtmRegisterEntry = { branchId: values.branchId, name: values.name.trim() };
  const loose = body as Record<string, unknown>;
  for (const key of TEXT_FIELDS) {
    const value = clean(values[key]);
    if (value !== null) loose[key] = value;
  }
  const code = clean(values.machineCode);
  if (code !== null) body.machineCode = code;
  if (values.bankCode !== '') body.bankCode = values.bankCode;
  const label = clean(values.opsBankLabel);
  if (label !== null) body.opsBankLabel = label;
  if (values.startDate !== '') body.startDate = values.startDate;
  const cassettes: Record<string, string> = {};
  for (const field of CASSETTE_FIELDS) {
    const value = clean(values[field as EntryFormKey]);
    if (value !== null) cassettes[sub(field)] = value;
  }
  if (Object.keys(cassettes).length > 0) body.cassettes = cassettes as AtmRegisterCassettesInput;
  // K and S only from a reader allowed them — the server refuses them otherwise (DEC-7).
  if (secrets) {
    const keys: Record<string, string> = {};
    for (const field of KEY_FIELDS) {
      const value = clean(values[field as EntryFormKey]);
      if (value !== null) keys[sub(field)] = value;
    }
    if (Object.keys(keys).length > 0) body.keys = keys as AtmRegisterKeysInput;
    const notes = clean(values.receiptNotes);
    if (notes !== null) body.receiptNotes = notes;
    const combination = clean(values.safeCombination);
    if (combination !== null) body.safeCombination = combination;
  }
  return body;
};

/** What Edit may change on this entry, by its status (§5.6). */
export interface EntryEditRules {
  /** Pending, or open and not linked to the Operations list yet (DEC-30). */
  codeEditable: boolean;
  /** Open or ended; a pending entry gets its start date from "Record receipt". */
  startDateEditable: boolean;
  /** Handed back: end date, delivered name, notes delivered. */
  handoverEditable: boolean;
  /** An open entry that already carries handover values (imported) shows them, read-only. */
  handoverShownReadOnly: boolean;
  /** Open and linked: the area may change but not be emptied (D6). */
  areaRequired: boolean;
  /** Open and unlinked: entering the area couples the entry (DEC-30). */
  areaLinks: boolean;
}

export const entryEditRules = (entry: AtmRegisterEntryDto): EntryEditRules => {
  const open = entry.status === 'open';
  const linked = entry.machineId !== null;
  return {
    codeEditable: entry.status === 'pending' || (open && !linked),
    startDateEditable: entry.status !== 'pending',
    handoverEditable: entry.status === 'ended',
    handoverShownReadOnly:
      open &&
      (entry.handoverName !== null || (entry.secretsVisible && entry.handoverNotes !== null)),
    areaRequired: open && linked,
    areaLinks: open && !linked,
  };
};

/**
 * The PATCH body of an edit: ONLY what the reader changed. An untouched box is not sent, so an
 * edit never rewrites a value the reader did not look at — and never sends a K field for an entry
 * whose secrets the reader cannot see.
 */
export const updateBody = (
  entry: AtmRegisterEntryDto,
  initial: EntryFormValues,
  values: EntryFormValues,
  combinationClear: boolean,
): UpdateAtmRegisterEntry => {
  const rules = entryEditRules(entry);
  const body: UpdateAtmRegisterEntry = { version: entry.version };
  const loose = body as Record<string, unknown>;
  const changed = (key: EntryFormKey): boolean => values[key].trim() !== initial[key].trim();

  for (const key of TEXT_FIELDS) if (changed(key)) loose[key] = clean(values[key]);
  if (changed('opsBankLabel')) body.opsBankLabel = clean(values.opsBankLabel);
  const name = clean(values.name);
  if (changed('name') && name !== null) body.name = name;
  const code = clean(values.machineCode);
  if (rules.codeEditable && changed('machineCode') && code !== null) body.machineCode = code;
  if (changed('bankCode')) body.bankCode = values.bankCode === '' ? null : values.bankCode;
  // DEC-37: Efficiency untick it once they have completed the receipt (or tick it to come back).
  if (changed('dataIncomplete')) body.dataIncomplete = values.dataIncomplete === '1';
  if (rules.startDateEditable && changed('startDate') && values.startDate !== '') {
    body.startDate = values.startDate;
  }
  if (rules.handoverEditable) {
    if (changed('endDate') && values.endDate !== '') body.endDate = values.endDate;
    if (changed('handoverName')) body.handoverName = clean(values.handoverName);
  }
  const cassettes: Record<string, string | null> = {};
  for (const field of CASSETTE_FIELDS) {
    if (changed(field as EntryFormKey))
      cassettes[sub(field)] = clean(values[field as EntryFormKey]);
  }
  if (Object.keys(cassettes).length > 0) body.cassettes = cassettes as AtmRegisterCassettesInput;

  if (entry.secretsVisible) {
    const keys: Record<string, string | null> = {};
    for (const field of KEY_FIELDS) {
      if (changed(field as EntryFormKey)) keys[sub(field)] = clean(values[field as EntryFormKey]);
    }
    if (Object.keys(keys).length > 0) body.keys = keys as AtmRegisterKeysInput;
    if (changed('receiptNotes')) body.receiptNotes = clean(values.receiptNotes);
    if (rules.handoverEditable && changed('handoverNotes')) {
      body.handoverNotes = clean(values.handoverNotes);
    }
    // Empty keeps the recorded combination; "clear" removes it; anything typed replaces it.
    const combination = clean(values.safeCombination);
    if (combinationClear) body.safeCombination = null;
    else if (combination !== null) body.safeCombination = combination;
  }
  return body;
};

// ── Results and errors ──────────────────────────────────────────────────────────────────────────

const REGISTER_ERROR_CODES = new Set<string>(
  Object.values(ErrorCodes).filter((code) => code.startsWith('ATM_REGISTER_')),
);

/**
 * The bank refusals a write can come back with, by the field they name (400, `ValidationError`):
 *   · `bankCode` — not a catalog bank (`UNKNOWN`), or archived and not the entry's own (`INACTIVE`):
 *     archiving stops NEW receipts on a bank, it does not make its entries unsavable (DEC-35);
 *   · `opsBankLabel` — not one of the branch's active spellings (`UNKNOWN`), one no bank has been
 *     linked to yet (`UNMAPPED`), or another bank's (`OTHER_BANK`): DEC-25's «a label chosen for one
 *     bank means nothing for another», which the server now enforces.
 * Each gets its own sentence: «بعض الحقول تحتاج إلى مراجعة» on a form of fifty boxes says nothing.
 */
export const REGISTER_BANK_REFUSALS = {
  bankCode: ['UNKNOWN', 'INACTIVE'],
  opsBankLabel: ['UNKNOWN', 'UNMAPPED', 'OTHER_BANK'],
} as const satisfies Record<string, readonly string[]>;

/** `atm.register.refusal.<field>.<code>` of the first bank refusal the error names, if any. */
export const bankRefusalKey = (error: ApiError): string | null => {
  for (const detail of error.details ?? []) {
    const field = (detail.field ?? '').replace(/^body\./, '');
    const codes: readonly string[] | undefined =
      REGISTER_BANK_REFUSALS[field as keyof typeof REGISTER_BANK_REFUSALS];
    if (codes?.includes(detail.code) === true)
      return `atm.register.refusal.${field}.${detail.code}`;
  }
  return null;
};

/**
 * A refused write in the reader's words: the register's own codes by name, a refused bank or
 * Operations name by what was wrong with it, the rest generically.
 */
export const registerErrorText = (
  error: unknown,
  t: (key: string) => string,
  locale: Locale,
): string => {
  if (!(error instanceof ApiError)) return errorMessage(error, locale);
  if (REGISTER_ERROR_CODES.has(error.code)) return t(`atm.register.error.${error.code}`);
  const refusal = bankRefusalKey(error);
  return refusal === null ? errorMessage(error, locale) : t(refusal);
};

/** What a write did: the toast, what happened in the Operations list, and every warning. */
export const announceWrite = (
  result: AtmRegisterWriteResultDto,
  titleKey: string,
  t: (key: string) => string,
): void => {
  const master =
    result.master.action === 'none'
      ? undefined
      : t(`atm.register.masterAction.${result.master.action}`);
  toast.success(t(titleKey), master);
  for (const warning of result.warnings) toast.warning(t(`atm.register.warning.${warning}`));
};

/**
 * The refusal, inside the dialog that caused it — it stays while the reader fixes the form. It is
 * the ONLY report of a refused write (the register hooks opt out of the global toast), and it sits
 * at the top of a form the reader has usually scrolled to its footer to press the button, so it
 * brings itself into view when it appears (review finding LIVE-1).
 */
export const FormError = ({ message }: { message: string | null }): JSX.Element | null => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message !== null) box.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [message]);
  return message === null ? null : (
    <div
      ref={box}
      role="alert"
      data-register-form-error="true"
      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200"
    >
      {message}
    </div>
  );
};

// ── The sections ────────────────────────────────────────────────────────────────────────────────

const unique = (...lists: (readonly string[] | undefined)[]): string[] =>
  [...new Set(lists.flatMap((list) => list ?? []))].sort((a, b) => a.localeCompare(b));

/** One suggestion of a free-text box: what it puts in the box, and what the list shows for it. */
export interface Suggestion {
  value: string;
  /** Shown beside the value when it says something else — an area's name in the reader's language. */
  label?: string;
}

/**
 * The bank select's banks: the catalog's ACTIVE ones in its order, plus every code the form holds —
 * the entry's stored bank (archived since or not: an unchanged archived bank still saves) and a bank
 * just added with «+», before the register meta has come back with it.
 */
export const registerBankChoices = (
  lookup: BankLookup,
  held: readonly string[],
): { code: AtmBankCode; archived: boolean }[] => {
  const codes = new Set<AtmBankCode>(lookup.active.map((bank) => bank.code));
  for (const code of held) if (code !== '') codes.add(code);
  const archived = new Set(
    lookup.ordered.filter((bank) => !bank.isActive).map((bank) => bank.code),
  );
  return inCatalogOrder(lookup, codes).map((code) => ({ code, archived: archived.has(code) }));
};

/** «NBE · البنك الأهلي المصري», and «(مؤرشف)» after a bank the catalog has archived. */
export const registerBankOptionLabel = (
  choice: { code: AtmBankCode; archived: boolean },
  lookup: BankLookup,
  locale: Locale,
  t: (key: string, params?: Record<string, string | number>) => string,
): string => {
  const text = `${choice.code} · ${lookup.name(choice.code, locale)}`;
  return choice.archived ? t('atm.bankCatalog.archivedOption', { name: text }) : text;
};

/**
 * The Operations-name select's names once a bank is chosen: the branch's spellings OF THAT BANK
 * (`bankVariants` — the server refuses another bank's), plus the name the form already holds.
 */
export const opsLabelChoices = (
  options: AtmRegisterBranchOptionsDto | undefined,
  bank: string,
  held: string,
): string[] =>
  unique(
    (options?.bankVariants ?? []).filter((v) => v.bankCode === bank).map((v) => v.name),
    held === '' ? [] : [held],
  );

/**
 * The area box's suggestions. Each area label is offered by its STORED name — what entries and
 * machines carry, and so what the box must hold (EG-6: two spellings are two areas) — with its name
 * in the reader's language beside it; then the areas entries already carry that no label holds.
 * Ordered as the reader reads them.
 */
export const areaSuggestions = (
  options: AtmRegisterBranchOptionsDto | undefined,
  locale: Locale,
): Suggestion[] => {
  const byName = new Map<string, Suggestion>();
  for (const area of options?.areaOptions ?? []) {
    const text = labelText(area, locale);
    byName.set(
      area.name,
      text === area.name ? { value: area.name } : { value: area.name, label: text },
    );
  }
  for (const name of [...(options?.areaLabels ?? []), ...(options?.areas ?? [])]) {
    if (!byName.has(name)) byName.set(name, { value: name });
  }
  return [...byName.values()].sort((a, b) =>
    (a.label ?? a.value).localeCompare(b.label ?? b.value),
  );
};

/**
 * Is the typed area one this branch lists nowhere yet? Decided only once the branch's lists have
 * answered, and never for the value the entry already stores. Such an area is still saved — it is
 * listed for the branch on save (DEC-38) — the box only says so first.
 */
export const isNewArea = (
  options: AtmRegisterBranchOptionsDto | undefined,
  typed: string,
  stored: string | null,
): boolean => {
  const area = typed.trim();
  if (options === undefined || area === '' || area === (stored ?? '').trim()) return false;
  const known = new Set([
    ...(options.areaOptions ?? []).map((a) => a.name),
    ...options.areaLabels,
    ...options.areas,
  ]);
  return !known.has(area);
};

/** The branches a receipt may name: mapped, active, and inside the reader's create reach (D4). */
export const creatableBranches = (
  meta: AtmRegisterMetaDto | undefined,
): AtmRegisterMetaDto['branches'] =>
  (meta?.branches ?? []).filter((b) => b.canCreate && b.branchActive && b.branchId !== null);

export const EntryFormSections = ({
  mode,
  entry,
  values,
  onChange,
  combinationClear,
  onCombinationClear,
  meta,
  options,
  secrets,
  isMissing,
  onOverlayChange,
}: {
  mode: 'receive' | 'edit';
  /** The entry being edited; `null` on a receipt. */
  entry: AtmRegisterEntryDto | null;
  values: EntryFormValues;
  onChange: (patch: Partial<EntryFormValues>) => void;
  combinationClear: boolean;
  onCombinationClear: (clear: boolean) => void;
  meta: AtmRegisterMetaDto | undefined;
  /** The branch's labels and the register's own values there — suggestions, never a limit. */
  options: AtmRegisterBranchOptionsDto | undefined;
  /** Draw the K and S boxes. */
  secrets: boolean;
  isMissing: (key: string) => boolean;
  /**
   * A bank or area dialog opened over the form, or closed. The form's own dialog holds still while
   * one is open — its Escape is the nested dialog's — so a slip there never throws away the form.
   */
  onOverlayChange?: (open: boolean) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const base = useId();
  const rules = entry === null ? null : entryEditRules(entry);
  const receiving = mode === 'receive';
  const startSet = values.startDate !== '';
  // The register meta's banks are the catalog's (archived ones included), already loaded with the
  // page — so naming a bank costs no request of its own.
  const lookup = makeBankLookup(meta?.banks);
  const [adding, setAdding] = useState<'bank' | 'area' | null>(null);
  const openAdd = (which: 'bank' | 'area' | null): void => {
    setAdding(which);
    onOverlayChange?.(which !== null);
  };

  const idOf = (key: string): string => `${base}-${key.replace('.', '-')}`;
  const labelOf = (key: EntryFormKey): string =>
    key === 'branchId'
      ? t(columnHeaderKey('branchCode'))
      : key === 'opsBankLabel'
        ? t('atm.register.form.opsBankLabel')
        : key === 'dataIncomplete'
          ? t('atm.register.incomplete')
          : t(columnHeaderKey(key));

  /**
   * How many lines the STORED value runs to. The sheet holds 1,531 cells on several lines (keys,
   * cassettes, names, notes …); a single-line `<input>` strips the breaks the moment it is touched,
   * and the edit then saves the lines run together — '2\n3' becomes '23' (review finding DATA-1).
   * Such a value gets a text area. Decided from the entry, never from what is being typed, so a
   * box never changes kind under the reader's cursor.
   */
  const storedLines = (key: EntryFormKey): number => {
    if (entry === null || key === 'branchId' || key === 'opsBankLabel' || key === 'dataIncomplete')
      return 1;
    return (registerFieldText(entry, key) ?? '').split('\n').length;
  };

  const textBox = (
    key: EntryFormKey,
    {
      suggestions: given,
      multiline = false,
      required = false,
      disabled = false,
      hint,
      warning,
      className,
      addon,
    }: {
      suggestions?: readonly (string | Suggestion)[];
      multiline?: boolean;
      required?: boolean;
      disabled?: boolean;
      hint?: string | undefined;
      warning?: string | undefined;
      className?: string;
      /** A control beside the box — the area's «+ منطقة». */
      addon?: ReactNode;
    } = {},
  ): JSX.Element => {
    const id = idOf(key);
    const ltr = REGISTER_LTR_FIELDS.has(key as AtmRegisterField);
    const suggestions = given?.map((s): Suggestion => (typeof s === 'string' ? { value: s } : s));
    const common = {
      id,
      value: values[key],
      maxLength: maxLengthOf(key),
      disabled,
      autoComplete: 'off',
      ...(ltr ? { dir: 'ltr' } : {}),
    };
    const box =
      multiline || storedLines(key) > 1 ? (
        <Textarea
          {...common}
          rows={Math.min(6, Math.max(2, storedLines(key)))}
          onChange={(e) => onChange({ [key]: e.target.value })}
        />
      ) : (
        <Input
          {...common}
          {...(suggestions === undefined || suggestions.length === 0 ? {} : { list: `${id}-list` })}
          onChange={(e) => onChange({ [key]: e.target.value })}
        />
      );
    return (
      <Field
        key={key}
        label={labelOf(key)}
        htmlFor={id}
        required={required}
        missing={isMissing(key)}
        hint={hint}
        warning={warning}
        {...(className === undefined ? {} : { className })}
      >
        {addon === undefined ? (
          box
        ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{box}</div>
            {addon}
          </div>
        )}
        {suggestions !== undefined && suggestions.length > 0 && (
          <datalist id={`${id}-list`}>
            {/* The value is what the box will hold; the label, when there is one, what it means. */}
            {suggestions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                {...(option.label === undefined ? {} : { label: option.label })}
              />
            ))}
          </datalist>
        )}
      </Field>
    );
  };

  const dateBox = (
    key: 'startDate' | 'endDate',
    { required = false, hint }: { required?: boolean; hint?: string } = {},
  ): JSX.Element => (
    <Field
      key={key}
      label={labelOf(key)}
      htmlFor={idOf(key)}
      required={required}
      missing={isMissing(key)}
      hint={hint}
    >
      <Input
        id={idOf(key)}
        type="date"
        dir="ltr"
        value={values[key]}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </Field>
  );

  const section = (
    group: AtmRegisterGroup,
    children: ReactNode,
    grid = 'sm:grid-cols-2 lg:grid-cols-4',
  ): JSX.Element => (
    <fieldset
      key={group}
      data-register-section={group}
      className="min-w-0 rounded-lg border border-slate-200 px-4 pb-4 pt-2 dark:border-slate-800"
    >
      <legend className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
        {t(`atm.register.group.${group}`)}
      </legend>
      <div className={cn('grid gap-3', grid)}>{children}</div>
    </fieldset>
  );

  // ── Identity ──
  const bank = values.bankCode === '' ? null : values.bankCode;
  const autoLabel =
    bank === null ? '—' : (meta?.banks.find((b) => b.code === bank)?.opsLabel ?? bank);
  const bankChoices = registerBankChoices(lookup, [entry?.bankCode ?? '', values.bankCode]);
  // The name the entry holds stays on offer even with no bank chosen, so an edit never blanks it.
  const bankLabels = opsLabelChoices(options, bank ?? '', values.opsBankLabel);
  const code = normalizeAtmMachineCode(values.machineCode);
  // The ID formats are the six seeds' (kept in code, DEC-35); a bank without one never warns.
  const idFormatWarning =
    bank !== null && code !== '' && !atmRegisterIdFormatOk(bank, code)
      ? t('atm.register.warning.idFormat')
      : undefined;
  const codeLocked = rules !== null && !rules.codeEditable;
  const branchName =
    entry === null || entry.branchCode === null
      ? '—'
      : (() => {
          const known = meta?.branches.find((b) => b.code === entry.branchCode);
          return known === undefined ? entry.branchCode : registerBranchOptionLabel(known, locale);
        })();
  const areaHint = [
    receiving && startSet
      ? t('atm.register.form.areaRequired')
      : rules?.areaLinks === true
        ? t('atm.register.form.linkOnAreaHint')
        : undefined,
    isNewArea(options, values.area, entry?.area ?? null)
      ? t('atm.register.form.newAreaHint')
      : undefined,
  ].filter((hint): hint is string => hint !== undefined);
  // An area is filed per branch: without one there is nowhere to add it.
  const canAddArea = values.branchId !== '';

  const identity = section('identity', [
    receiving ? (
      <Field
        key="branchId"
        label={labelOf('branchId')}
        htmlFor={idOf('branchId')}
        required
        missing={isMissing('branchId')}
      >
        <Select
          id={idOf('branchId')}
          value={values.branchId}
          // The ops label is picked from THIS branch's bank labels; another branch's does not apply.
          onChange={(e) => onChange({ branchId: e.target.value, opsBankLabel: '' })}
        >
          <option value="">{t('common.select')}</option>
          {creatableBranches(meta).map((branch) => (
            <option key={branch.code} value={branch.branchId ?? ''}>
              {registerBranchOptionLabel(branch, locale)}
            </option>
          ))}
        </Select>
      </Field>
    ) : (
      <Field key="branchId" label={labelOf('branchId')} htmlFor={idOf('branchId')}>
        <Input id={idOf('branchId')} value={branchName} disabled readOnly />
      </Field>
    ),
    textBox('area', {
      suggestions: areaSuggestions(options, locale),
      required: (receiving && startSet) || (rules?.areaRequired ?? false),
      hint: areaHint.length === 0 ? undefined : areaHint.join(' '),
      addon: (
        <Can
          anyOf={[
            'atmRefLabel.create',
            'atmMachine.manage',
            'atmRegister.create',
            'atmRegister.edit',
          ]}
        >
          <Button
            size="icon"
            variant="secondary"
            aria-label={t('atm.dataEdit.addArea')}
            title={t('atm.dataEdit.addArea')}
            data-register-add="area"
            disabled={!canAddArea}
            onClick={() => openAdd('area')}
          >
            <PlusIcon className="h-4 w-4" />
          </Button>
        </Can>
      ),
    }),
    <Field
      key="bankCode"
      label={labelOf('bankCode')}
      htmlFor={idOf('bankCode')}
      required={receiving && startSet}
      missing={isMissing('bankCode')}
    >
      <div className="flex items-center gap-2">
        <Select
          id={idOf('bankCode')}
          value={values.bankCode}
          className="min-w-0 flex-1"
          // An override chosen for one bank means nothing for another (DEC-25).
          onChange={(e) => onChange({ bankCode: e.target.value, opsBankLabel: '' })}
        >
          <option value="">{t('common.select')}</option>
          {bankChoices.map((choice) => (
            <option key={choice.code} value={choice.code}>
              {registerBankOptionLabel(choice, lookup, locale, t)}
            </option>
          ))}
        </Select>
        <Can permission="atmBank.create">
          <Button
            size="icon"
            variant="secondary"
            aria-label={t('atm.bankCatalog.add')}
            title={t('atm.bankCatalog.add')}
            data-register-add="bank"
            onClick={() => openAdd('bank')}
          >
            <PlusIcon className="h-4 w-4" />
          </Button>
        </Can>
      </div>
    </Field>,
    <Field key="opsBankLabel" label={labelOf('opsBankLabel')} htmlFor={idOf('opsBankLabel')}>
      <Select
        id={idOf('opsBankLabel')}
        value={values.opsBankLabel}
        onChange={(e) => onChange({ opsBankLabel: e.target.value })}
      >
        <option value="">{t('atm.register.form.opsBankLabelAuto', { label: autoLabel })}</option>
        {bankLabels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </Select>
    </Field>,
    textBox('machineCode', {
      required: receiving && startSet,
      disabled: codeLocked,
      ...(codeLocked ? { hint: t('atm.register.form.codeLocked') } : {}),
      ...(idFormatWarning === undefined || codeLocked ? {} : { warning: idFormatWarning }),
    }),
    textBox('name', { required: true, className: 'sm:col-span-2 lg:col-span-3' }),
    textBox('operationType', { suggestions: options?.operationTypes ?? [] }),
    textBox('vendor', { suggestions: options?.vendors ?? [] }),
    textBox('model', { suggestions: options?.models ?? [] }),
    textBox('serial'),
  ]);

  // ── «بيانات ناقصة» (DEC-37), on an edit ──
  // Efficiency's own mark: Operations' data-edit add sets it, and only a person clears it — a
  // filled field is not proof the row was reviewed. Said above the form, where an edit opens.
  const incomplete = receiving ? null : (
    <div
      data-register-incomplete-field="true"
      className="space-y-1 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-800"
    >
      <Checkbox
        label={labelOf('dataIncomplete')}
        checked={values.dataIncomplete === '1'}
        onChange={(e) => onChange({ dataIncomplete: e.target.checked ? '1' : '' })}
      />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('atm.register.form.dataIncompleteHint')}
      </p>
      {entry?.source === 'operations' && (
        <p data-register-operations-note="true" className="text-xs text-sky-700 dark:text-sky-300">
          {t('atm.register.form.operationsNote')}
        </p>
      )}
    </div>
  );

  // ── Keys (K) ──
  const keys = secrets
    ? section(
        'keys',
        KEY_FIELDS.map((field) => textBox(field as EntryFormKey)),
      )
    : null;

  // ── Cassettes ──
  const cassettes = section(
    'cassettes',
    CASSETTE_SETS.map((set) => (
      <div
        key={set[0]?.field}
        data-cassette-set={set[0]?.field}
        className="col-span-full grid grid-cols-2 gap-3 sm:grid-cols-5"
      >
        {set.map(({ field, span }) =>
          textBox(field as EntryFormKey, span === undefined ? {} : { className: span }),
        )}
      </div>
    )),
    '',
  );

  // ── Hours and notes ──
  const hours = section('hours', [
    textBox('openTime'),
    textBox('closeTime'),
    textBox('accessHoursNotes', { className: 'sm:col-span-2' }),
    ...(secrets ? [textBox('receiptNotes', { multiline: true, className: 'col-span-full' })] : []),
  ]);

  // ── The combination (S) ──
  const combination = secrets
    ? section(
        'secret',
        <Field
          key="safeCombination"
          label={labelOf('safeCombination')}
          htmlFor={idOf('safeCombination')}
          className="sm:col-span-2"
          {...(entry === null ? {} : { hint: t('atm.register.form.combinationKeep') })}
        >
          <PasswordInput
            id={idOf('safeCombination')}
            value={values.safeCombination}
            maxLength={maxLengthOf('safeCombination')}
            autoComplete="new-password"
            disabled={combinationClear}
            onChange={(e) => onChange({ safeCombination: e.target.value })}
          />
          {entry !== null && entry.safeCombinationSet && (
            <Checkbox
              label={t('atm.register.form.combinationClear')}
              checked={combinationClear}
              onChange={(e) => onCombinationClear(e.target.checked)}
            />
          )}
        </Field>,
      )
    : null;

  // ── Location ──
  const location = section('location', [
    textBox('locationPlusCode', { className: 'sm:col-span-2' }),
    textBox('locationUrl', { className: 'sm:col-span-2' }),
  ]);

  // ── Receipt and handover ──
  const lifecycle: ReactNode[] = [];
  if (receiving) {
    lifecycle.push(dateBox('startDate', { hint: t('atm.register.form.startDateHint') }));
  } else if (rules?.startDateEditable === true) {
    lifecycle.push(dateBox('startDate', { required: true }));
  }
  lifecycle.push(textBox('receivedByName'));
  if (rules?.handoverEditable === true) {
    lifecycle.push(dateBox('endDate', { required: true }));
    lifecycle.push(textBox('handoverName'));
    if (secrets)
      lifecycle.push(textBox('handoverNotes', { multiline: true, className: 'col-span-full' }));
  } else if (rules?.handoverShownReadOnly === true) {
    if (values.handoverName !== '') lifecycle.push(textBox('handoverName', { disabled: true }));
    if (secrets && values.handoverNotes !== '') {
      lifecycle.push(
        textBox('handoverNotes', { multiline: true, disabled: true, className: 'col-span-full' }),
      );
    }
  }

  return (
    <div className="space-y-4">
      {incomplete}
      {identity}
      {keys}
      {cassettes}
      {hours}
      {combination}
      {location}
      {section('lifecycle', lifecycle)}
      {section('hub', [textBox('hub', { suggestions: options?.hubs ?? [] })])}
      {/* Opened over the form, and mounted only then (each reads the catalog); each puts what it
          added into the box it was opened from. */}
      {adding === 'bank' && (
        <BankDialog
          open
          onClose={() => openAdd(null)}
          bank={null}
          onSaved={(added) => onChange({ bankCode: added.code, opsBankLabel: '' })}
        />
      )}
      {adding === 'area' && canAddArea && (
        <RefLabelDialog
          open
          onClose={() => openAdd(null)}
          kind="area"
          label={null}
          branchId={values.branchId}
          onSaved={(added) => onChange({ area: added.name })}
        />
      )}
    </div>
  );
};
