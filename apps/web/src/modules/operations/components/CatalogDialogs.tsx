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
import { Suspense, lazy, useEffect, useState, type FormEvent } from 'react';
import {
  type OperationsAreaDto,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsLocation,
  type OperationsShiftTypeColour,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select } from '../../../shared/ui/form';
import { PinIcon } from '../../../shared/ui/icons';
// Leaflet and its stylesheet ride in this chunk. Reference data is edited by a handful of people;
// everyone else must not download a mapping library to look at a shipment.
const BranchMapPicker = lazy(async () => import('./BranchMapPicker'));

import {
  mapsUrl,
  parseMapsLink,
  type MapsCoordinates,
  type MapsLinkFailure,
} from '../lib/maps-link';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from '../../fleet/components/DesignDialog';
import { DesignField, LOOK, MONO, Stroke, boxTone } from '../../fleet/components/FuelCardDialog';
import { FILTER_ICON } from '../../fleet/components/FilterWithIcon';
import { SHIPMENT_PATH } from './shipment-icons';
import { errorMessage } from '../../../shared/lib/errors';
import { ApiError } from '../../../shared/lib/api-client';
import { useAppSelector } from '../../../store';
import { NoColourSwatch, SHIFT_TYPE_TONE, ShiftTypeTag } from './shift-type-look';
import { paletteFor } from '../lib/type-colours';
import { branchSaveErrorKey } from '../lib/shipment-form';
import {
  useCreateOperationsArea,
  useCreateOperationsBank,
  useCreateOperationsBankBranch,
  useCreateOperationsCurrency,
  useCreateOperationsShiftType,
  useUpdateOperationsArea,
  useUpdateOperationsBank,
  useUpdateOperationsBankBranch,
  useUpdateOperationsCurrency,
  useUpdateOperationsShiftType,
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

/**
 * A branch's location, from the two things the form collects.
 *
 * The whole object is null when NEITHER is given, rather than `{addressLine: null, coordinates:
 * null}` — an empty shell would read as "this branch has a location" to every consumer, and the
 * captain's screen branches on exactly that.
 *
 * The dialog used to hard-code `location: null` here, which meant every save ERASED whatever the
 * branch had. The field has existed on the contract, the model and the captain read model since
 * B1 with no way to fill it and a standing way to lose it.
 */
export const branchLocation = (
  addressLine: string,
  coordinates: MapsCoordinates | null,
): OperationsLocation | null =>
  addressLine.trim() === '' && coordinates === null
    ? null
    : { addressLine: orNull(addressLine), coordinates };

/** Two fields a row on a computer, one on a phone — the Fleet forms' grid. */
const FORM_GRID = 'grid grid-cols-1 items-start gap-5 md:grid-cols-2';
/** The Fleet forms' select box (MaintenanceDialogs), red-ringed while a required one is empty. */
const designSelect = (missing: boolean): string =>
  cn(
    '!h-auto !rounded-xl !py-3 !ps-4 !text-[15px] !font-medium !text-slate-900 dark:!text-white focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500',
    missing
      ? '!border-rose-500/70 !bg-slate-50 shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)] dark:!bg-[#0a1233]'
      : '!border-slate-200 !bg-slate-50 dark:!border-[#2b3b6b] dark:!bg-[#0a1233]',
  );
/** «قراءة» beside the link box — a quiet button of the design's height. */
const SECONDARY_BUTTON =
  'shrink-0 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-[#2b3b6b] dark:bg-[#0f1838] dark:text-slate-200 dark:hover:text-indigo-300';
/** «اختيار على الخريطة» — the design's dashed secondary button (the shipment form's «إضافة عملة»). */
const DASHED_BUTTON =
  'inline-flex items-center gap-1.5 rounded-xl border border-dashed border-indigo-300 px-4 py-2 text-sm font-bold text-indigo-600 transition-colors hover:bg-indigo-50 dark:border-indigo-500/50 dark:text-indigo-300 dark:hover:bg-indigo-500/10';

export const BankBranchDialog = ({
  open,
  branch,
  banks,
  areas,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean;
  branch: OperationsBankBranchDto | null;
  banks: OperationsBankDto[];
  /**
   * Area SUGGESTIONS, not options (B6). Legacy rendered the city list into a `<datalist>` on this
   * exact field (data_edit.ejs:924) and saved whatever string came out — typed or picked. Turning
   * it into a required select would be a new rule and would reject every existing free-text area.
   */
  areas: OperationsAreaDto[];
  onClose: () => void;
  /**
   * A NEW branch that starts filled in — the shipment form's «add this branch»: the bank the
   * operator was choosing from and the name they typed and did not find. Ignored when editing.
   */
  initial?: { bankId: string; name: string };
  /** The branch as the server saved it — so the form that asked for it can select it at once. */
  onSaved?: (saved: OperationsBankBranchDto) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const create = useCreateOperationsBankBranch();
  const update = useUpdateOperationsBankBranch();

  const [bankId, setBankId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [opsArea, setOpsArea] = useState('');
  const [financeArea, setFinanceArea] = useState('');
  const [addressLine, setAddressLine] = useState('');
  // The POINT is the state; the link field is only how it gets entered, so it clears on open and
  // is never read back from the branch — what was saved is coordinates, not whatever URL produced
  // them.
  const [coordinates, setCoordinates] = useState<MapsCoordinates | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkError, setLinkError] = useState<MapsLinkFailure | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBankId(branch?.bankId ?? initial?.bankId ?? '');
    setName(branch?.name ?? initial?.name ?? '');
    setCode(branch?.code ?? '');
    setOpsArea(branch?.opsAreaName ?? '');
    setFinanceArea(branch?.financeAreaName ?? '');
    setAddressLine(branch?.location?.addressLine ?? '');
    setCoordinates(branch?.location?.coordinates ?? null);
    setLinkDraft('');
    setLinkError(null);
    setMapOpen(false);
    // `initial` is read on OPEN only: it is a starting point, not a value to keep in step with.
  }, [open, branch]);

  const applyLink = (raw: string): void => {
    const result = parseMapsLink(raw);
    if (result.ok) {
      setCoordinates(result.coordinates);
      setLinkDraft('');
      setLinkError(null);
      return;
    }
    setLinkError(result.reason);
  };

  // «شكل الفورم بتاعت اضافة فرع تكون احسن من كدا»: the Fleet forms' design — the same panel, sections
  // and boxes as the shipment form it opens over — and the same «!» on what is still missing.
  const required = useRequiredFields(
    [
      { key: 'bank', label: t('operations.catalogs.branch.bank'), ok: bankId !== '' },
      { key: 'name', label: t('operations.catalogs.branch.name'), ok: name.trim() !== '' },
      { key: 'code', label: t('operations.catalogs.branch.code'), ok: code.trim() !== '' },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    const core = {
      bankId,
      name: name.trim(),
      code: code.trim(),
      opsAreaName: orNull(opsArea),
      // Q24 PRESERVE — the finance label follows the operations one unless given its own.
      financeAreaName: financeAreaDefault(opsArea, financeArea),
      location: branchLocation(addressLine, coordinates),
    };
    try {
      const saved =
        branch === null
          ? await create.mutateAsync(core)
          : await update.mutateAsync({ id: branch.id, body: { ...core, version: branch.version } });
      toast.success(t('operations.catalogs.saved'));
      onSaved?.(saved);
      onClose();
    } catch (error) {
      // The branch mutations leave their errors to this form (operations-queries.ts): ONE message,
      // naming a duplicate — which from the shipment form is usually a deactivated branch's name.
      const key = branchSaveErrorKey(error);
      toast.error(key === null ? errorMessage(error, locale) : t(key));
    }
  };

  const busy = create.isPending || update.isPending;
  const box = boxTone(LOOK.add);
  return (
    // A DesignDialog takes no click on its backdrop, so a stray click cannot throw away a branch
    // half typed in — nor land on the shipment form underneath. Escape closes only this one: it is
    // on top of the dialog stack (`DesignDialog`).
    <DesignDialog
      open={open}
      onClose={onClose}
      title={t(
        branch === null ? 'operations.catalogs.branch.add' : 'operations.catalogs.branch.edit',
      )}
      icon={SHIPMENT_PATH.bank}
      width="3xl"
      panelProps={{ 'data-branch-form': branch === null ? 'new' : 'edit' }}
      footer={
        <>
          <DesignSave
            data-branch-save="true"
            busy={busy}
            onClick={required.guard(() => void submit())}
          />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />

      <DesignSection title={t('operations.catalogs.branch.sections.details')} icon={SHIPMENT_PATH.bank}>
        <div className={FORM_GRID}>
          <DesignField
            label={t('operations.catalogs.branch.bank')}
            required
            missing={required.isMissing('bank')}
          >
            <Select
              value={bankId}
              onChange={(e) => setBankId(e.target.value)}
              className={designSelect(required.isMissing('bank'))}
              aria-label={t('operations.catalogs.branch.bank')}
            >
              <option value="">{t('common.select')}</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.opsName}
                </option>
              ))}
            </Select>
          </DesignField>
          <DesignField
            label={t('operations.catalogs.branch.code')}
            required
            missing={required.isMissing('code')}
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              tone={cn(box, MONO)}
              aria-label={t('operations.catalogs.branch.code')}
              data-branch-code="true"
            />
          </DesignField>
        </div>
        <DesignField
          label={t('operations.catalogs.branch.name')}
          required
          missing={required.isMissing('name')}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            tone={box}
            aria-label={t('operations.catalogs.branch.name')}
          />
        </DesignField>
      </DesignSection>

      <DesignSection title={t('operations.catalogs.branch.sections.areas')} icon={SHIPMENT_PATH.route}>
        <div className={FORM_GRID}>
          <DesignField
            label={t('operations.catalogs.branch.opsArea')}
            hint={t('operations.catalogs.branch.opsAreaHint')}
          >
            <Input
              value={opsArea}
              onChange={(e) => setOpsArea(e.target.value)}
              list="operations-area-suggestions"
              tone={box}
              aria-label={t('operations.catalogs.branch.opsArea')}
              data-branch-ops-area="true"
            />
            <datalist id="operations-area-suggestions">
              {areas.map((area) => (
                <option key={area.id} value={area.name} />
              ))}
            </datalist>
          </DesignField>
          <DesignField
            label={t('operations.catalogs.branch.financeArea')}
            hint={t('operations.catalogs.branch.financeAreaHint')}
          >
            <Input
              value={financeArea}
              onChange={(e) => setFinanceArea(e.target.value)}
              tone={box}
              aria-label={t('operations.catalogs.branch.financeArea')}
            />
          </DesignField>
        </div>
      </DesignSection>

      {/*
        The branch's location. Optional end to end — legacy carried no geography at all, so most
        rows are blank and a captain's screen degrades to names. What is stored is the POINT; the
        link field below is only how a point gets in, and a saved point regenerates a working
        link forever, which a pasted URL would not.
      */}
      <DesignSection title={t('operations.catalogs.branch.sections.location')} icon={FILTER_ICON.map}>
        <DesignField
          label={t('operations.catalogs.branch.address')}
          hint={t('operations.catalogs.branch.addressHint')}
        >
          <Input
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            tone={box}
            aria-label={t('operations.catalogs.branch.address')}
          />
        </DesignField>

        <DesignField
          label={t('operations.catalogs.branch.mapsLink')}
          hint={t('operations.catalogs.branch.mapsLinkHint')}
          error={linkError === null ? undefined : t(`operations.catalogs.branch.maps.${linkError}`)}
          endAdornment={null}
        >
          <div className="flex gap-2">
            <Input
              value={linkDraft}
              placeholder="https://maps.app.goo.gl/… , 30.0444, 31.2357"
              dir="ltr"
              tone={cn(box, MONO)}
              aria-label={t('operations.catalogs.branch.mapsLink')}
              onChange={(e) => {
                setLinkDraft(e.target.value);
                setLinkError(null);
              }}
              // A paste is the whole interaction, so it does not also need a button pressed.
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (pasted.trim() !== '') {
                  e.preventDefault();
                  applyLink(pasted);
                }
              }}
              // Enter here means "read this", not "save the branch".
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                applyLink(linkDraft);
              }}
            />
            <button
              type="button"
              onClick={() => applyLink(linkDraft)}
              className={SECONDARY_BUTTON}
            >
              {t('operations.catalogs.branch.maps.read')}
            </button>
          </div>
        </DesignField>

        <button
          type="button"
          onClick={() => setMapOpen((wasOpen) => !wasOpen)}
          className={DASHED_BUTTON}
        >
          <Stroke d={[...FILTER_ICON.map]} className="h-4 w-4" />
          {t(mapOpen ? 'operations.catalogs.branch.maps.hide' : 'operations.catalogs.branch.maps.pick')}
        </button>
        {mapOpen && (
          <Suspense
            fallback={
              <div className="h-64 w-full animate-pulse rounded-xl bg-slate-100 dark:bg-[#0a1233]" />
            }
          >
            <BranchMapPicker value={coordinates} onChange={setCoordinates} />
          </Suspense>
        )}

        {coordinates === null ? (
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            {t('operations.catalogs.branch.maps.none')}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-slate-200">
            <PinIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <span className={cn(MONO, 'tabular-nums')} dir="ltr">
              {coordinates.lat}, {coordinates.lng}
            </span>
            {/* Checking what was just saved is one click, on the map everyone already trusts. */}
            <a
              href={mapsUrl(coordinates)}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-indigo-600 underline dark:text-indigo-300"
            >
              {t('operations.catalogs.branch.maps.open')}
            </a>
            <button
              type="button"
              className="ms-auto font-bold text-rose-600 underline dark:text-rose-400"
              onClick={() => setCoordinates(null)}
            >
              {t('common.remove')}
            </button>
          </div>
        )}
      </DesignSection>
    </DesignDialog>
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

/**
 * The operational area — the legacy `/data_edit` city form (contad_app.js:2033).
 *
 * `nameEn` and `governorate` are OPTIONAL here where legacy required both (:2042). Legacy's
 * requirement was not honoured by its own data — many rows carry the Arabic name twice — and the
 * only thing either field does is help somebody find the right suggestion.
 */
export const AreaDialog = ({
  open,
  area,
  onClose,
}: {
  open: boolean;
  area: OperationsAreaDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateOperationsArea();
  const update = useUpdateOperationsArea();

  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [governorate, setGovernorate] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(area?.name ?? '');
    setNameEn(area?.nameEn ?? '');
    setGovernorate(area?.governorate ?? '');
  }, [open, area]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const core = {
      name: name.trim(),
      nameEn: orNull(nameEn),
      governorate: orNull(governorate),
    };
    try {
      if (area === null) await create.mutateAsync(core);
      else await update.mutateAsync({ id: area.id, body: { ...core, version: area.version } });
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
      title={t(area === null ? 'operations.catalogs.area.add' : 'operations.catalogs.area.edit')}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('operations.catalogs.area.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t('operations.catalogs.area.nameEn')}>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field
          label={t('operations.catalogs.area.governorate')}
          hint={t('operations.catalogs.area.governorateHint')}
        >
          <Input value={governorate} onChange={(e) => setGovernorate(e.target.value)} />
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

/**
 * The swatches the type's form offers — Round 24b, «عاوز pallett الالوان يكون على عدد الالوان يكون نفس
 * عدد النوع»: the board's palette (`paletteFor` — every colour a live type wears, then the first
 * unworn ones), as many colours as there are live types — counting the one being added — and an
 * archived type's own colour at the end when it is not among them (kept, and shown as its). A live
 * type's own colour is always among them. «بدون لون» (Round 34 C) is no swatch of it: the form offers
 * it on its own, first.
 */
export const shiftTypeFormPalette = (
  types: readonly OperationsShiftTypeDto[],
  shiftType: OperationsShiftTypeDto | null,
): OperationsShiftTypeColour[] => {
  const palette = paletteFor(types, shiftType === null ? 1 : 0);
  return shiftType !== null && shiftType.colour !== null && !palette.includes(shiftType.colour)
    ? [...palette, shiftType.colour]
    : palette;
};

/**
 * «أنواع التشغيل» — one type of the crew board's «النوع» (Round 20): «انا عاوز النوع يكون بيضاف من
 * البيانات المرجعيه». The areas' form (an Arabic name, an optional English one) and a colour from
 * the contract's palette, chosen by swatch, with the type drawn as the board will draw it. Archiving
 * is not here: the tab's own button says it in one click (`isActive`), as the server takes it.
 *
 * Round 34 C — «مش لازم نوع يكون واخد اجبارى لون»: «بدون لون» is the first choice (`colour: null`);
 * a type saved with a colour can be set back to it, and a colour given again.
 *
 * Round 34 F — «ممكن عملية تكون من غير لون مش لازم ان يومى او محصنة تبقى واخده لون اجبارى»: a NEW type
 * opens on «بدون لون» and is saved with none unless a colour is pressed — the palette beside it, a
 * colour nobody wears among it, one press away. An edited type opens on the colour it has, or none.
 */
export const ShiftTypeDialog = ({
  open,
  shiftType,
  types,
  onClose,
}: {
  open: boolean;
  shiftType: OperationsShiftTypeDto | null;
  /** The catalog — the palette the form shows (one swatch a live type, and one for the new type). */
  types: readonly OperationsShiftTypeDto[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const create = useCreateOperationsShiftType();
  const update = useUpdateOperationsShiftType();

  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  /**
   * The colour picked — or null, «بدون لون» (Round 34 C). A new type starts on none (Round 34 F); an
   * edited one on its own — from the first paint, and again on every opening (below).
   */
  const [colour, setColour] = useState<OperationsShiftTypeColour | null>(
    () => shiftType?.colour ?? null,
  );
  /** A name another type holds (409) — said on the name's own box. */
  const [taken, setTaken] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(shiftType?.name ?? '');
    setNameEn(shiftType?.nameEn ?? '');
    // Round 34 F: no colour is forced on a type — a new one opens on «بدون لون».
    setColour(shiftType === null ? null : shiftType.colour);
    setTaken(false);
  }, [open, shiftType]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const core = { name: name.trim(), nameEn: orNull(nameEn), colour };
    try {
      if (shiftType === null) await create.mutateAsync(core);
      else
        await update.mutateAsync({
          id: shiftType.id,
          body: { ...core, version: shiftType.version },
        });
      toast.success(t('operations.catalogs.saved'));
      onClose();
    } catch (failure) {
      // The catalog's unique name (a live type's Arabic name) — the one 409 that is about a field.
      if (failure instanceof ApiError && failure.code === 'DUPLICATE') {
        setTaken(true);
        toast.error(t('operations.catalogs.shiftType.nameTaken'));
        return;
      }
      toast.error(errorMessage(failure, locale));
    }
  };

  // The type as the board will draw it — the name typed, in the colour picked.
  const preview: OperationsShiftTypeDto = {
    id: shiftType?.id ?? 'preview',
    name: name.trim() === '' ? t('operations.catalogs.shiftType.name') : name.trim(),
    nameEn: orNull(nameEn),
    colour,
    sortOrder: null,
    isActive: true,
    version: 0,
    createdAt: '',
    updatedAt: '',
  };

  const busy = create.isPending || update.isPending;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(
        shiftType === null
          ? 'operations.catalogs.shiftType.add'
          : 'operations.catalogs.shiftType.edit',
      )}
    >
      <form onSubmit={submit} className="space-y-4" data-shift-type-form="true">
        <Field
          label={t('operations.catalogs.shiftType.name')}
          required
          error={taken ? t('operations.catalogs.shiftType.nameTaken') : undefined}
        >
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTaken(false);
            }}
            required
            maxLength={60}
            error={taken}
          />
        </Field>
        <Field label={t('operations.catalogs.shiftType.nameEn')}>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={60} />
        </Field>
        <Field
          label={t('operations.catalogs.shiftType.colour')}
          hint={t('operations.catalogs.shiftType.colourHint')}
        >
          <div className="space-y-3">
            <div
              role="radiogroup"
              aria-label={t('operations.catalogs.shiftType.colour')}
              className="flex flex-wrap gap-2"
              data-shift-type-palette="true"
            >
              <button
                type="button"
                role="radio"
                // Not a swatch of the palette — the type's colour taken off (`colour: null`).
                data-colour-off="true"
                aria-checked={colour === null}
                aria-label={t('operations.catalogs.shiftType.noColour')}
                title={t('operations.catalogs.shiftType.noColourHint')}
                onClick={() => setColour(null)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border pe-3 ps-1 text-[12.5px] font-bold text-slate-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:text-slate-200 dark:focus-visible:ring-offset-slate-900',
                  // Checked as a swatch is: the ring of the page's ink around it.
                  colour === null
                    ? 'border-solid border-slate-900 ring-1 ring-slate-900 dark:border-white dark:ring-white'
                    : 'border-dashed border-slate-300 hover:border-slate-400 dark:border-slate-600',
                )}
              >
                <NoColourSwatch size="lg" />
                {t('operations.catalogs.shiftType.noColour')}
              </button>
              {shiftTypeFormPalette(types, shiftType).map((option) => {
                const label = t(`operations.catalogs.shiftType.colours.${option}`);
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    data-colour={option}
                    aria-checked={option === colour}
                    aria-label={label}
                    title={label}
                    onClick={() => setColour(option)}
                    className={cn(
                      'h-8 w-8 rounded-full transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
                      SHIFT_TYPE_TONE[option].dot,
                      option === colour &&
                        'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-slate-900',
                    )}
                  />
                );
              })}
            </div>
            <div
              className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 dark:border-slate-700"
              data-shift-type-preview="true"
            >
              <ShiftTypeTag type={preview} locale={locale} size="md" />
            </div>
          </div>
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
