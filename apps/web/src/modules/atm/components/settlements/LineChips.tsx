// The cassette chips (§9.3): a plan line's «الفئة × عدد الورق» per planned cassette, and a layout's
// cassettes as the layouts table shows them — a denomination per slot, «↻» on a recycle slot, «—»
// on an empty one (§9.5). Each chip carries its cassette and kind in a `title`, so the colour is
// never the only thing that tells two denominations apart (§9.10).
import { type AtmCassetteSlot, type AtmPlanSlot, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { DENOMINATION_COLOURS, lineChips } from '../../lib/settlement-view';

const CHIP = 'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums';

/** «200 × 2,000» per planned slot, in slot order (DS-4: only planned slots carry notes). */
export const LineChips = ({
  slots,
  locale,
}: {
  slots: readonly AtmPlanSlot[];
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap gap-1" data-line-chips="true">
      {lineChips(slots).map((chip) => (
        <span
          key={chip.slot}
          dir="ltr"
          title={t('atm.settlement.slot', { slot: chip.slot })}
          className={CHIP}
          style={{ background: chip.background, color: chip.colour }}
        >
          {`${String(chip.denomination)} × ${formatNumber(chip.notes, locale)}`}
        </span>
      ))}
    </span>
  );
};

/** One layout slot's chip text: the denomination (with the currency when it is not EGP). */
const slotText = (slot: AtmCassetteSlot): string => {
  if (slot.kind === 'empty') return '—';
  const denomination = slot.denomination === null ? '' : String(slot.denomination);
  const currency = slot.currency !== null && slot.currency !== 'EGP' ? ` ${slot.currency}` : '';
  return `${slot.kind === 'recycle' ? '↻' : ''}${denomination}${currency}`;
};

/** A layout's cassettes in slot order: «—» empty, «↻» recycle, a deposit slot by its kind. */
export const LayoutChips = ({ slots }: { slots: readonly AtmCassetteSlot[] }): JSX.Element => {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap gap-1" data-layout-chips="true">
      {[...slots]
        .sort((a, b) => a.slot - b.slot)
        .map((slot) => {
          const kind = t(`atm.settlement.slotKind.${slot.kind}`);
          const title = `${t('atm.settlement.slot', { slot: slot.slot })} · ${kind}`;
          if (slot.kind === 'empty') {
            return (
              <span
                key={slot.slot}
                title={title}
                className={`${CHIP} border border-dashed border-slate-300 text-slate-400 dark:border-slate-600`}
              >
                —
              </span>
            );
          }
          if (slot.kind === 'deposit') {
            return (
              <span
                key={slot.slot}
                title={title}
                className={`${CHIP} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`}
              >
                {kind}
              </span>
            );
          }
          const [background, colour] =
            slot.currency === 'EGP' && slot.denomination !== null
              ? (DENOMINATION_COLOURS[slot.denomination] ?? ['#f1f5f9', '#334155'])
              : ['#f1f5f9', '#334155'];
          return (
            <span
              key={slot.slot}
              dir="ltr"
              title={title}
              className={CHIP}
              style={{ background, color: colour }}
            >
              {slotText(slot)}
            </span>
          );
        })}
    </span>
  );
};
