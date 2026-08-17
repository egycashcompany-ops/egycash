// Create/edit forms for the three Operations reference kinds — the legacy `/data_edit` screen's
// add dialogs, rebuilt against the normalized entities.
//
// LEGACY PARITY NOTES worth keeping in view while reading this file:
//   · `opsName` is THE join key. Every legacy operations query matched banks by `bank_name_ops`
//     and nothing else (discovery §11.3), so it is required and separate from the display name.
//   · `financeAreaName` defaults to `opsAreaName` when left blank — legacy did exactly this on add
//     (`area2 = area2 || area`, contad_app.js:1909, quirk Q24, decided PRESERVE).
//   · `legacyAliases` exists because the legacy reports classify money by literal Arabic synonym
//     lists (`['مصري','جنيه','EGP']` — contad_app.js:5029). Parity needs those spellings as DATA.
//   · Reference rows DEACTIVATE, they do not delete: legacy soft-deleted and never checked whether
//     a shipment still referenced the row (quirk Q22), so removing one for real would silently
//     break history. `isActive` is the honest replacement.
import { useEffect, useState, type FormEvent } from 'react';
import {
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateOperationsBank,
  useCreateOperationsBankBranch,
  useCreateOperationsCurrency,
  useUpdateOperationsBank,
  useUpdateOperationsBankBranch,
  useUpdateOperationsCurrency,
} from '../api/operations-queries';

/** Blank → null, so an untouched optional field is absent rather than an empty string. */
export const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Legacy `area2 = area2 || area` (contad_app.js:1909, Q24 — PRESERVE).
 *
 * Kept as a named pure function rather than inlined so it is testable and so the next reader can
 * see it is a DELIBERATE legacy behaviour and not a bug. It is a form default only: the value is
 * sent explicitly, and the server stores exactly what it is sent.
 */
export const financeAreaDefault = (opsArea: string, financeArea: string): string | null =>
  orNull(financeArea) ?? orNull(opsArea);

/** Comma or newline separated, trimmed, blanks dropped — the alias editor's parse. */
export const parseAliases = (raw: string): string[] =>
  raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

export const BankDialog = ({
  open,
  bank,
  onClose,
}: {
  open: boolean;
  bank: OperationsBankDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateOperationsBank();
  const update = useUpdateOperationsBank();

  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [opsName, setOpsName] = useState('');
  const [sortOrder, setSortOrder] = useState('');

  useEffect(() => {
    if (!open) return;
    setCode(bank === null ? '' : String(bank.code));
    setNameAr(bank?.name.ar ?? '');
    setNameEn(bank?.name.en ?? '');
    setOpsName(bank?.opsName ?? '');
    setSortOrder(bank?.sortOrder === null || bank === null ? '' : String(bank.sortOrder));
  }, [open, bank]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const core = {
      code: Number(code),
      name: { ar: nameAr.trim(), en: nameEn.trim() },
      opsName: opsName.trim(),
      slogan: null,
      sortOrder: sortOrder.trim() === '' ? null : Number(sortOrder),
    };
    try {
      if (bank === null) await create.mutateAsync(core);
      else await update.mutateAsync({ id: bank.id, body: { ...core, version: bank.version } });
      toast.success(t('operations.catalogs.saved'));
      onClose();
    } catch {
      toast.error(t('operations.catalogs.saveFailed'));
    }
  };

  const busy = create.isPending || update.isPending;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(bank === null ? 'operations.catalogs.bank.add' : 'operations.catalogs.bank.edit')}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('operations.catalogs.bank.code')} required>
          <Input
            type="number"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            min={0}
          />
        </Field>
        <Field label={t('operations.catalogs.bank.nameAr')} required>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
        </Field>
        <Field label={t('operations.catalogs.bank.nameEn')} required>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
        </Field>
        <Field
          label={t('operations.catalogs.bank.opsName')}
          required
          hint={t('operations.catalogs.bank.opsNameHint')}
        >
          <Input value={opsName} onChange={(e) => setOpsName(e.target.value)} required />
        </Field>
        <Field
          label={t('operations.catalogs.bank.sortOrder')}
          hint={t('operations.catalogs.bank.sortOrderHint')}
        >
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            min={0}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export const BankBranchDialog = ({
  open,
  branch,
  banks,
  onClose,
}: {
  open: boolean;
  branch: OperationsBankBranchDto | null;
  banks: OperationsBankDto[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateOperationsBankBranch();
  const update = useUpdateOperationsBankBranch();

  const [bankId, setBankId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [opsArea, setOpsArea] = useState('');
  const [financeArea, setFinanceArea] = useState('');

  useEffect(() => {
    if (!open) return;
    setBankId(branch?.bankId ?? '');
    setName(branch?.name ?? '');
    setCode(branch?.code ?? '');
    setOpsArea(branch?.opsAreaName ?? '');
    setFinanceArea(branch?.financeAreaName ?? '');
  }, [open, branch]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const core = {
      bankId,
      name: name.trim(),
      code: code.trim(),
      opsAreaName: orNull(opsArea),
      // Q24 PRESERVE — the finance label follows the operations one unless given its own.
      financeAreaName: financeAreaDefault(opsArea, financeArea),
      location: null,
    };
    try {
      if (branch === null) await create.mutateAsync(core);
      else await update.mutateAsync({ id: branch.id, body: { ...core, version: branch.version } });
      toast.success(t('operations.catalogs.saved'));
      onClose();
    } catch {
      toast.error(t('operations.catalogs.saveFailed'));
    }
  };

  const busy = create.isPending || update.isPending;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(
        branch === null ? 'operations.catalogs.branch.add' : 'operations.catalogs.branch.edit',
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('operations.catalogs.branch.bank')} required>
          <Select value={bankId} onChange={(e) => setBankId(e.target.value)} required>
            <option value="">{t('common.select')}</option>
            {banks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.opsName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('operations.catalogs.branch.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t('operations.catalogs.branch.code')} required>
          <Input value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        <Field
          label={t('operations.catalogs.branch.opsArea')}
          hint={t('operations.catalogs.branch.opsAreaHint')}
        >
          <Input value={opsArea} onChange={(e) => setOpsArea(e.target.value)} />
        </Field>
        <Field
          label={t('operations.catalogs.branch.financeArea')}
          hint={t('operations.catalogs.branch.financeAreaHint')}
        >
          <Input value={financeArea} onChange={(e) => setFinanceArea(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export const CurrencyDialog = ({
  open,
  currency,
  onClose,
}: {
  open: boolean;
  currency: OperationsCurrencyDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateOperationsCurrency();
  const update = useUpdateOperationsCurrency();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');

  useEffect(() => {
    if (!open) return;
    setCode(currency?.code ?? '');
    setName(currency?.name ?? '');
    setAliases((currency?.legacyAliases ?? []).join(', '));
  }, [open, currency]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const core = {
      code: code.trim(),
      name: name.trim(),
      legacyAliases: parseAliases(aliases),
    };
    try {
      if (currency === null) await create.mutateAsync(core);
      else
        await update.mutateAsync({ id: currency.id, body: { ...core, version: currency.version } });
      toast.success(t('operations.catalogs.saved'));
      onClose();
    } catch {
      toast.error(t('operations.catalogs.saveFailed'));
    }
  };

  const busy = create.isPending || update.isPending;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(
        currency === null ? 'operations.catalogs.currency.add' : 'operations.catalogs.currency.edit',
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('operations.catalogs.currency.code')} required>
          <Input value={code} onChange={(e) => setCode(e.target.value)} required maxLength={8} />
        </Field>
        <Field label={t('operations.catalogs.currency.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field
          label={t('operations.catalogs.currency.aliases')}
          hint={t('operations.catalogs.currency.aliasesHint')}
        >
          <Input value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
