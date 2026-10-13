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
import { useId, type ReactNode } from 'react';
import {
  ATM_BANK_CODES,
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
import { useAppSelector } from '../../../../store';
import { ApiError } from '../../../../shared/lib/api-client';
import { errorMessage } from '../../../../shared/lib/errors';
import { cn } from '../../../../shared/lib/cn';
import { Checkbox, Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { PasswordInput } from '../../../../shared/ui/PasswordInput';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { REGISTER_LTR_FIELDS, registerFieldText } from '../../lib/register-grid';
import { bankName, columnHeaderKey } from '../../lib/register-labels';
import { registerBranchOptionLabel } from './RegisterFilters';

// ── Form values ─────────────────────────────────────────────────────────────────────────────────

/** Every box of the form, as typed: the column fields (minus the branch code), branch, ops label. */
export type EntryFormKey = Exclude<AtmRegisterField, 'branchCode'> | 'branchId' | 'opsBankLabel';
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
  if (values.bankCode !== '') body.bankCode = values.bankCode as AtmBankCode;
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
  if (changed('bankCode'))
    body.bankCode = values.bankCode === '' ? null : (values.bankCode as AtmBankCode);
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

/** A refused write in the reader's words: the register's own codes by name, the rest generically. */
export const registerErrorText = (
  error: unknown,
  t: (key: string) => string,
  locale: Locale,
): string =>
  error instanceof ApiError && REGISTER_ERROR_CODES.has(error.code)
    ? t(`atm.register.error.${error.code}`)
    : errorMessage(error, locale);

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

/** The refusal, inside the dialog that caused it — it stays while the reader fixes the form. */
export const FormError = ({ message }: { message: string | null }): JSX.Element | null =>
  message === null ? null : (
    <div
      role="alert"
      data-register-form-error="true"
      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200"
    >
      {message}
    </div>
  );

// ── The sections ────────────────────────────────────────────────────────────────────────────────

const unique = (...lists: (readonly string[] | undefined)[]): string[] =>
  [...new Set(lists.flatMap((list) => list ?? []))].sort((a, b) => a.localeCompare(b));

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
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const base = useId();
  const rules = entry === null ? null : entryEditRules(entry);
  const receiving = mode === 'receive';
  const startSet = values.startDate !== '';

  const idOf = (key: string): string => `${base}-${key.replace('.', '-')}`;
  const labelOf = (key: EntryFormKey): string =>
    key === 'branchId'
      ? t(columnHeaderKey('branchCode'))
      : key === 'opsBankLabel'
        ? t('atm.register.form.opsBankLabel')
        : t(columnHeaderKey(key));

  const textBox = (
    key: EntryFormKey,
    {
      suggestions,
      multiline = false,
      required = false,
      disabled = false,
      hint,
      warning,
      className,
    }: {
      suggestions?: readonly string[];
      multiline?: boolean;
      required?: boolean;
      disabled?: boolean;
      hint?: string;
      warning?: string;
      className?: string;
    } = {},
  ): JSX.Element => {
    const id = idOf(key);
    const ltr = REGISTER_LTR_FIELDS.has(key as AtmRegisterField);
    const common = {
      id,
      value: values[key],
      maxLength: maxLengthOf(key),
      disabled,
      autoComplete: 'off',
      ...(ltr ? { dir: 'ltr' } : {}),
    };
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
        {multiline ? (
          <Textarea {...common} rows={2} onChange={(e) => onChange({ [key]: e.target.value })} />
        ) : (
          <Input
            {...common}
            {...(suggestions === undefined || suggestions.length === 0
              ? {}
              : { list: `${id}-list` })}
            onChange={(e) => onChange({ [key]: e.target.value })}
          />
        )}
        {suggestions !== undefined && suggestions.length > 0 && (
          <datalist id={`${id}-list`}>
            {suggestions.map((option) => (
              <option key={option} value={option} />
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
  const bank = values.bankCode === '' ? null : (values.bankCode as AtmBankCode);
  const autoLabel =
    bank === null ? '—' : (meta?.banks.find((b) => b.code === bank)?.opsLabel ?? bank);
  const bankLabels = unique(
    options?.bankLabels,
    values.opsBankLabel === '' ? [] : [values.opsBankLabel],
  );
  const code = normalizeAtmMachineCode(values.machineCode);
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
      suggestions: unique(options?.areaLabels, options?.areas),
      required: (receiving && startSet) || (rules?.areaRequired ?? false),
      ...(receiving && startSet
        ? { hint: t('atm.register.form.areaRequired') }
        : rules?.areaLinks === true
          ? { hint: t('atm.register.form.linkOnAreaHint') }
          : {}),
    }),
    <Field
      key="bankCode"
      label={labelOf('bankCode')}
      htmlFor={idOf('bankCode')}
      required={receiving && startSet}
      missing={isMissing('bankCode')}
    >
      <Select
        id={idOf('bankCode')}
        value={values.bankCode}
        // An override chosen for one bank means nothing for another (DEC-25).
        onChange={(e) => onChange({ bankCode: e.target.value, opsBankLabel: '' })}
      >
        <option value="">{t('common.select')}</option>
        {ATM_BANK_CODES.map((bankCode) => (
          <option key={bankCode} value={bankCode}>
            {`${bankCode} · ${bankName(bankCode, locale)}`}
          </option>
        ))}
      </Select>
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
      {identity}
      {keys}
      {cassettes}
      {hours}
      {combination}
      {location}
      {section('lifecycle', lifecycle)}
      {section('hub', [textBox('hub', { suggestions: options?.hubs ?? [] })])}
    </div>
  );
};
