// One bank of the company-wide catalog (DEC-35), added or edited — on /atm/data-edit's «البنوك» tab
// and, for Efficiency, from the register. The owner's call (final): a bank added here is a FULL
// register bank, so the dialog asks for exactly what every screen shows of one: its name in both
// languages, its code, the text Operations write on its machines, and its colour.
//
// What the dialog says before the click, because nothing on the server would say it after:
//   · the code is the key stored on every record of the bank, so it is read-only once saved;
//   · a new Operations label leaves existing machines on the old text — which keeps counting for
//     this bank (`formerOpsLabels`);
//   · archiving a bank enabled for settlements does not take it out of settlements: an
//     administrator edits that setting, so a running plan day is never broken by an archive.
//
// Gated by the caller (`atmBank.create` / `atmBank.edit`); the server also requires both at
// ORGANIZATION scope — a bank is one fact about the company.
import { useEffect, useState, type FormEvent } from 'react';
import {
  ATM_BANK_CODE_PATTERN,
  ATM_BANK_COLOR_PATTERN,
  ATM_BANK_EXTRA_COLORS,
  AtmSettingKeys,
  ErrorCodes,
  type AtmBankDto,
  type CreateAtmBankInput,
  type Locale,
  type UpdateAtmBank,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useMySettings } from '../../../../platform/settings/settings-api';
import { useAppSelector } from '../../../../store';
import { ApiError } from '../../../../shared/lib/api-client';
import { errorMessage } from '../../../../shared/lib/errors';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button } from '../../../../shared/ui/Button';
import { Checkbox, Field, Input } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useAtmBankLookup, useCreateAtmBank, useUpdateAtmBank } from '../../api/atm-queries';
import { type BankLookup } from '../../lib/bank-catalog';

/** The dialog's fields as typed. */
export interface BankForm {
  code: string;
  nameAr: string;
  nameEn: string;
  opsLabel: string;
  color: string;
  isActive: boolean;
}

const BANK_ERROR_CODES = new Set<string>([
  ErrorCodes.ATM_BANK_CODE_TAKEN,
  ErrorCodes.ATM_BANK_LABEL_TAKEN,
  ErrorCodes.ATM_BANK_NAME_TAKEN,
]);

/** A refused bank save in the reader's words: the catalog's three 409s by name, the rest as usual. */
export const bankErrorText = (
  error: unknown,
  t: (key: string) => string,
  locale: Locale,
): string =>
  error instanceof ApiError && BANK_ERROR_CODES.has(error.code)
    ? t(`atm.bankCatalog.error.${error.code}`)
    : errorMessage(error, locale);

/** The code as the server will store it: trimmed and upper-cased (`CreateAtmBankSchema`). */
export const normalizeBankCode = (raw: string): string => raw.trim().toUpperCase();

/** The first extra colour no bank uses yet — the server's own default for a new bank. */
export const suggestedBankColor = (lookup: BankLookup): string => {
  const used = new Set(lookup.ordered.map((bank) => bank.color.toUpperCase()));
  return ATM_BANK_EXTRA_COLORS.find((color) => !used.has(color)) ?? ATM_BANK_EXTRA_COLORS[0] ?? '';
};

const nameOk = (value: string): boolean => value.trim() !== '' && value.trim().length <= 80;

/** Whether the form can be sent: both names, a well-shaped code (on add), a label that fits, a colour. */
export const bankFormComplete = (form: BankForm, isNew: boolean): boolean =>
  nameOk(form.nameAr) &&
  nameOk(form.nameEn) &&
  (!isNew || ATM_BANK_CODE_PATTERN.test(normalizeBankCode(form.code))) &&
  form.opsLabel.trim().length <= 64 &&
  (isNew || form.opsLabel.trim() !== '') &&
  ATM_BANK_COLOR_PATTERN.test(form.color.trim().toUpperCase());

/** POST /atm/banks. An empty Operations label is left out: the server then uses the code. */
export const createBankBody = (form: BankForm): CreateAtmBankInput => {
  const opsLabel = form.opsLabel.trim();
  return {
    code: normalizeBankCode(form.code),
    name: { ar: form.nameAr.trim(), en: form.nameEn.trim() },
    ...(opsLabel === '' ? {} : { opsLabel }),
    color: form.color.trim().toUpperCase(),
  };
};

/**
 * PATCH /atm/banks/:code — only what changed, and the version. An unchanged Operations label is
 * not sent, so a save that only renames never moves the label into `formerOpsLabels`.
 */
export const updateBankBody = (bank: AtmBankDto, form: BankForm): UpdateAtmBank => {
  const name = { ar: form.nameAr.trim(), en: form.nameEn.trim() };
  const opsLabel = form.opsLabel.trim();
  const color = form.color.trim().toUpperCase();
  return {
    ...(name.ar !== bank.name.ar || name.en !== bank.name.en ? { name } : {}),
    ...(opsLabel !== bank.opsLabel ? { opsLabel } : {}),
    ...(color !== bank.color.toUpperCase() ? { color } : {}),
    ...(form.isActive !== bank.isActive ? { isActive: form.isActive } : {}),
    version: bank.version,
  };
};

/** The form a dialog opens on: the bank's own values, or an empty add with a suggested colour. */
export const bankFormOf = (bank: AtmBankDto | null, lookup: BankLookup): BankForm => ({
  code: bank?.code ?? '',
  nameAr: bank?.name.ar ?? '',
  nameEn: bank?.name.en ?? '',
  opsLabel: bank?.opsLabel ?? '',
  color: bank?.color ?? suggestedBankColor(lookup),
  isActive: bank?.isActive ?? true,
});

/**
 * What the edit says before the click: a new Operations label leaves machines on the old text
 * (which keeps counting for the bank), and archiving a bank `atm.settlements.banks` enables does
 * not take it out of settlements.
 */
export const bankDialogNotes = (
  bank: AtmBankDto | null,
  form: BankForm,
  settlementBanks: readonly string[],
): { labelChanged: boolean; archivingEnabled: boolean } => ({
  labelChanged: bank !== null && form.opsLabel.trim() !== bank.opsLabel,
  archivingEnabled:
    bank !== null && bank.isActive && !form.isActive && settlementBanks.includes(bank.code),
});

/** The banks `atm.settlements.banks` enables, as the caller's settings resolve it. */
const settlementBanksOf = (values: readonly { key: string; value: unknown }[] | undefined) => {
  const value = values?.find((s) => s.key === AtmSettingKeys.SettlementBanks)?.value;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
};

export const BankDialog = ({
  open,
  onClose,
  bank,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** null = add; a catalog bank = version-aware edit (the code stays read-only). */
  bank: AtmBankDto | null;
  /** After a successful save — the register sets its bank select to a bank it just added. */
  onSaved?: (bank: AtmBankDto) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const lookup = useAtmBankLookup();
  // Read only to warn on an archive; asked while an edit is open.
  const settings = useMySettings(open && bank !== null);
  // Seeded from the props, so the dialog opens on its bank rather than a blank first frame; and
  // re-seeded each time it opens. The suggested colour is taken then, not re-taken while the form
  // is being filled (a catalog refetch would otherwise reset a colour the reader just picked).
  const [form, setForm] = useState<BankForm>(() => bankFormOf(bank, lookup));
  const set = (patch: Partial<BankForm>): void => setForm((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (open) setForm(bankFormOf(bank, lookup));
  }, [open, bank]);

  const create = useCreateAtmBank();
  const update = useUpdateAtmBank();
  const pending = create.isPending || update.isPending;
  const isNew = bank === null;
  const complete = bankFormComplete(form, isNew);
  const code = normalizeBankCode(form.code);
  const codeInvalid = isNew && code !== '' && !ATM_BANK_CODE_PATTERN.test(code);
  const { labelChanged, archivingEnabled } = bankDialogNotes(
    bank,
    form,
    settlementBanksOf(settings.data),
  );

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!complete) return;
    try {
      const saved =
        bank === null
          ? await create.mutateAsync(createBankBody(form))
          : await update.mutateAsync({ code: bank.code, body: updateBankBody(bank, form) });
      toast.success(t(bank === null ? 'atm.bankCatalog.added' : 'atm.bankCatalog.saved'));
      onSaved?.(saved);
      onClose();
    } catch (error) {
      toast.error(bankErrorText(error, t, locale));
    }
  };

  return (
    // A form you fill in — five fields — and since the register's «+» it is opened OVER the receipt
    // form, whose own dialogs already ignore a stray click: «لو دوست في اى حته الموديل ميتقفلش غير
    // لما ادوس على الاكس» (Dialog.tsx). The × and Escape still close it.
    <Dialog
      open={open}
      onClose={onClose}
      title={t(bank === null ? 'atm.bankCatalog.add' : 'atm.bankCatalog.edit')}
      dismissOnOutsideClick={false}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4" data-bank-dialog="true">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('atm.bankCatalog.nameAr')} required>
            <Input
              value={form.nameAr}
              onChange={(e) => set({ nameAr: e.target.value })}
              maxLength={80}
              required
              dir="rtl"
            />
          </Field>
          <Field label={t('atm.bankCatalog.nameEn')} required>
            <Input
              value={form.nameEn}
              onChange={(e) => set({ nameEn: e.target.value })}
              maxLength={80}
              required
              dir="ltr"
            />
          </Field>
        </div>
        <Field
          label={t('atm.bankCatalog.code')}
          required={isNew}
          hint={t(isNew ? 'atm.bankCatalog.codeHint' : 'atm.bankCatalog.codeFixed')}
          error={codeInvalid ? t('atm.bankCatalog.codeInvalid') : undefined}
        >
          <Input
            value={form.code}
            onChange={(e) => set({ code: e.target.value.toUpperCase() })}
            disabled={!isNew}
            required={isNew}
            maxLength={10}
            dir="ltr"
          />
        </Field>
        <Field
          label={t('atm.bankCatalog.opsLabel')}
          required={!isNew}
          hint={t('atm.bankCatalog.opsLabelHint')}
          warning={labelChanged ? t('atm.bankCatalog.opsLabelChanged') : undefined}
        >
          <Input
            value={form.opsLabel}
            onChange={(e) => set({ opsLabel: e.target.value })}
            placeholder={isNew ? code : undefined}
            maxLength={64}
            dir="ltr"
          />
        </Field>
        <Field label={t('atm.bankCatalog.color')} hint={t('atm.bankCatalog.colorHint')}>
          <input
            type="color"
            value={form.color.toLowerCase()}
            onChange={(e) => set({ color: e.target.value.toUpperCase() })}
            className="h-10 w-16 cursor-pointer rounded border border-slate-300 dark:border-slate-600"
            aria-label={t('atm.bankCatalog.color')}
          />
        </Field>
        {bank !== null && (
          <div className="space-y-1">
            <Checkbox
              checked={form.isActive}
              onChange={(e) => set({ isActive: e.target.checked })}
              label={t('atm.bankCatalog.isActive')}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('atm.bankCatalog.activeHint')}
            </p>
            {archivingEnabled && (
              <p
                data-bank-settlements-warning="true"
                className="text-xs text-amber-600 dark:text-amber-400"
              >
                {t('atm.bankCatalog.settlementsWarning')}
              </p>
            )}
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
