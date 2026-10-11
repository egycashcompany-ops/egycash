// «عاوز اغير لون النوع بين كاوتش وبنزين وغسيل» — one colour per kind of custody spend, written ONCE
// and worn wherever the kinds are drawn: the badge in «كل الحركات», the figure's tile, every mark,
// swatch and legend of «لوحة تحكم».
//
// The house rules leave little room. Purple is the pressed/picked colour; green, amber and red are
// STATES. Teal reads as green (ΔE 4.9 against emerald) and pink as red, so the only hues left are
// the blue–cyan arc — fuel is blue, washing cyan — and the other two kinds are neutrals told apart
// by lightness: the dealership a warm stone grey (a bill, not a consumable) and the tyres rubber
// ink, near-black on the light page and near-white on the dark one. Every pair sits ΔE ≥ 21 apart
// for normal vision and ≥ 17.7 under colour-blindness (OKLab, dataviz validator, both themes), and
// the kind's NAME always rides beside its colour — badge text, an icon on the tile, a legend on
// every chart — so the colour is never the only way to tell them apart.
//
// The fills are SOLID: a pale badge cannot carry this identity (blue-100 and cyan-100 are ΔE 4.3).
// Every class is written out whole, `dark:` variant included, so Tailwind sees each one.
import { FLEET_CUSTODY_SOURCES, type FleetCustodySource } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { FILTER_ICON } from './FilterWithIcon';
import { PATH } from './FuelCardBoard';

export interface CustodyKindLook {
  /** The solid fill: the badge, the figure's tile, a chart's mark, a legend's swatch. */
  fill: string;
  /** The words and icon set ON that fill — chosen for its contrast there, never for identity. */
  ink: string;
  icon: readonly string[];
}

/** A tyre: the rubber and the rim. */
const TYRE = ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 15a3 3 0 100-6 3 3 0 000 6z'];
/** A drop of water. */
const DROP = [
  'M12 3.5c-3.2 4.2-5.75 7.6-5.75 10.75a5.75 5.75 0 0011.5 0C17.75 11.1 15.2 7.7 12 3.5z',
];

export const CUSTODY_KIND: Record<FleetCustodySource, CustodyKindLook> = {
  // stone-500 both themes — white on it 4.8:1.
  dealership: { fill: 'bg-stone-500', ink: 'text-white', icon: PATH.truck },
  // blue-700 / blue-600 — white on it 6.7:1 / 5.2:1.
  fuel: { fill: 'bg-blue-700 dark:bg-blue-600', ink: 'text-white', icon: FILTER_ICON.charge },
  // slate-800 / slate-200 — the ink flips with the page, 14.6:1 / 14.5:1.
  tyres: {
    fill: 'bg-slate-800 dark:bg-slate-200',
    ink: 'text-white dark:text-slate-900',
    icon: TYRE,
  },
  // cyan-500 both themes — cyan-950 on it 5.5:1. Under 3:1 against white, so every chart that
  // draws it also writes its values (labels, legend, table view).
  wash: { fill: 'bg-cyan-500', ink: 'text-cyan-950', icon: DROP },
};

/** The kinds in the filter's and the figures' order — the order every chart stacks them in. */
export const CUSTODY_KINDS = FLEET_CUSTODY_SOURCES;

/** «إجمالي مصروفات العهدة» is every kind at once, so it wears none of theirs. */
export const CUSTODY_TOTAL_TILE = 'bg-slate-500/10 text-slate-700 dark:text-slate-200';

/**
 * The kind in «كل الحركات» — the alarms board's `lg` pill (`Badge`'s own size), in the kind's
 * solid fill. Not `Badge` with a class handed in: `cn` only joins, so a tone's own colours would
 * fight the kind's.
 */
export const CustodyKindBadge = ({ kind }: { kind: FleetCustodySource }): JSX.Element => {
  const t = useT();
  return (
    <span
      data-custody-kind={kind}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[15px] font-medium leading-5',
        CUSTODY_KIND[kind].fill,
        CUSTODY_KIND[kind].ink,
      )}
    >
      {t(`fleet.custody.source.${kind}`)}
    </span>
  );
};

/** The legend's key — a small square in the kind's fill; the name beside it stays in text ink. */
export const CustodyKindSwatch = ({
  kind,
  className,
}: {
  kind: FleetCustodySource;
  className?: string;
}): JSX.Element => (
  <span
    aria-hidden="true"
    data-custody-swatch={kind}
    className={cn(
      'inline-block h-2.5 w-2.5 shrink-0 rounded-sm',
      CUSTODY_KIND[kind].fill,
      className,
    )}
  />
);
