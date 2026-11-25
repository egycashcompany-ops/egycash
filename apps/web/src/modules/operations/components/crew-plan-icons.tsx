// What a crew member carries, as icons — «على حسب الحاجات اللى انا مسجلها فى متطلبات الطاقم يظهر جمب
// القائد او الاخصائى». The legacy chips carried a gun, a card and a pen beside the name.
//
// DRAWN, NOT EMOJI. The crew cards before this used emoji (🔫 ✍️ 🪪 ⏳): a water pistol on most
// phones, a different picture on every system, and no way to colour them for a dark chip. These are
// stroke drawings in the boards' own icon style (`StrokeIcon`), one per flag, white on the chip's
// colour, each with its name as `aria-label` (the screen reader) and a TIP (the hover).
//
// THE TIP, NOT `title` (Round 22). The owner: «وعاوز لما اقف على سلاح او مزولة وتظهر يبقى فشكل احسن من
// كدا» — the browser's grey `title` box, late and plain. Each icon (on a chip, and as a pool's
// filter) now opens a small tip in the cards' own frame, both themes: the icon again, larger, and
// its name. It rides the Fleet cards' mechanics (`useHoverCard` + `HoverCardLayer`): the same beat
// before it opens, at once on a keyboard focus (the filters; a chip's icons sit inside the chip's
// own button, and the person card names them all), one open at a time across every card and tip,
// closed on leave, Escape and any press. It NEVER gets in a drag's way: drawn in a layer that takes
// no pointer events, closed by the press that starts a drag, and not opened at all while one is in
// progress (`quiet` — the board's own «a chip is being dragged»).
//
// INDICATORS, NOT GATES: they inform the planner and filter the pools; none stops an assignment.
import { type ReactNode } from 'react';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { StrokeIcon } from '../../../shared/ui/StrokeIcon';
import {
  HOVER_TIP_FRAME,
  HoverCardLayer,
  useHoverCard,
  type HoverCardTriggerProps,
} from '../../fleet/components/HoverCardLayer';
import { type PlanFlag } from '../lib/crew-plan';

const ring = (cx: number, cy: number, r: number): string =>
  `M${cx + r} ${cy}a${r} ${r} 0 1 1-${r * 2} 0a${r} ${r} 0 1 1 ${r * 2} 0`;

/** One drawing per requirement — 24×24 strokes, as every board icon. */
export const FLAG_PATH: Record<PlanFlag, readonly string[]> = {
  // A pistol: slide, grip, trigger.
  hasWeapon: ['M3 7h18v4h-8.5v1.5a2 2 0 0 1-2 2H8.4L7.2 20H3.6l1.6-9H3z', 'M9.5 11v1.6'],
  // A pen over a line — the signature on file.
  hasSignature: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  // An id card — the practising licence.
  hasLicense: [
    'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    ring(9, 10.5, 2),
    'M5.8 15.5c.6-1.2 1.8-1.9 3.2-1.9s2.6.7 3.2 1.9',
    'M14.5 10h4',
    'M14.5 14h3',
  ],
  // An hourglass — the TEMPORARY licence, told apart at a glance from the full one.
  hasTemporaryLicense: [
    'M6 3h12',
    'M6 21h12',
    'M7.5 3v3.4a2 2 0 0 0 .6 1.4L12 12l3.9-4.2a2 2 0 0 0 .6-1.4V3',
    'M7.5 21v-3.4a2 2 0 0 1 .6-1.4L12 12l3.9 4.2a2 2 0 0 1 .6 1.4V21',
  ],
  // A briefcase — «موظف عمليات», the office's own staff.
  isOpsAdmin: [
    'M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
    'M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2',
    'M3 13.5h18',
  ],
  // Sparkles — «جديد».
  isNewJoiner: [
    'M11 3l1.8 4.7L17.5 9.5l-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z',
    'M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  ],
  // A star — «أولوية».
  isPriority: ['M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z'],
  // A target — «مهمة خاصة».
  isAssignedSpecialTask: [ring(12, 12, 9), ring(12, 12, 5), ring(12, 12, 1)],
};

/** The board's own drawings for its controls. */
export const PLAN_ICON = {
  clock: [ring(12, 12, 9), 'M12 7v5l3 2'],
  pin: ['M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z', ring(12, 10.5, 2.2)],
  drop: ['M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z'],
  noVan: [
    'M3 3l18 18',
    'M8 6h5a1 1 0 0 1 1 1v8M3 7v9a1 1 0 0 0 1 1h1',
    'M17 9h1.6l3.4 3.4V16a1 1 0 0 1-1 1h-1',
  ],
  wrench: [
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  ],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  // The captain's mark on «توزيع المحصنات»'s van card (Round 24c) — two rank chevrons.
  rank: ['M6 12l6-4.5 6 4.5', 'M6 18l6-4.5 6 4.5'],
  // «ألوان الأنواع» (Round 24b) — a painter's palette.
  palette: [
    'M12 3a9 9 0 0 0 0 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8.2-9-8.2z',
    ring(7.5, 11, 1.1),
    ring(10.5, 7.3, 1.1),
    ring(15.2, 8.2, 1.1),
  ],
  tag: [
    'M7 7h.01',
    'M3 3h7.6a2 2 0 0 1 1.4.6l8.4 8.4a2 2 0 0 1 0 2.8l-5.6 5.6a2 2 0 0 1-2.8 0L3.6 12A2 2 0 0 1 3 10.6z',
  ],
  // «استخدام «…» اتجاهًا» (Round 28) — a pen: the direction as the desk typed it.
  pen: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  // «تبديل بين سيارتين» (Round 32 C) — two arrows crossing the other way: ⇄.
  swap: ['M4 8h15', 'M15 4l4 4-4 4', 'M20 16H5', 'M9 12l-4 4 4 4'],
  // «إضافة صف بدون سيارة» (Round 34 H) — the table's rows and a plus beside the last: a ROW added,
  // never a bare «+» (from 1280 to 1759 the act is its icon alone). Drawn for left-to-right; the
  // board mirrors it in Arabic, the plus at the rows' end.
  //
  // Round 34 H critic — drawn on the pixels it lands on. It is shown at 14px (`h-3.5`), 7/12 of its
  // 24 units, where a 2-unit stroke is 1.17px: a line is sharp only when it lands on a pixel's middle
  // (y × 7/12 = n + ½, so y = 4.29, 6, 7.71 … 11.14, 12.86 … 18). Rows at 6, 12 and 18 put the
  // middle one on a pixel's edge — two half-grey pixels, a smear — and the 7-unit plus was 4px.
  // Now: rows at 4.29, 11.14 and 18 (pixels 2½, 6½, 10½ — 4px apart), the plus 8 units across
  // (4.7px) on pixel 10½ × 8½, beside the two short rows.
  addRow: ['M4 4.29h16', 'M4 11.14h6', 'M4 18h6', 'M18 10.57v8', 'M14 14.57h8'],
  // «إضافة سيارة» on «الطاقم الثابت» (Round 34 H critic) — a van and a plus over its cab, where the
  // act is its icon alone (below 480): never a bare «+», told apart from the board's rows-and-plus.
  // Snapped to the 14px grid as `addRow` is; drawn for left-to-right, mirrored in Arabic (the van
  // drives toward the reading's end, the plus there).
  addVan: [
    'M14.57 18V9.43H2.57V18h1.72',
    'M9.43 18h5.14',
    'M14.57 12.86H18l3.43 3.43V18h-.86',
    ring(6.86, 18.86, 1.5),
    ring(18, 18.86, 1.5),
    'M19.71 .86v6.86',
    'M16.28 4.29h6.86',
  ],
} as const;

/**
 * The person's icons, in `PLAN_FLAGS` order, in the text's colour — white on a chip. `sm` (a pool's
 * chip) draws each on a faint square; `xs` (a chip seated in the table's narrow slot) the bare
 * drawing, so the name keeps the room.
 */
export const CrewFlagMarks = ({
  flags,
  size = 'sm',
  quiet = false,
  className,
}: {
  flags: readonly PlanFlag[];
  size?: 'xs' | 'sm';
  /** A drag is in progress on the board: no tip opens. */
  quiet?: boolean;
  className?: string;
}): JSX.Element | null => {
  if (flags.length === 0) return null;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center',
        size === 'xs' ? 'gap-px' : 'gap-0.5',
        className,
      )}
    >
      {flags.map((flag) => (
        <FlagMark key={flag} flag={flag} size={size} quiet={quiet} />
      ))}
    </span>
  );
};

/** One icon of a chip, with its tip. Its name stays its `aria-label`; the tip is for the eye. */
const FlagMark = ({
  flag,
  size,
  quiet,
}: {
  flag: PlanFlag;
  size: 'xs' | 'sm';
  quiet: boolean;
}): JSX.Element => {
  const t = useT();
  const tip = useFlagTip(flag, quiet);
  return (
    <>
      <span
        role="img"
        data-flag={flag}
        aria-label={t(`operations.crew.flag.${flag}`)}
        {...tip.triggerProps}
        className={cn(
          'inline-flex items-center justify-center',
          size === 'xs' ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px] rounded bg-white/20',
        )}
      >
        <StrokeIcon
          d={FLAG_PATH[flag]}
          className={size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'}
          width={2.2}
        />
      </span>
      {tip.tip}
    </>
  );
};

/** What a tip's trigger takes, and the tip itself while open (a portal — where it sits is nothing). */
export interface FlagTip {
  triggerProps: HoverCardTriggerProps & { 'data-flag-tip': PlanFlag };
  tip: ReactNode;
}

/**
 * The tip for one requirement icon — spread `triggerProps` on the icon (or the filter button that
 * draws it) and render `tip` beside it. `quiet`: a drag is in progress — no tip opens, and an open
 * one is gone.
 *
 * Adds no tab stop (`focusable: false`): a chip's icons sit inside the chip's button, and a filter
 * is a button already — there a keyboard focus opens it, at once. The trigger is NOT described by
 * the tip (no `aria-describedby`): its `aria-label` already says the same name, and a screen reader
 * would read it twice.
 */
export const useFlagTip = (flag: PlanFlag, quiet: boolean): FlagTip => {
  const hover = useHoverCard(!quiet, { focusable: false });
  const props: HoverCardTriggerProps = { ...hover.triggerProps };
  delete props['aria-describedby'];
  return {
    triggerProps: { ...props, 'data-flag-tip': flag },
    tip: hover.open ? (
      <HoverCardLayer
        id={hover.id}
        anchor={hover.anchor}
        mark="crew-flag"
        frame={HOVER_TIP_FRAME}
        align="center"
      >
        <FlagTipBody flag={flag} />
      </HoverCardLayer>
    ) : null,
  };
};

/** The tip's words: the icon again, in the cards' tinted square, and the flag's name. */
export const FlagTipBody = ({ flag }: { flag: PlanFlag }): JSX.Element => {
  const t = useT();
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap" data-flag-tip-body={flag}>
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-300"
      >
        <StrokeIcon d={FLAG_PATH[flag]} className="h-3.5 w-3.5" width={2} />
      </span>
      {t(`operations.crew.flag.${flag}`)}
    </span>
  );
};
