// Pure view logic shared by the settlement pages (docs/12-planning/atm-settlements-phase1.md §9.3):
// the words and tones of a line's status, a run, an issue; the plan's state chip; the cassette
// chips; the bag count. Kept out of the components so each rule is one testable fact.
//
// ONE WORD PER CONCEPT (DS-32): a slot is «كاسيت», a bag «شوال», a cassette seal «سيلز». Every word
// here is an i18n key — the papers' words live in `papers/settlement-paper-wording.ts`, not here.
import {
  ATM_CASSETTE_NOTES_MAX,
  ATM_LAYOUT_IMPORT_OUTCOMES,
  ErrorCodes,
  bagAllocation,
  fromMinorUnits,
  isPlanned,
  type Locale,
  type AtmPlanLineIssue,
  type AtmPlanLineStatus,
  type AtmPlanRun,
  type AtmPlanSlot,
  type AtmPreparationStatus,
  type AtmSettlementPlanDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { formatMoney, formatNumber } from '../../../shared/lib/format';
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

// ── What a line is called, and how many bags it has ─────────────────────────

/** A line's machine ID as the screens print it: the machine's code, a spare's code, or «—». */
export const lineCode = (line: { machineCode: string | null; spareCode: string | null }): string =>
  line.machineCode ?? line.spareCode ?? '—';

/**
 * The line's bags: an issued line's slots carry their bag (set at issue); a draft's are what the
 * issue will give it — `bagAllocation` over the planned slots (S-6, §6.5 S18).
 */
export const lineBags = (slots: readonly AtmPlanSlot[]): { bag: 1 | 2; slots: number[] }[] => {
  const issued = slots.filter(isPlanned).some((s) => s.bag !== null);
  if (!issued) return bagAllocation(slots);
  const bags = new Map<1 | 2, number[]>();
  for (const s of [...slots].sort((a, b) => a.slot - b.slot)) {
    if (s.bag === null) continue;
    bags.set(s.bag, [...(bags.get(s.bag) ?? []), s.slot]);
  }
  return [...bags.entries()].sort(([a], [b]) => a - b).map(([bag, list]) => ({ bag, slots: list }));
};

// ── Why a page cannot work, and a refusal in the reader's words ─────────────

export type SettlementBlocked = 'chooseBranch' | 'noBranch';

/**
 * The work branch could not be resolved (DS-22): S1 says so in `blocked`, every other read answers
 * 422 `ATM_WORK_BRANCH_REQUIRED` with `CHOOSE_BRANCH` / `NO_BRANCH` — one state for both (§6.2).
 */
export const blockedOf = (error: unknown): SettlementBlocked | null => {
  if (!(error instanceof ApiError) || error.code !== ErrorCodes.ATM_WORK_BRANCH_REQUIRED) {
    return null;
  }
  return error.details?.some((d) => d.code === 'NO_BRANCH') === true ? 'noBranch' : 'chooseBranch';
};

/** «اختر فرعًا محددًا من القائمة العلوية.» / «لا يوجد فرع ضمن صلاحيتك لهذه الصفحة.» */
export const blockedKey = (blocked: SettlementBlocked): string => `atm.settlement.${blocked}`;

/** The detail code a 400 carried, when it carried one of these. */
const detailCode = (error: ApiError, codes: readonly string[]): string | undefined =>
  error.details?.find((d) => codes.includes(d.code))?.code;

const detailCount = (error: ApiError, field: string): number =>
  Number(error.details?.find((d) => d.field === field)?.message ?? 0) || 0;

/** `bags[0].qr` / `seals[slot=3]` (§6.8 P4) → «QR الشوال الأول» / «سيلز الكاسيت 3». */
export const missingFieldLabel = (field: string, t: Translate): string => {
  const bag = /^bags\[(\d+)\]\.qr$/.exec(field);
  if (bag !== null) return t(`atm.prep.qrLabel.${String(Number(bag[1]) + 1)}`);
  const seal = /^seals\[slot=(\d+)\]$/.exec(field);
  if (seal !== null) return t('atm.prep.sealLabel', { slot: Number(seal[1]) });
  return field;
};

/** The workbook's missing sheet or headers (§5.2), named as the file names them. */
const layoutNames = (error: ApiError): string =>
  (error.details ?? [])
    .filter((d) => d.code === 'MISSING_HEADER' || d.code === 'MISSING_SHEET')
    .map((d) => d.message)
    .join('، ');

/**
 * A settlement refusal in the reader's words (§6.1 codes, §9.4–§9.7). The named 409 / 422 codes
 * and the field codes the pages act on have their own sentence; everything else — a stale
 * document, a missing key — is the app's shared wording (`errorMessage`).
 */
export const settlementErrorText = (error: unknown, t: Translate, locale: Locale): string => {
  if (!(error instanceof ApiError)) return errorMessage(error, locale);
  const blocked = blockedOf(error);
  if (blocked !== null) return t(blockedKey(blocked));
  switch (error.code) {
    case ErrorCodes.ATM_SETTLEMENT_BANK_NOT_ENABLED:
      return t('atm.plan.error.bankNotEnabled');
    case ErrorCodes.ATM_PLAN_EXISTS:
      return t('atm.plan.error.exists');
    case ErrorCodes.ATM_PLAN_FULL:
      return t('atm.plan.error.full');
    case ErrorCodes.ATM_PLAN_LINE_STATE:
      return t('atm.plan.error.lineState');
    case ErrorCodes.ATM_PLAN_LINE_HAS_CAPTURES:
      return t('atm.plan.error.hasCaptures');
    case ErrorCodes.ATM_PLAN_ISSUE_BLOCKED:
      return t('atm.plan.error.issueBlocked');
    case ErrorCodes.ATM_STANDARD_LOAD_IN_USE:
      return t('atm.layouts.error.inUse', {
        layouts: detailCount(error, 'layouts'),
        draftLines: detailCount(error, 'draftLines'),
      });
    case ErrorCodes.ATM_LAYOUT_IMPORT_FILE_CHANGED:
      return t('atm.layoutImport.error.fileChanged');
    case ErrorCodes.ATM_LAYOUT_IMPORT_RUNNING:
      return t('atm.layoutImport.error.running');
    case ErrorCodes.ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK:
      return t('atm.layoutImport.error.unsupported');
    case ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT:
      return detailCode(error, ['TOO_LARGE']) !== undefined
        ? t('atm.layoutImport.error.tooLarge')
        : t('atm.layoutImport.error.layout', { names: layoutNames(error) });
    case ErrorCodes.ATM_PREPARATION_LOCKED:
      return t('atm.prep.error.locked');
    case ErrorCodes.ATM_PREPARATION_INCOMPLETE:
      return t('atm.prep.error.incomplete', {
        list: (error.details ?? []).map((d) => missingFieldLabel(d.field ?? '', t)).join('، '),
      });
    default:
      break;
  }
  const field = detailCode(error, [
    'SLOT_NOT_FILLABLE',
    'CASSETTE_NOTES_MAX',
    'INVALID_SEAL',
    'DUPLICATE_NAME',
    'MOVED',
    'UNREADABLE',
  ]);
  if (field === 'SLOT_NOT_FILLABLE') return t('atm.plan.error.slotNotFillable');
  if (field === 'CASSETTE_NOTES_MAX') {
    return t('atm.plan.error.cassetteNotesMax', {
      max: formatNumber(ATM_CASSETTE_NOTES_MAX, locale),
    });
  }
  if (field === 'INVALID_SEAL') return t('atm.prep.error.invalidSeal');
  if (field === 'DUPLICATE_NAME') return t('atm.control.error.duplicateName');
  if (field === 'MOVED') return t('atm.control.error.moved');
  if (field === 'UNREADABLE') return t('atm.registerImport.error.unreadable');
  return errorMessage(error, locale);
};

/** A 409 the page answers by re-reading what it shows (`STALE_DOCUMENT`, incl. a route `MOVED`). */
export const isStale = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT;

// ── Money (DS-28) ───────────────────────────────────────────────────────────

/** EGP minor units on a screen: converted ONCE with `fromMinorUnits`, then `formatMoney`. */
export const formatEgp = (minor: number, locale: Locale): string =>
  formatMoney(fromMinorUnits(minor), 'EGP', locale);

/** A denomination's notes as money: `notes × d × 100` minor units, converted once. */
export const denominationMinor = (denomination: number, notes: number): number =>
  notes * denomination * 100;

// ── The last import, from its run's counts (§9.5, §4.8) ─────────────────────

/** The outcomes whose row found a machine of the branch (§5.3). */
const MATCHED_OUTCOMES = [
  'new',
  'same',
  'changed',
  'changedManual',
  'archived',
  'noRegisterBank',
  'otherBank',
] as const;

/** The outcomes a person has to look at: not applied by the import, and not «غير موجودة». */
const REVIEW_OUTCOMES = [
  'invalid',
  'duplicateInFile',
  'archived',
  'noRegisterBank',
  'otherBank',
  'changedManual',
] as const;

/**
 * The strip «آخر استيراد …: {{rows}} صفًا في الملف · {{matched}} طابقت … · {{notFound}} غير موجودة
 * … · {{flags}} تحتاج مراجعة» from a run's counts. A run row keeps counts per outcome only — no
 * row and no flag (§4.8) — so «تحتاج مراجعة» counts the rows whose OUTCOME needs a person.
 */
export const lastImportFigures = (
  counts: Readonly<Record<string, number>>,
): { rows: number; matched: number; notFound: number; review: number } => {
  const of = (key: string): number => counts[key] ?? 0;
  return {
    rows: ATM_LAYOUT_IMPORT_OUTCOMES.reduce((sum, o) => sum + of(o), 0),
    matched: MATCHED_OUTCOMES.reduce((sum, o) => sum + of(o), 0),
    notFound: of('notFound'),
    review: REVIEW_OUTCOMES.reduce((sum, o) => sum + of(o), 0),
  };
};

// ── A Preparation line's state (§6.5 «preparationStatus», §9.6) ─────────────

/**
 * The state a Preparation row shows: a cancelled line says so; otherwise the preparation's — ready
 * when marked, complete when every required value is in, incomplete when some value is, not
 * started when none is (the server's `preparationStatus` rule, §6.5).
 */
export const prepStateOf = (line: {
  lineStatus: AtmPlanLineStatus;
  preparation: {
    status: 'open' | 'prepared';
    bags: readonly { qr: string | null }[];
    seals: readonly { value: string | null }[];
  };
  progress: { captured: number; required: number };
}): AtmPreparationStatus | 'cancelled' => {
  if (line.lineStatus === 'cancelled') return 'cancelled';
  if (line.preparation.status === 'prepared') return 'prepared';
  const any =
    line.preparation.bags.some((b) => b.qr !== null) ||
    line.preparation.seals.some((s) => s.value !== null);
  if (!any) return 'none';
  return line.progress.captured >= line.progress.required ? 'complete' : 'partial';
};
