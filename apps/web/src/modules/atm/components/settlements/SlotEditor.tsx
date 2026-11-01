// One cassette slot (S-2, §9.3, §9.5): its kind, denomination and currency. Used by the layout
// editor and the spare-line dialog.
//
// THE KIND DECIDES WHAT ELSE A SLOT HOLDS (§3.1 `layoutIssues`): an empty slot holds nothing, a
// deposit slot no denomination (its currency is optional, GS-14), and a withdrawal or recycle slot
// both. Changing the kind clears what the new kind cannot hold, so the row never shows a value the
// save would refuse; whatever is still wrong is the server's rule, shown under the row.
//
// AN EGP DENOMINATION IS ONE OF THE PAPERS' SIX (DS-4); a foreign one is typed (1–1000, GS-14).
import {
  ATM_EGP_DENOMINATIONS,
  ATM_SLOT_KINDS,
  type AtmCassetteSlot,
  type AtmLayoutIssueCode,
  type AtmSlotKind,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Input, Select } from '../../../../shared/ui/form';

const OTHER = 'OTHER';

/** What a kind change leaves of the slot. */
export const withKind = (slot: AtmCassetteSlot, kind: AtmSlotKind): AtmCassetteSlot => {
  if (kind === 'empty') return { slot: slot.slot, kind, denomination: null, currency: null };
  if (kind === 'deposit')
    return { slot: slot.slot, kind, denomination: null, currency: slot.currency };
  return {
    slot: slot.slot,
    kind,
    denomination: slot.denomination,
    currency: slot.currency ?? 'EGP',
  };
};

export const SlotEditor = ({
  slot,
  label,
  onChange,
  issues = [],
  kinds = ATM_SLOT_KINDS,
  egpOnly = false,
  disabled = false,
}: {
  slot: AtmCassetteSlot;
  /** «الكاسيت n». */
  label: string;
  onChange: (next: AtmCassetteSlot) => void;
  /** This slot's `layoutIssues` codes. */
  issues?: readonly AtmLayoutIssueCode[];
  /** The kinds offered — a spare set offers the fillable two only (DS-27). */
  kinds?: readonly AtmSlotKind[];
  /** Egyptian pounds only — a spare set's slots are all planned (§3.1). */
  egpOnly?: boolean;
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const foreign = slot.currency !== null && slot.currency !== 'EGP';
  const holdsDenomination = slot.kind === 'withdrawal' || slot.kind === 'recycle';
  const holdsCurrency = slot.kind !== 'empty';
  const currencyChoice = slot.currency === null ? '' : foreign ? OTHER : 'EGP';
  const id = `slot-${String(slot.slot)}`;

  return (
    <div data-slot-editor={slot.slot} className="space-y-1">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
        <Select
          aria-label={`${t('atm.layouts.editor.kind')} — ${label}`}
          density="tight"
          value={slot.kind}
          disabled={disabled}
          onChange={(e) => onChange(withKind(slot, e.target.value as AtmSlotKind))}
        >
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`atm.settlement.slotKind.${kind}`)}
            </option>
          ))}
        </Select>
        {foreign ? (
          <Input
            aria-label={`${t('atm.layouts.editor.denomination')} — ${label}`}
            density="tight"
            rule="integer"
            dir="ltr"
            value={slot.denomination === null ? '' : String(slot.denomination)}
            disabled={disabled || !holdsDenomination}
            onChange={(e) =>
              onChange({
                ...slot,
                denomination: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        ) : (
          <Select
            aria-label={`${t('atm.layouts.editor.denomination')} — ${label}`}
            density="tight"
            value={slot.denomination === null ? '' : String(slot.denomination)}
            disabled={disabled || !holdsDenomination}
            onChange={(e) =>
              onChange({
                ...slot,
                denomination: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          >
            <option value="">—</option>
            {ATM_EGP_DENOMINATIONS.map((d) => (
              <option key={d} value={String(d)}>
                {d}
              </option>
            ))}
          </Select>
        )}
        <div className="flex min-w-0 items-center gap-1.5">
          <Select
            aria-label={`${t('atm.layouts.editor.currency')} — ${label}`}
            density="tight"
            value={currencyChoice}
            disabled={disabled || !holdsCurrency || egpOnly}
            onChange={(e) => {
              const choice = e.target.value;
              onChange({
                ...slot,
                denomination: null,
                currency: choice === '' ? null : choice === 'EGP' ? 'EGP' : '',
              });
            }}
          >
            {(slot.kind === 'deposit' || slot.kind === 'empty') && <option value="">—</option>}
            <option value="EGP">{t('atm.settlement.currency.EGP')}</option>
            {!egpOnly && <option value={OTHER}>{t('atm.layouts.editor.currencyCode')}</option>}
          </Select>
          {foreign && (
            <Input
              id={`${id}-currency`}
              aria-label={`${t('atm.layouts.editor.currencyCode')} — ${label}`}
              density="tight"
              dir="ltr"
              maxLength={3}
              className="min-w-16 max-w-16 uppercase"
              value={slot.currency ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ ...slot, currency: e.target.value.trim().toUpperCase() })}
            />
          )}
        </div>
      </div>
      {issues.length > 0 && (
        <ul className="ps-[4.5rem] text-xs text-red-600 dark:text-red-400">
          {issues.map((code) => (
            <li key={code}>{t(`atm.layouts.layoutIssue.${code}`)}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
