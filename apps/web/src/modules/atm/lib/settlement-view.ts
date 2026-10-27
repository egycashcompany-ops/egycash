// Pure view logic shared by the settlement pages (docs/12-planning/atm-settlements-phase1.md §9.3):
// the words and tones of a line's status, a run, an issue; the plan's state chip; the cassette
// chips; the bag count. Kept out of the components so each rule is one testable fact.
//
// ONE WORD PER CONCEPT (DS-32): a slot is «كاسيت», a bag «شوال», a cassette seal «سيلز». Every word
// here is an i18n key — the papers' words live in `papers/settlement-paper-wording.ts`, not here.
import {
  isPlanned,
  type AtmPlanLineIssue,
  type AtmPlanLineStatus,
  type AtmPlanRun,
  type AtmPlanSlot,
  type AtmPreparationStatus,
  type AtmSettlementPlanDto,
} from '@ecms/contracts';
import { type Tone } from '../../../shared/ui/Badge';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** «مسودة» / «معتمدة» / «جاهزة» / «ملغاة». */
export const lineStatusKey = (status: AtmPlanLineStatus): string =>
  `atm.settlement.status.${status}`;

/** The draft waits on Settlements, an issued line on Preparation; a ready one is done. */
export const LINE_STATUS_TONE: Readonly<Record<AtmPlanLineStatus, Tone>> = {
  draft: 'warning',
  issued: 'info',
  prepared: 'success',
  cancelled: 'neutral',
};

/** «لم تبدأ» / «ناقصة» / «مكتملة» / «جاهزة». */
export const preparationStatusKey = (status: AtmPreparationStatus): string =>
  `atm.settlement.prep.${status}`;

export const PREPARATION_STATUS_TONE: Readonly<Record<AtmPreparationStatus, Tone>> = {
  none: 'neutral',
  partial: 'warning',
  complete: 'info',
  prepared: 'success',
};

/** «التغذية الأولى» … «التغذية الثالثة» (S-5, DS-31). */
export const runLabel = (run: AtmPlanRun, t: Translate): string => t(`atm.settlement.run.${run}`);

/** One issue of §3.7 in the reader's words; a slot issue names its cassette. */
export const issueText = (issue: AtmPlanLineIssue, t: Translate): string =>
  t(
    `atm.settlement.issue.${issue.code}`,
    issue.slot === undefined ? undefined : { slot: issue.slot },
  );

export type AtmPlanState = 'draft' | 'issued' | 'partlyIssued';

/**
 * The plan's chip: no line issued yet → «مسودة»; every non-cancelled line issued or prepared →
 * «معتمدة»; issued lines beside drafts → «معتمدة جزئيًا». An empty plan is a draft.
 */
export const planState = (
  summary: Pick<AtmSettlementPlanDto['summary'], 'byStatus'>,
): AtmPlanState => {
  const issued = summary.byStatus.issued + summary.byStatus.prepared;
  if (issued === 0) return 'draft';
  return summary.byStatus.draft === 0 ? 'issued' : 'partlyIssued';
};

export const PLAN_STATE_TONE: Readonly<Record<AtmPlanState, Tone>> = {
  draft: 'warning',
  issued: 'success',
  partlyIssued: 'info',
};

/** The mockup's chip colours per denomination: [background, text]. */
export const DENOMINATION_COLOURS: Readonly<Record<number, readonly [string, string]>> = {
  200: ['#e0e7ff', '#3730a3'],
  100: ['#d1fae5', '#065f46'],
  50: ['#fef3c7', '#92400e'],
  20: ['#ffe4e6', '#9f1239'],
  10: ['#f1f5f9', '#334155'],
  5: ['#f1f5f9', '#334155'],
};
const OTHER_COLOURS = ['#f1f5f9', '#334155'] as const;

export interface LineChip {
  slot: number;
  denomination: number;
  notes: number;
  bag: 1 | 2 | null;
  background: string;
  colour: string;
}

/**
 * «الكاسيتات (الفئة × عدد الورق)»: one chip per PLANNED slot, in slot order (DS-4: a deposit,
 * empty or foreign slot carries no notes and no chip). The caller formats `notes`.
 */
export const lineChips = (slots: readonly AtmPlanSlot[]): LineChip[] =>
  slots
    .filter(isPlanned)
    .sort((a, b) => a.slot - b.slot)
    .map((s) => {
      const denomination = s.denomination ?? 0;
      const [background, colour] = DENOMINATION_COLOURS[denomination] ?? OTHER_COLOURS;
      return { slot: s.slot, denomination, notes: s.notes, bag: s.bag, background, colour };
    });

/** «شوال واحد» / «شوالان (4 كاسيتات في الشوال)» — a line has one or two bags (S-6). */
export const bagsText = (bags: number, t: Translate): string =>
  t(bags > 1 ? 'atm.settlement.bags.two' : 'atm.settlement.bags.one');
