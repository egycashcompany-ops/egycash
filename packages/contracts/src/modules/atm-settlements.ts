// ATM Settlements & Review → Preparation → Control & Supplies, phase 1 (Al Baraka pilot) — the
// domain rules, input schemas and DTOs (module `atm`).
//
// The spec is docs/12-planning/atm-settlements-phase1.md (owner decisions S-1…S-10, designer
// decisions DS-n, unknowns GS-n). This file is its §3 (pure rules, shared by the api and the web so
// the two can never disagree about a split, a bag or a total) and its §6.1 (schemas and DTOs).
//
// Three vocabularies, kept apart on purpose:
//   · a SLOT is one cassette position of a machine's layout (S-2): kind, denomination, currency;
//   · a PLANNED slot is the only kind this plan puts notes in (DS-4): withdrawal or recycle, in EGP.
//     Every fill, bag, total and printed cassette row below goes through `isPlanned`;
//   · a BAG («شوال», the papers' «الحقيبة») holds exactly four planned cassettes (S-6).
//
// MONEY (DS-28). Counts are integers; a value is EGP minor units (`…EgpTotalMinor`), integer, and is
// converted once with `fromMinorUnits` by whoever formats it. The largest line, 8 × 100,000 × 200 ×
// 100, stays far below 2⁵³.
import { z } from 'zod';
import { objectId, type LocalizedString } from '../common/index.js';
import { ATM_BULK_MAX_IDS } from './atm.js';
import { AtmBankCodeSchema, type AtmBankCode } from './atm-register.js';

// ── §3.1 Slots ──────────────────────────────────────────────────────────────────────────────────

export const ATM_SLOT_KINDS = ['withdrawal', 'deposit', 'recycle', 'empty'] as const;
export const AtmSlotKindSchema = z.enum(ATM_SLOT_KINDS);
export type AtmSlotKind = z.infer<typeof AtmSlotKindSchema>;

/** The six EGP denominations every paper lists, in the papers' order (DS-4). */
export const ATM_EGP_DENOMINATIONS = [200, 100, 50, 20, 10, 5] as const;
export type AtmEgpDenomination = (typeof ATM_EGP_DENOMINATIONS)[number];

export const ATM_LAYOUT_SLOTS_MIN = 4;
export const ATM_LAYOUT_SLOTS_MAX = 8;
export const ATM_SPARE_SLOTS_MIN = 1;
/** S-6: «كل شوال بيشيل ٤ كاسيتات». */
export const ATM_BAG_CASSETTES = 4;
/** S-4: an even split is rounded to whole hundreds of notes. */
export const ATM_NOTES_ROUNDING = 100;
/** DS-30: a sanity cap, not a capacity (GS-13). */
export const ATM_CASSETTE_NOTES_MAX = 100_000;
/** DS-5: the three Full list labels a layout keeps, with their caps. */
export const ATM_LABEL_MAX = { typeLabel: 60, featuresLabel: 40, hubLabel: 60 } as const;

export interface AtmCassetteSlot {
  /** 1..8, contiguous from 1, in the stored (printed) order. */
  slot: number;
  kind: AtmSlotKind;
  /** Null for empty and deposit slots. */
  denomination: number | null;
  /** ISO 4217, upper case; null for an empty slot (a deposit slot's is optional, GS-14). */
  currency: string | null;
}

/** Withdrawal and recycle cassettes are the ones a replenishment fills. */
export const isFillable = (s: AtmCassetteSlot): boolean =>
  s.kind === 'withdrawal' || s.kind === 'recycle';

/** DS-4: THE predicate for "this plan puts notes in it" — fillable AND EGP. */
export const isPlanned = (s: AtmCassetteSlot): boolean => isFillable(s) && s.currency === 'EGP';

const EGP_DENOMINATION_SET: ReadonlySet<number> = new Set(ATM_EGP_DENOMINATIONS);
export const isEgpDenomination = (value: number): value is AtmEgpDenomination =>
  EGP_DENOMINATION_SET.has(value);

/**
 * DS-5: strips control and format characters (`\p{Cc}\p{Cf}`), applies NFC, collapses runs of white
 * space to one space and trims — in that order. Applied to every Full list label before it is
 * compared or stored.
 */
export const cleanLabel = (raw: string): string =>
  raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();

export const ATM_LAYOUT_ISSUE_CODES = [
  'SLOT_COUNT',
  'SLOT_NUMBERS',
  'EMPTY_HAS_VALUE',
  'DEPOSIT_HAS_DENOMINATION',
  'DENOMINATION_REQUIRED',
  'CURRENCY_REQUIRED',
  'EGP_DENOMINATION',
  'FOREIGN_DENOMINATION',
  'CURRENCY_FORMAT',
] as const;
export type AtmLayoutIssueCode = (typeof ATM_LAYOUT_ISSUE_CODES)[number];

export interface AtmLayoutIssue {
  /** The slot the issue is about; null for an issue of the whole layout. */
  slot: number | null;
  code: AtmLayoutIssueCode;
}

const CURRENCY_FORMAT = /^[A-Z]{3}$/;

/**
 * §3.1: what is wrong with a set of slots. A machine layout holds 4–8 slots; a spare set (S-9,
 * DS-27) holds 1–8, every one of them planned — a spare slot that is not planned is a `SLOT_COUNT`
 * issue on that slot. Empty means valid. A layout with no planned slot is valid (a deposit-only
 * machine) and simply cannot be planned (§3.7 `NO_FILLABLE_SLOT`).
 */
export const layoutIssues = (
  slots: readonly AtmCassetteSlot[],
  { spare = false }: { spare?: boolean } = {},
): AtmLayoutIssue[] => {
  const issues: AtmLayoutIssue[] = [];
  const min = spare ? ATM_SPARE_SLOTS_MIN : ATM_LAYOUT_SLOTS_MIN;
  if (slots.length < min || slots.length > ATM_LAYOUT_SLOTS_MAX) {
    issues.push({ slot: null, code: 'SLOT_COUNT' });
  }
  if (!slots.every((s, i) => s.slot === i + 1)) issues.push({ slot: null, code: 'SLOT_NUMBERS' });
  for (const s of slots) {
    const add = (code: AtmLayoutIssueCode): void => {
      issues.push({ slot: s.slot, code });
    };
    if (spare && !isPlanned(s)) add('SLOT_COUNT');
    if (s.kind === 'empty' && (s.denomination !== null || s.currency !== null)) {
      add('EMPTY_HAS_VALUE');
    }
    if (s.kind === 'deposit' && s.denomination !== null) add('DEPOSIT_HAS_DENOMINATION');
    if (isFillable(s) && s.denomination === null) add('DENOMINATION_REQUIRED');
    if (isFillable(s) && s.currency === null) add('CURRENCY_REQUIRED');
    if (s.currency !== null && !CURRENCY_FORMAT.test(s.currency)) add('CURRENCY_FORMAT');
    if (s.denomination !== null && s.currency === 'EGP' && !isEgpDenomination(s.denomination)) {
      add('EGP_DENOMINATION');
    }
    if (
      s.denomination !== null &&
      s.currency !== null &&
      s.currency !== 'EGP' &&
      !(Number.isInteger(s.denomination) && s.denomination >= 1 && s.denomination <= 1000)
    ) {
      add('FOREIGN_DENOMINATION');
    }
  }
  return issues;
};

// ── §3.2 Bags ───────────────────────────────────────────────────────────────────────────────────

export interface AtmBagAllocation {
  bag: 1 | 2;
  /** Slot numbers, in slot order. */
  slots: number[];
}

/**
 * S-6, DS-13: a line's planned slots in slot order, cut into bags of four. Deposit, empty and
 * foreign-currency slots are not bagged (DS-4). Layouts hold at most eight slots, so at most two
 * bags; more than eight planned slots is a programming error.
 */
export const bagAllocation = (slots: readonly AtmCassetteSlot[]): AtmBagAllocation[] => {
  const planned = slots
    .filter(isPlanned)
    .map((s) => s.slot)
    .sort((a, b) => a - b);
  if (planned.length > ATM_BAG_CASSETTES * 2) {
    throw new RangeError('a line has at most eight planned slots');
  }
  const bags: AtmBagAllocation[] = [];
  for (let i = 0; i < planned.length; i += ATM_BAG_CASSETTES) {
    bags.push({
      bag: i === 0 ? 1 : 2,
      slots: planned.slice(i, i + ATM_BAG_CASSETTES),
    });
  }
  return bags;
};

/** DS-13: a bag needs a QR unless every cassette in it holds 0 notes. */
export const bagNeedsQr = (
  bag: { slots: readonly number[] },
  slots: readonly { slot: number; notes: number }[],
): boolean => bag.slots.some((n) => (slots.find((s) => s.slot === n)?.notes ?? 0) > 0);

// ── §3.3 The even split (S-4, DS-12) ───────────────────────────────────────────────────────────

/**
 * `total` notes over `k` cassettes in whole hundreds: the first cassettes (slot order) take the
 * extra hundreds, and a remainder under 100 goes to the last one (a `NOT_MULTIPLE_OF_100` warning
 * on that slot, §3.7). Integer in, integer out.
 */
export const splitEvenly = (total: number, k: number): number[] => {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError('a note total is a non-negative integer');
  }
  if (!Number.isInteger(k) || k < 1) throw new RangeError('a split needs at least one cassette');
  const units = Math.floor(total / ATM_NOTES_ROUNDING);
  const rest = total - ATM_NOTES_ROUNDING * units;
  const base = Math.floor(units / k);
  const extra = units - base * k;
  return Array.from(
    { length: k },
    (_, j) => ATM_NOTES_ROUNDING * (base + (j < extra ? 1 : 0)) + (j === k - 1 ? rest : 0),
  );
};

export interface AtmDenominationNotes {
  denomination: number;
  notes: number;
}

export interface AtmSlotFill {
  /** Slot number → notes, for the slots this fill set. */
  notes: Map<number, number>;
  /** Denominations given that no planned slot carries, in the order given. */
  unplaced: number[];
}

/**
 * §3.3: THE method of S-4, used by `fillFromStandard` and by a typed per-denomination edit. Each
 * entry's notes are split evenly over the planned slots of its denomination; a foreign slot of the
 * same face value is never touched (DS-4). Slots of other denominations are absent from the map.
 */
export const splitByDenomination = (
  slots: readonly AtmCassetteSlot[],
  entries: readonly AtmDenominationNotes[],
): AtmSlotFill => {
  const notes = new Map<number, number>();
  const unplaced: number[] = [];
  const planned = slots.filter(isPlanned).sort((a, b) => a.slot - b.slot);
  for (const entry of entries) {
    const targets = planned.filter((s) => s.denomination === entry.denomination);
    if (targets.length === 0) {
      unplaced.push(entry.denomination);
      continue;
    }
    const shares = splitEvenly(entry.notes, targets.length);
    targets.forEach((s, i) => notes.set(s.slot, shares[i] ?? 0));
  }
  return { notes, unplaced };
};

// ── §3.4 Filling from a standard load ──────────────────────────────────────────────────────────

/**
 * S-3, DS-8: the planned slots of each profile denomination share its notes; a planned slot whose
 * denomination the profile does not carry gets 0 (Al Baraka's 20 EGP cassette today); a profile
 * denomination with no slot is `unplaced` (warning `STANDARD_DENOMINATION_UNPLACED`); a slot that
 * is not planned gets no entry at all. `null` (no profile) fills every planned slot with 0.
 */
export const fillFromStandard = (
  slots: readonly AtmCassetteSlot[],
  profile: { notes: readonly AtmDenominationNotes[] } | null,
): AtmSlotFill => {
  const fill = splitByDenomination(slots, profile?.notes ?? []);
  for (const s of slots) {
    if (isPlanned(s) && !fill.notes.has(s.slot)) fill.notes.set(s.slot, 0);
  }
  return fill;
};

// ── §3.5 Scanned values (DS-15) ────────────────────────────────────────────────────────────────

const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/g;

/** Arabic-Indic (U+0660–0669) and Eastern Arabic-Indic (U+06F0–06F9) digits → ASCII. */
const asciiDigits = (raw: string): string =>
  raw.replace(ARABIC_INDIC_DIGIT, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });

/**
 * The value as stored and printed: format characters (LRM, RLM, ALM, BOM, the zero-width marks)
 * and CR, LF, TAB removed, Arabic-Indic digits → ASCII, trimmed; '' → null. Case and inner
 * characters are KEPT — the bag QR's payload is unknown (GS-4, GS-6).
 */
export const cleanScannedValue = (raw: string | null | undefined): string | null => {
  if (raw === null || raw === undefined) return null;
  const cleaned = asciiDigits(raw.replace(/[\p{Cf}\r\n\t]/gu, '')).trim();
  return cleaned === '' ? null : cleaned;
};

/**
 * ONLY for finding duplicates (DS-15), stored beside the value and indexed: NFKC, every white
 * space removed, Latin letters upper-cased.
 */
export const sealKey = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/\p{Script=Latin}/gu, (c) => c.toUpperCase());

export const ATM_SCANNED_VALUE_WARNINGS = ['ARABIC_LETTERS'] as const;
export type AtmScannedValueWarning = (typeof ATM_SCANNED_VALUE_WARNINGS)[number];

/**
 * A keyboard-wedge scanner sends key positions, so under the Arabic layout a Latin seal arrives as
 * Arabic letters (U+0621–064A). A warning; it never blocks (GS-6).
 */
export const scannedValueWarnings = (value: string): AtmScannedValueWarning[] =>
  /[ء-ي]/.test(value) ? ['ARABIC_LETTERS'] : [];

export const ATM_BAG_QR_MAX = 200;
export const ATM_SEAL_VALUE_MAX = 64;
/** On the CLEANED value. The format is unknown (GS-6), so nothing narrower is assumed. */
export const AtmBagQrSchema = z
  .string()
  .min(1)
  .max(ATM_BAG_QR_MAX)
  .regex(/^[^\p{Cc}]+$/u);
export const AtmSealValueSchema = z
  .string()
  .min(1)
  .max(ATM_SEAL_VALUE_MAX)
  .regex(/^[^\p{Cc}]+$/u);

// ── §3.6 Lines, runs, times and totals ──────────────────────────────────────────────────────────

/** S-5, DS-31: a run is the machine's ordinal visit that day — 1st, 2nd, 3rd. */
export const ATM_PLAN_RUNS = [1, 2, 3] as const;
export type AtmPlanRun = (typeof ATM_PLAN_RUNS)[number];
export const ATM_PLAN_LINE_KINDS = ['machine', 'spare'] as const;
export type AtmPlanLineKind = (typeof ATM_PLAN_LINE_KINDS)[number];
/** DS-10: "printed" in the brief is `issued`. */
export const ATM_PLAN_LINE_STATUSES = ['draft', 'issued', 'prepared', 'cancelled'] as const;
export type AtmPlanLineStatus = (typeof ATM_PLAN_LINE_STATUSES)[number];
export const ATM_PLAN_LIVE_STATUSES = ['draft', 'issued', 'prepared'] as const;
/** DS-30: BM's sheet has 350 slots. */
export const ATM_PLAN_LINES_MAX = 400;
/** The stored form, 'HH:mm'. */
export const ATM_SCHEDULE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const LIVE_STATUS_SET: ReadonlySet<string> = new Set(ATM_PLAN_LIVE_STATUSES);
const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * A typed or pasted time → 'HH:mm' (UI-22). '' and null → null; 'HH:mm', 'H:mm', 'h:mm AM|PM' (any
 * case, optional space), 'h:mm ص|م' and the same with Arabic-Indic digits → 'HH:mm'; anything
 * else → 'bad', which the add call refuses for that row only (§6.5 S14).
 */
export const normalizeScheduleTime = (raw: string | null): string | null | 'bad' => {
  if (raw === null) return null;
  const text = asciiDigits(raw).trim();
  if (text === '') return null;
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (h24 !== null) {
    const hour = Number(h24[1]);
    const minute = Number(h24[2]);
    return hour <= 23 && minute <= 59 ? `${pad2(hour)}:${pad2(minute)}` : 'bad';
  }
  const h12 = /^(\d{1,2}):(\d{2})\s?(am|pm|ص|م)$/i.exec(text);
  if (h12 !== null) {
    const hour = Number(h12[1]);
    const minute = Number(h12[2]);
    if (hour < 1 || hour > 12 || minute > 59) return 'bad';
    const marker = (h12[3] ?? '').toLowerCase();
    const pm = marker === 'pm' || marker === 'م';
    const hour24 = (hour % 12) + (pm ? 12 : 0);
    return `${pad2(hour24)}:${pad2(minute)}`;
  }
  return 'bad';
};

export interface AtmPlanSlot extends AtmCassetteSlot {
  notes: number;
  /** Set at issue from `bagAllocation`; null on a draft and on a slot that is not bagged. */
  bag: 1 | 2 | null;
}

/** DS-28: Σ notes × denomination × 100 (EGP minor units) over the planned slots. */
export const lineEgpTotalMinor = (slots: readonly AtmPlanSlot[]): number => {
  let total = 0;
  for (const s of slots) {
    if (isPlanned(s)) total += s.notes * (s.denomination ?? 0) * 100;
  }
  return total;
};

/** Notes per EGP denomination over the planned slots, 200…5, only the denominations present. */
export const byDenomination = (slots: readonly AtmPlanSlot[]): AtmDenominationNotes[] => {
  const sums = new Map<number, number>();
  for (const s of slots) {
    if (!isPlanned(s) || s.denomination === null) continue;
    sums.set(s.denomination, (sums.get(s.denomination) ?? 0) + s.notes);
  }
  return ATM_EGP_DENOMINATIONS.filter((d) => sums.has(d)).map((d) => ({
    denomination: d,
    notes: sums.get(d) ?? 0,
  }));
};

/**
 * «بيان التغذية»'s six rows, 200…5, summed over the given lines' planned slots — the 20/10/5 rows
 * included (the accepted fix of the Al Baraka sheet's broken rows). Callers pass issued + prepared.
 */
export const receiptRows = (
  lines: readonly { slots: readonly AtmPlanSlot[] }[],
): AtmDenominationNotes[] => {
  const sums = new Map<number, number>(ATM_EGP_DENOMINATIONS.map((d) => [d, 0]));
  for (const line of lines) {
    for (const row of byDenomination(line.slots)) {
      sums.set(row.denomination, (sums.get(row.denomination) ?? 0) + row.notes);
    }
  }
  return ATM_EGP_DENOMINATIONS.map((d) => ({ denomination: d, notes: sums.get(d) ?? 0 }));
};

/** The accepted improvement: distinct machines of the machine lines, plus one per spare line. */
export const receiptMachineCount = (
  lines: readonly { kind: AtmPlanLineKind; machineId: string | null }[],
): number => {
  const machines = new Set<string>();
  let spares = 0;
  for (const line of lines) {
    if (line.kind === 'spare') spares += 1;
    else if (line.machineId !== null) machines.add(line.machineId);
  }
  return machines.size + spares;
};

/** REP. TAPE's `Comments` column: '21:00' → 'Repl @9:00 PM'; null → ''. */
export const repTapeComment = (time: string | null): string => {
  if (time === null || !ATM_SCHEDULE_TIME.test(time)) return '';
  const [hh = '0', mm = '00'] = time.split(':');
  const hour = Number(hh);
  return `Repl @${String(hour % 12 === 0 ? 12 : hour % 12)}:${mm} ${hour < 12 ? 'AM' : 'PM'}`;
};

/**
 * §8.5, the REP. TAPE / ATM_2 cassette pairs: physical slots 1..n as `{ notes, denomination }`. A
 * trailing run of slots that are not planned is blank (null — today a 3-cassette machine is blank
 * in cassette 4); a slot that is not planned before a planned one is 0 / 0 (today the reversed
 * machine's empty slot 1).
 */
export const repTapeSlots = (
  slots: readonly AtmPlanSlot[],
): ({ notes: number; denomination: number } | null)[] => {
  const ordered = [...slots].sort((a, b) => a.slot - b.slot);
  let lastPlanned = -1;
  ordered.forEach((s, i) => {
    if (isPlanned(s)) lastPlanned = i;
  });
  return ordered.map((s, i) => {
    if (i > lastPlanned) return null;
    return isPlanned(s)
      ? { notes: s.notes, denomination: s.denomination ?? 0 }
      : { notes: 0, denomination: 0 };
  });
};

/** REP. TAPE column P, the bank as today's sheet writes it (§8.5). */
export const ATM_REP_TAPE_BANK_LABELS: Readonly<Partial<Record<AtmBankCode, string>>> = {
  BRK: 'AlBarka',
};

// ── §3.7 Line issues ────────────────────────────────────────────────────────────────────────────

export const ATM_PLAN_LINE_ERROR_CODES = [
  'MACHINE_NOT_PLANNABLE',
  'NO_LAYOUT',
  'NO_FILLABLE_SLOT',
  'EMPTY_LINE',
  'DUPLICATE_IN_RUN',
  'SPARE_TYPE_REQUIRED',
  'LAYOUT_INVALID',
] as const;
export const ATM_PLAN_LINE_WARNING_CODES = [
  'NOT_MULTIPLE_OF_100',
  'LAYOUT_CHANGED',
  'LAYOUT_CHANGED_AFTER_ISSUE',
  'NO_TIME',
  'STANDARD_DENOMINATION_UNPLACED',
  'DIFFERS_FROM_STANDARD',
  'RUN_TIME_ORDER',
  'FOREIGN_CURRENCY_NOT_PLANNED',
  'PAST_DATE',
] as const;
export type AtmPlanLineErrorCode = (typeof ATM_PLAN_LINE_ERROR_CODES)[number];
export type AtmPlanLineWarningCode = (typeof ATM_PLAN_LINE_WARNING_CODES)[number];
export type AtmPlanLineIssueCode = AtmPlanLineErrorCode | AtmPlanLineWarningCode;

export interface AtmPlanLineIssue {
  code: AtmPlanLineIssueCode;
  severity: 'error' | 'warning';
  slot?: number;
}

/** The fields of a line the issue rules read. */
export interface AtmPlanLineIssueInput {
  kind: AtmPlanLineKind;
  machineId: string | null;
  run: number;
  scheduleTime: string | null;
  status: AtmPlanLineStatus;
  slots: readonly AtmPlanSlot[];
  typeLabel: string | null;
  layoutRevision: number | null;
  standardNotes: readonly AtmDenominationNotes[] | null;
}

export interface AtmPlanLineIssueContext {
  /** The plan's OTHER lines (cancelled ones are ignored). */
  otherLines: readonly Pick<
    AtmPlanLineIssueInput,
    'kind' | 'machineId' | 'run' | 'scheduleTime' | 'status'
  >[];
  /** Machine lines: the machine's current layout, or null when it has none. */
  layout: { revision: number } | null;
  /**
   * Machine lines: the machine is live and active and its register bank (DS-3) is still the
   * plan's. Ignored for a spare line.
   */
  machinePlannable: boolean;
  replenishDate: string;
  /** 'YYYY-MM-DD', the Cairo calendar day. */
  today: string;
}

/**
 * §3.7: a line's errors (they block issue) then its warnings (shown and confirmed, never blocking),
 * each in the spec's table order.
 */
export const planLineIssues = (
  line: AtmPlanLineIssueInput,
  ctx: AtmPlanLineIssueContext,
): AtmPlanLineIssue[] => {
  const errors: AtmPlanLineIssue[] = [];
  const warnings: AtmPlanLineIssue[] = [];
  const error = (code: AtmPlanLineErrorCode): void => {
    errors.push({ code, severity: 'error' });
  };
  const warning = (code: AtmPlanLineWarningCode, slot?: number): void => {
    warnings.push(
      slot === undefined ? { code, severity: 'warning' } : { code, severity: 'warning', slot },
    );
  };
  const isMachine = line.kind === 'machine';
  const planned = line.slots.filter(isPlanned);
  const others = ctx.otherLines.filter((o) => LIVE_STATUS_SET.has(o.status));
  const sameMachine = isMachine
    ? others.filter((o) => o.kind === 'machine' && o.machineId === line.machineId)
    : [];

  if (isMachine && !ctx.machinePlannable) error('MACHINE_NOT_PLANNABLE');
  if (isMachine && ctx.layout === null) error('NO_LAYOUT');
  if (planned.length === 0) error('NO_FILLABLE_SLOT');
  if (planned.length > 0 && planned.every((s) => s.notes === 0)) error('EMPTY_LINE');
  if (sameMachine.some((o) => o.run === line.run)) error('DUPLICATE_IN_RUN');
  if (!isMachine && (line.typeLabel === null || line.typeLabel === '')) {
    error('SPARE_TYPE_REQUIRED');
  }
  if (layoutIssues(line.slots, { spare: !isMachine }).length > 0) error('LAYOUT_INVALID');

  for (const s of line.slots) {
    if (s.notes % ATM_NOTES_ROUNDING !== 0) warning('NOT_MULTIPLE_OF_100', s.slot);
  }
  const revisionMoved =
    isMachine && ctx.layout !== null && line.layoutRevision !== ctx.layout.revision;
  if (revisionMoved && line.status === 'draft') warning('LAYOUT_CHANGED');
  if (
    revisionMoved &&
    (line.status === 'issued' || line.status === 'prepared') &&
    ctx.replenishDate >= ctx.today
  ) {
    warning('LAYOUT_CHANGED_AFTER_ISSUE');
  }
  if (line.scheduleTime === null) warning('NO_TIME');
  if (line.standardNotes !== null) {
    const placed = new Set(planned.map((s) => s.denomination));
    if (line.standardNotes.some((n) => !placed.has(n.denomination))) {
      warning('STANDARD_DENOMINATION_UNPLACED');
    }
    if (line.status === 'draft') {
      const standard = new Map(line.standardNotes.map((n) => [n.denomination, n.notes]));
      const differs = byDenomination(line.slots).some(
        (row) => row.notes !== (standard.get(row.denomination) ?? 0),
      );
      if (differs) warning('DIFFERS_FROM_STANDARD');
    }
  }
  if (line.scheduleTime !== null && line.run > 1) {
    const previous = sameMachine.find((o) => o.run === line.run - 1);
    if (
      previous !== undefined &&
      previous.scheduleTime !== null &&
      line.scheduleTime <= previous.scheduleTime
    ) {
      warning('RUN_TIME_ORDER');
    }
  }
  if (line.slots.some((s) => isFillable(s) && s.currency !== null && s.currency !== 'EGP')) {
    warning('FOREIGN_CURRENCY_NOT_PLANNED');
  }
  if (ctx.replenishDate < ctx.today) warning('PAST_DATE');
  return [...errors, ...warnings];
};

// ── §5.3 The Full list import: outcomes and flags ───────────────────────────────────────────────

export const ATM_LAYOUT_IMPORT_OUTCOMES = [
  'invalid',
  'duplicateInFile',
  'notFound',
  'archived',
  'noRegisterBank',
  'otherBank',
  'new',
  'same',
  'changed',
  'changedManual',
] as const;
export type AtmLayoutImportOutcome = (typeof ATM_LAYOUT_IMPORT_OUTCOMES)[number];

export const ATM_LAYOUT_IMPORT_FLAGS = [
  'reversedOrder',
  'typeMentionsRecycle',
  'helpDisagrees',
  'helpOrderOpposite',
  'areaDiffers',
  'nameDiffers',
  'repTapeDiffers',
  'registerCountDiffers',
  'registerDenominationsDiffer',
  'idFormat',
  'codeWhitespace',
  'labelTooLong',
] as const;
export type AtmLayoutImportFlag = (typeof ATM_LAYOUT_IMPORT_FLAGS)[number];

export const ATM_LAYOUT_IMPORT_MODES = ['newOnly', 'newAndChanged', 'overwriteManual'] as const;
export type AtmLayoutImportMode = (typeof ATM_LAYOUT_IMPORT_MODES)[number];

export const ATM_STANDARD_LOAD_IMPORT_OUTCOMES = ['new', 'same', 'mismatch', 'invalid'] as const;
export type AtmStandardLoadImportOutcome = (typeof ATM_STANDARD_LOAD_IMPORT_OUTCOMES)[number];

export const ATM_LAYOUT_SOURCES = ['import', 'manual'] as const;
export type AtmLayoutSource = (typeof ATM_LAYOUT_SOURCES)[number];

/** Most `previewRevisions` entries one apply carries (§6.1). */
export const ATM_LAYOUT_IMPORT_PREVIEW_ROWS_MAX = 2_000;

// ── §6.1 Input schemas ──────────────────────────────────────────────────────────────────────────

/** Every free-text field refuses control characters after trimming (SEC-14). */
const NoControl = /^[^\p{Cc}]*$/u;
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Text = (max: number) => z.string().trim().max(max).regex(NoControl);
/** Normalised per row by `normalizeScheduleTime` (§3.6). */
const RawTimeSchema = z.string().max(20).nullable();
const TimeSchema = z.string().regex(ATM_SCHEDULE_TIME).nullable();
const VersionSchema = z.number().int().min(0);
const EgpDenominationSchema = z.union([
  z.literal(200),
  z.literal(100),
  z.literal(50),
  z.literal(20),
  z.literal(10),
  z.literal(5),
]);
const RunSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const SlotSchema = z
  .object({
    slot: z.number().int().min(1).max(ATM_LAYOUT_SLOTS_MAX),
    kind: AtmSlotKindSchema,
    denomination: z.number().int().positive().max(1000).nullable(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((c) => c.toUpperCase())
      .nullable(),
  })
  .strict();

/** One issue per repeat of `key`, at `[i, key]`, code `DUPLICATE`. */
const uniqueBy =
  <K extends string>(key: K) =>
  (items: readonly Record<K, unknown>[], ctx: z.RefinementCtx): void => {
    const seen = new Set<unknown>();
    items.forEach((item, i) => {
      if (seen.has(item[key])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, key],
          message: 'DUPLICATE',
          params: { code: 'DUPLICATE' },
        });
      }
      seen.add(item[key]);
    });
  };

const reportLayoutIssues = (
  slots: readonly AtmCassetteSlot[],
  spare: boolean,
  ctx: z.RefinementCtx,
): void => {
  for (const issue of layoutIssues(slots, { spare })) {
    const index = issue.slot === null ? -1 : slots.findIndex((s) => s.slot === issue.slot);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: index === -1 ? ['slots'] : ['slots', index],
      message: issue.code,
      params: { code: issue.code },
    });
  }
};

const PreviewRevisionsSchema = z
  .array(z.object({ machineId: objectId(), revision: z.number().int().min(1).nullable() }).strict())
  .max(ATM_LAYOUT_IMPORT_PREVIEW_ROWS_MAX);
export type AtmLayoutImportPreviewRevision = z.infer<typeof PreviewRevisionsSchema>[number];

const parsePreviewRevisions = (raw: string): AtmLayoutImportPreviewRevision[] | null => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = PreviewRevisionsSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
};

/**
 * S4's multipart fields — all strings, parsed by the controller after multer (§6.3). The defaults
 * are the harmless ones: `apply` and `standardLoads` only when exactly `'true'`, and no default
 * `mode`. An apply needs `mode`, `fileSha256` and `previewRevisions`; the latter arrives as JSON
 * and leaves as the parsed list.
 */
export const LayoutImportFieldsSchema = z
  .object({
    bankCode: AtmBankCodeSchema,
    branchId: objectId(),
    apply: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    mode: z.enum(ATM_LAYOUT_IMPORT_MODES).optional(),
    standardLoads: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    fileSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    previewRevisions: z.string().max(200_000).optional(),
  })
  .strict()
  .superRefine((fields, ctx) => {
    if (!fields.apply) return;
    const required = (path: string): void => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message: 'REQUIRED',
        params: { code: 'REQUIRED' },
      });
    };
    if (fields.mode === undefined) required('mode');
    if (fields.fileSha256 === undefined) required('fileSha256');
    if (fields.previewRevisions === undefined) required('previewRevisions');
    else if (parsePreviewRevisions(fields.previewRevisions) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previewRevisions'],
        message: 'INVALID',
        params: { code: 'INVALID' },
      });
    }
  })
  .transform(({ previewRevisions, ...fields }) => ({
    ...fields,
    previewRevisions:
      previewRevisions === undefined ? undefined : (parsePreviewRevisions(previewRevisions) ?? []),
  }));
export type LayoutImportFields = z.infer<typeof LayoutImportFieldsSchema>;

export const SaveAtmCassetteLayoutSchema = z
  .object({
    version: VersionSchema.nullable(),
    slots: z.array(SlotSchema).min(ATM_LAYOUT_SLOTS_MIN).max(ATM_LAYOUT_SLOTS_MAX),
    typeLabel: Text(ATM_LABEL_MAX.typeLabel).nullable(),
    featuresLabel: Text(ATM_LABEL_MAX.featuresLabel).nullable(),
    hubLabel: Text(ATM_LABEL_MAX.hubLabel).nullable(),
    standardLoadId: objectId().nullable(),
    reason: Text(300).nullable(),
  })
  .strict()
  .superRefine((save, ctx) => {
    reportLayoutIssues(save.slots, false, ctx);
  });
export type SaveAtmCassetteLayout = z.infer<typeof SaveAtmCassetteLayoutSchema>;

const StandardNotesSchema = z
  .array(
    z
      .object({
        denomination: EgpDenominationSchema,
        notes: z.number().int().min(0).max(ATM_CASSETTE_NOTES_MAX),
      })
      .strict(),
  )
  .min(1)
  .max(ATM_EGP_DENOMINATIONS.length)
  .superRefine(uniqueBy('denomination'));

export const SaveAtmStandardLoadSchema = z
  .object({
    version: VersionSchema.optional(),
    /** An equality check only (DS-22): the server resolves the branch. */
    branchId: objectId(),
    bankCode: AtmBankCodeSchema,
    label: Text(40).nullable(),
    isDefault: z.boolean(),
    notes: StandardNotesSchema,
  })
  .strict();
export type SaveAtmStandardLoad = z.infer<typeof SaveAtmStandardLoadSchema>;

export const CreateAtmPlanSchema = z
  .object({
    bankCode: AtmBankCodeSchema,
    replenishDate: DateSchema,
    /** A consistency check only (DS-22). */
    branchId: objectId(),
  })
  .strict();
export type CreateAtmPlan = z.infer<typeof CreateAtmPlanSchema>;

const SlotNotesSchema = z
  .object({
    slot: z.number().int().min(1).max(ATM_LAYOUT_SLOTS_MAX),
    notes: z.number().int().min(0).max(ATM_CASSETTE_NOTES_MAX),
  })
  .strict();
const DenominationNotesSchema = z
  .object({
    denomination: EgpDenominationSchema,
    notes: z
      .number()
      .int()
      .min(0)
      .max(ATM_LAYOUT_SLOTS_MAX * ATM_CASSETTE_NOTES_MAX),
  })
  .strict();
const DenominationNotesListSchema = z
  .array(DenominationNotesSchema)
  .max(ATM_EGP_DENOMINATIONS.length)
  .superRefine(uniqueBy('denomination'));
const SlotNotesListSchema = z
  .array(SlotNotesSchema)
  .max(ATM_LAYOUT_SLOTS_MAX)
  .superRefine(uniqueBy('slot'));

export const AddAtmPlanLinesSchema = z
  .object({
    run: RunSchema,
    rows: z
      .array(
        z
          .object({
            machineCode: z.string().trim().min(1).max(40),
            scheduleTime: RawTimeSchema,
          })
          .strict(),
      )
      .min(1)
      .max(ATM_BULK_MAX_IDS),
  })
  .strict();
export type AddAtmPlanLines = z.infer<typeof AddAtmPlanLinesSchema>;

export const AddAtmSpareLineSchema = z
  .object({
    run: RunSchema,
    scheduleTime: TimeSchema,
    spareCode: Text(20).nullable(),
    typeLabel: Text(ATM_LABEL_MAX.typeLabel).pipe(z.string().min(1)),
    slots: z.array(SlotSchema).min(ATM_SPARE_SLOTS_MIN).max(ATM_LAYOUT_SLOTS_MAX),
    standardLoadId: objectId().nullable(),
    denominationNotes: DenominationNotesListSchema.optional(),
    notes: SlotNotesListSchema.optional(),
  })
  .strict();
export type AddAtmSpareLine = z.infer<typeof AddAtmSpareLineSchema>;

export const UpdateAtmPlanLineSchema = z
  .object({
    version: VersionSchema,
    run: RunSchema.optional(),
    scheduleTime: TimeSchema.optional(),
    refreshLayout: z.literal(true).optional(),
    standardLoadId: objectId().nullable().optional(),
    denominationNotes: DenominationNotesListSchema.optional(),
    notes: SlotNotesListSchema.optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.run !== undefined ||
      patch.scheduleTime !== undefined ||
      patch.refreshLayout !== undefined ||
      patch.standardLoadId !== undefined ||
      patch.denominationNotes !== undefined ||
      patch.notes !== undefined,
    { message: 'NO_CHANGE', params: { code: 'NO_CHANGE' } },
  );
export type UpdateAtmPlanLine = z.infer<typeof UpdateAtmPlanLineSchema>;

export const IssueAtmPlanSchema = z
  .object({
    lines: z
      .array(z.object({ id: objectId(), version: VersionSchema }).strict())
      .min(1)
      .max(ATM_PLAN_LINES_MAX),
  })
  .strict();
export type IssueAtmPlan = z.infer<typeof IssueAtmPlanSchema>;

export const AtmLineReasonSchema = z
  .object({ version: VersionSchema, reason: Text(300).pipe(z.string().min(1)) })
  .strict();
export type AtmLineReason = z.infer<typeof AtmLineReasonSchema>;

export const AtmSpareUseSchema = z
  .object({ version: VersionSchema, machineCode: z.string().trim().min(1).max(40) })
  .strict();
export type AtmSpareUse = z.infer<typeof AtmSpareUseSchema>;

export const ATM_SETTLEMENT_PRINT_KINDS = ['notes', 'receipt', 'handover', 'repTape'] as const;
export type AtmSettlementPrintKind = (typeof ATM_SETTLEMENT_PRINT_KINDS)[number];

export const AtmSettlementPrintSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('notes'),
      lineIds: z.array(objectId()).max(ATM_PLAN_LINES_MAX).optional(),
      unprintedOnly: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('receipt') }).strict(),
  z.object({ kind: z.literal('handover') }).strict(),
  z.object({ kind: z.literal('repTape') }).strict(),
]);
export type AtmSettlementPrint = z.infer<typeof AtmSettlementPrintSchema>;

/**
 * Raw strings: the service cleans them (§3.5), then applies `AtmBagQrSchema` /
 * `AtmSealValueSchema` and answers `INVALID_SEAL` per field.
 */
export const SaveAtmPreparationSchema = z
  .object({
    version: VersionSchema,
    bags: z
      .array(
        z
          .object({
            bag: z.union([z.literal(1), z.literal(2)]),
            qr: z.string().max(400).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    seals: z
      .array(
        z
          .object({
            slot: z.number().int().min(1).max(ATM_LAYOUT_SLOTS_MAX),
            value: z.string().max(400).nullable(),
          })
          .strict(),
      )
      .max(ATM_LAYOUT_SLOTS_MAX),
  })
  .strict();
export type SaveAtmPreparation = z.infer<typeof SaveAtmPreparationSchema>;

export const AtmVersionSchema = z.object({ version: VersionSchema }).strict();
export type AtmVersion = z.infer<typeof AtmVersionSchema>;

export const ATM_ROUTES_PER_DAY_MAX = 100;
export const ATM_ROUTE_MOVES_MAX = 400;

export const CreateAtmRouteSchema = z
  .object({
    branchId: objectId(),
    replenishDate: DateSchema,
    name: Text(60).pipe(z.string().min(1)),
    leaderName: Text(80).nullable(),
  })
  .strict();
export type CreateAtmRoute = z.infer<typeof CreateAtmRouteSchema>;

export const UpdateAtmRouteSchema = z
  .object({
    version: VersionSchema,
    name: Text(60).pipe(z.string().min(1)).optional(),
    leaderName: Text(80).nullable().optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();
export type UpdateAtmRoute = z.infer<typeof UpdateAtmRouteSchema>;

export const AssignAtmRoutesSchema = z
  .object({
    branchId: objectId(),
    replenishDate: DateSchema,
    moves: z
      .array(
        z
          .object({ lineId: objectId(), from: objectId().nullable(), to: objectId().nullable() })
          .strict(),
      )
      .min(1)
      .max(ATM_ROUTE_MOVES_MAX)
      .superRefine(uniqueBy('lineId')),
  })
  .strict();
export type AssignAtmRoutes = z.infer<typeof AssignAtmRoutesSchema>;

export const AtmRoutesFromZonesSchema = z
  .object({ branchId: objectId(), replenishDate: DateSchema })
  .strict();
export type AtmRoutesFromZones = z.infer<typeof AtmRoutesFromZonesSchema>;

export const AtmControlPrintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('handover'), planId: objectId() }).strict(),
  z
    .object({
      kind: z.literal('routes'),
      branchId: objectId(),
      replenishDate: DateSchema,
      routeIds: z.array(objectId()).min(1).max(ATM_ROUTES_PER_DAY_MAX).optional(),
    })
    .strict(),
]);
export type AtmControlPrint = z.infer<typeof AtmControlPrintSchema>;

// ── §6.3 Query schemas ──────────────────────────────────────────────────────────────────────────

export const ATM_SETTLEMENT_PAGES = ['plans', 'layouts', 'import'] as const;
export type AtmSettlementPage = (typeof ATM_SETTLEMENT_PAGES)[number];

/** S1 `GET /context?page=`. */
export const AtmSettlementContextQuerySchema = z
  .object({ page: z.enum(ATM_SETTLEMENT_PAGES) })
  .strict();
export type AtmSettlementContextQuery = z.infer<typeof AtmSettlementContextQuerySchema>;

/** S2, S3, S7: `{ bankCode, branchId? }`. */
export const AtmSettlementBankQuerySchema = z
  .object({ bankCode: AtmBankCodeSchema, branchId: objectId().optional() })
  .strict();
export type AtmSettlementBankQuery = z.infer<typeof AtmSettlementBankQuerySchema>;

/** S11: `{ bankCode, date, branchId? }`. */
export const AtmSettlementPlanQuerySchema = z
  .object({ bankCode: AtmBankCodeSchema, date: DateSchema, branchId: objectId().optional() })
  .strict();
export type AtmSettlementPlanQuery = z.infer<typeof AtmSettlementPlanQuerySchema>;

/** P1, C1: `{ date?, branchId? }` — without a date the server suggests one (DS-25). */
export const AtmSettlementDayQuerySchema = z
  .object({ date: DateSchema.optional(), branchId: objectId().optional() })
  .strict();
export type AtmSettlementDayQuery = z.infer<typeof AtmSettlementDayQuerySchema>;

/** S10, S17, C5: `?version=`. */
export const AtmVersionQuerySchema = z.object({ version: z.coerce.number().int().min(0) }).strict();
export type AtmVersionQuery = z.infer<typeof AtmVersionQuerySchema>;

// ── §6.1 DTOs (JSON-safe; money in EGP minor units; dates as ISO strings) ───────────────────────

export interface AtmSettlementContextDto {
  page: AtmSettlementPage;
  banks: AtmBankCode[];
  branch: { id: string; name: LocalizedString } | null;
  blocked: 'chooseBranch' | 'noBranch' | null;
  /** Every can.X = branch !== null && keyReachesBranch(ctx, X's key, branch.id). */
  can: {
    viewLayouts: boolean;
    manageLayouts: boolean;
    importLayouts: boolean;
    viewPlans: boolean;
    managePlans: boolean;
    printPlans: boolean;
    exportPlans: boolean;
  };
}

export interface AtmCassetteLayoutStateDto {
  version: number;
  revision: number;
  slots: AtmCassetteSlot[];
  typeLabel: string | null;
  featuresLabel: string | null;
  hubLabel: string | null;
  standardLoadId: string | null;
  source: AtmLayoutSource;
  changedByName: string | null;
  changedAt: string;
}

export const ATM_LAYOUT_ROW_FLAGS = [
  'noLayout',
  'noFillableSlot',
  'standardLoadOtherBank',
] as const;
export type AtmLayoutRowFlag = (typeof ATM_LAYOUT_ROW_FLAGS)[number];

export interface AtmCassetteLayoutRowDto {
  machineId: string;
  machineCode: string;
  machineName: string;
  area: string;
  active: boolean;
  layout: AtmCassetteLayoutStateDto | null;
  flags: AtmLayoutRowFlag[];
}

export interface AtmLayoutImportRunSummaryDto {
  at: string;
  actorName: string | null;
  state: 'running' | 'done' | 'failed' | 'abandoned';
  counts: Record<string, number>;
}

export interface AtmCassetteLayoutsDto {
  bankCode: AtmBankCode;
  branchId: string;
  rows: AtmCassetteLayoutRowDto[];
  figures: { machines: number; withLayout: number; withoutLayout: number };
  lastImport: AtmLayoutImportRunSummaryDto | null;
  can: { manage: boolean; import: boolean };
}

export interface AtmCassetteLayoutVersionDto {
  revision: number;
  slots: AtmCassetteSlot[];
  typeLabel: string | null;
  featuresLabel: string | null;
  hubLabel: string | null;
  standardLoadId: string | null;
  source: AtmLayoutSource;
  reason: string | null;
  changedByName: string | null;
  changedAt: string;
}

export type AtmCassetteLayoutDetailDto = AtmCassetteLayoutRowDto & {
  /** Newest first. */
  versions: AtmCassetteLayoutVersionDto[];
  /** The machine's live lines dated today (Cairo) or later, for the save dialog (GS-26). */
  affectedLines: {
    planId: string;
    replenishDate: string;
    lineId: string;
    serial: number | null;
    status: AtmPlanLineStatus;
    run: AtmPlanRun;
  }[];
};

export interface AtmStandardLoadDto {
  id: string;
  version: number;
  branchId: string;
  bankCode: AtmBankCode;
  label: string | null;
  isDefault: boolean;
  order: number;
  notes: AtmDenominationNotes[];
  egpTotalMinor: number;
}

export interface AtmLabelChangeDto {
  before: string | null;
  after: string | null;
}

export interface AtmLayoutImportRowDto {
  /** The Excel row number. */
  row: number;
  /** The normalised code; null when the cell is blank or not a code. */
  code: string | null;
  outcome: AtmLayoutImportOutcome;
  flags: AtmLayoutImportFlag[];
  machineId: string | null;
  machineName: string | null;
  /** `noRegisterBank` only: the machine's Operations bank label. */
  bankName: string | null;
  /** The current layout's revision; null without a layout. */
  revision: number | null;
  before: AtmCassetteSlot[] | null;
  after: AtmCassetteSlot[] | null;
  typeLabel: AtmLabelChangeDto;
  featuresLabel: AtmLabelChangeDto;
  hubLabel: AtmLabelChangeDto;
}

export interface AtmLayoutImportResultDto {
  applied: boolean;
  fileName: string;
  fileSha256: string;
  bankCode: AtmBankCode;
  branchId: string;
  counts: Record<AtmLayoutImportOutcome, number>;
  flags: Record<AtmLayoutImportFlag, number>;
  rows: AtmLayoutImportRowDto[];
  missingFromFile: { machineId: string; machineCode: string; machineName: string }[];
  standardLoads: {
    row: 1 | 2;
    notes: AtmDenominationNotes[];
    outcome: AtmStandardLoadImportOutcome;
  }[];
  applyCounts: {
    created: number;
    updated: number;
    standardLoadsCreated: number;
    conflicts: number;
  } | null;
}

export interface AtmVoidedSerialDto {
  serial: number;
  printCount: number;
  at: string;
  byName: string | null;
  reason: string;
}

export const ATM_PREPARATION_STATUSES = ['none', 'partial', 'complete', 'prepared'] as const;
export type AtmPreparationStatus = (typeof ATM_PREPARATION_STATUSES)[number];

export interface AtmPlanLineDto {
  id: string;
  version: number;
  kind: AtmPlanLineKind;
  machineId: string | null;
  machineCode: string | null;
  machineName: string | null;
  area: string | null;
  typeLabel: string | null;
  featuresLabel: string | null;
  hubLabel: string | null;
  layoutRevision: number | null;
  spareCode: string | null;
  spareUse: {
    machineCode: string;
    machineName: string;
    at: string;
    byName: string | null;
  } | null;
  run: AtmPlanRun;
  scheduleTime: string | null;
  position: number;
  status: AtmPlanLineStatus;
  serial: number | null;
  voidedSerials: AtmVoidedSerialDto[];
  slots: AtmPlanSlot[];
  countsSource: 'standard' | 'manual';
  standardLoadId: string | null;
  standardNotes: AtmDenominationNotes[] | null;
  egpTotalMinor: number;
  /** Null for a draft. */
  preparationStatus: AtmPreparationStatus | null;
  notePrintCount: number;
  notePrintedAt: string | null;
  issues: AtmPlanLineIssue[];
}

export interface AtmReceiptFiguresDto {
  rows: AtmDenominationNotes[];
  egpTotalMinor: number;
  machineCount: number;
}

export interface AtmSettlementPlanDto {
  id: string;
  version: number;
  branchId: string;
  bankCode: AtmBankCode;
  replenishDate: string;
  lines: AtmPlanLineDto[];
  summary: {
    /** Non-cancelled lines. */
    lines: number;
    /** Distinct machineId, non-cancelled. */
    machines: number;
    spares: number;
    /** Non-cancelled; a draft counts `bagAllocation(slots).length`. */
    bags: number;
    byStatus: Record<AtmPlanLineStatus, number>;
    /** Issued + prepared with `notePrintCount` 0. */
    notPrinted: number;
    /** Issued + prepared. */
    receipt: AtmReceiptFiguresDto;
    /** Every non-cancelled line, drafts too. */
    all: AtmReceiptFiguresDto;
    receiptPrint: { at: string; byName: string | null } | null;
    receiptStale: boolean;
    handoverPrint: { at: string; byName: string | null } | null;
    handoverStale: boolean;
  };
  can: { manage: boolean; print: boolean; export: boolean };
}

export const ATM_PLAN_ADD_REFUSALS = [
  'unknownCode',
  'inactive',
  'noRegisterBank',
  'otherBank',
  'noLayout',
  'noFillableSlot',
  'duplicateInRun',
  'duplicateInRequest',
  'badTime',
] as const;
export type AtmPlanAddRefusal = (typeof ATM_PLAN_ADD_REFUSALS)[number];

export interface AtmPlanAddResultDto {
  added: AtmPlanLineDto[];
  refused: { code: string; reason: AtmPlanAddRefusal }[];
}

export interface AtmSealDuplicateDto {
  field: 'bag' | 'seal';
  bag?: 1 | 2;
  slot?: number;
  /** At most 5, newest first. */
  matches: (
    | { sameLine: true; otherField: { field: 'bag' | 'seal'; bag?: 1 | 2; slot?: number } }
    | {
        replenishDate: string;
        bankCode: AtmBankCode;
        serial: number | null;
        machineCode: string | null;
        spareCode: string | null;
        lineStatus: AtmPlanLineStatus;
        matchedField: 'bag' | 'seal';
      }
    | { outsideReach: true }
  )[];
  /** A QR matched a seal, or a seal a QR. */
  crossKind: boolean;
}

export interface AtmPreparationLineDto {
  lineId: string;
  planId: string;
  serial: number | null;
  voidedSerials: number[];
  lineStatus: AtmPlanLineStatus;
  kind: AtmPlanLineKind;
  machineCode: string | null;
  machineName: string | null;
  area: string | null;
  hubLabel: string | null;
  typeLabel: string | null;
  spareCode: string | null;
  run: AtmPlanRun;
  scheduleTime: string | null;
  egpTotalMinor: number;
  slots: AtmPlanSlot[];
  preparation: {
    id: string;
    version: number;
    status: 'open' | 'prepared';
    bags: { bag: 1 | 2; slots: number[]; qr: string | null; required: boolean }[];
    seals: { slot: number; value: string | null; required: boolean }[];
    lastCapturedByName: string | null;
    lastCapturedAt: string | null;
    preparedByName: string | null;
    preparedAt: string | null;
  };
  progress: { captured: number; required: number };
  warnings: {
    field: 'bag' | 'seal';
    bag?: 1 | 2;
    slot?: number;
    code: AtmScannedValueWarning;
  }[];
  duplicates: AtmSealDuplicateDto[];
}

export interface AtmPreparationContextDto {
  branch: { id: string; name: LocalizedString } | null;
  /** The requested or suggested day (DS-25). */
  date: string;
  canCapture: boolean;
  plans: {
    planId: string;
    bankCode: AtmBankCode;
    lines: number;
    prepared: number;
    complete: number;
    partial: number;
    none: number;
  }[];
}

export interface AtmControlRouteDto {
  id: string;
  version: number;
  name: string;
  leaderName: string | null;
  order: number;
  zoneId: string | null;
  lines: number;
  machines: number;
  bags: number;
  notPrepared: number;
}

export interface AtmControlDayDto {
  branch: { id: string; name: LocalizedString } | null;
  date: string;
  can: { manage: boolean; print: boolean; zones: boolean };
  plans: { planId: string; bankCode: AtmBankCode; lines: number; prepared: number }[];
  lines: {
    lineId: string;
    planId: string;
    bankCode: AtmBankCode;
    serial: number | null;
    lineStatus: AtmPlanLineStatus;
    kind: AtmPlanLineKind;
    machineCode: string | null;
    machineName: string | null;
    area: string | null;
    hubLabel: string | null;
    /** Only when can.zones. */
    zoneName: string | null;
    typeLabel: string | null;
    spareCode: string | null;
    run: AtmPlanRun;
    scheduleTime: string | null;
    egpTotalMinor: number;
    bags: { bag: 1 | 2; slots: number[]; qr: string | null }[];
    seals: { slot: number; denomination: number | null; notes: number; value: string | null }[];
    progress: { captured: number; required: number };
    preparationStatus: AtmPreparationStatus;
    routeId: string | null;
    duplicates: AtmSealDuplicateDto[];
  }[];
  routes: AtmControlRouteDto[];
  unassigned: number;
}

export interface AtmRoutesFromZonesResultDto {
  routesCreated: number;
  assigned: number;
  unlocated: number;
  outsideZones: number;
}

export interface AtmNotePrintDto {
  branchName: LocalizedString;
  bankCode: AtmBankCode;
  bankNameAr: string;
  replenishDate: string;
  printedAt: string;
  notes: {
    lineId: string;
    version: number;
    serial: number;
    kind: AtmPlanLineKind;
    machineCode: string | null;
    machineName: string | null;
    hubLabel: string | null;
    typeLabel: string | null;
    featuresLabel: string | null;
    spareCode: string | null;
    run: AtmPlanRun;
    scheduleTime: string | null;
    /** Planned only. */
    slots: AtmPlanSlot[];
    bagCount: number;
    egpTotalMinor: number;
  }[];
}

export interface AtmReceiptPrintDto {
  bankCode: AtmBankCode;
  bankNameAr: string;
  replenishDate: string;
  printedAt: string;
  rows: AtmDenominationNotes[];
  egpTotalMinor: number;
  machineCount: number;
  serials: number[];
  excludedDraftLines: number;
  previous: { at: string; byName: string | null; serials: number[] } | null;
}

export interface AtmHandoverPrintRowDto {
  serial: number;
  bankCode: AtmBankCode;
  machineCode: string | null;
  machineName: string | null;
  spareCode: string | null;
  run: AtmPlanRun;
  scheduleTime: string | null;
  egpTotalMinor: number;
  /** [] when !withQr, or when the line is not prepared. */
  qrs: (string | null)[];
  typeLabel: string | null;
  hubLabel: string | null;
  prepared: boolean;
}

export interface AtmHandoverPrintDto {
  bankCode: AtmBankCode;
  replenishDate: string;
  withQr: boolean;
  printedAt: string;
  rows: AtmHandoverPrintRowDto[];
  notPrepared: number;
}

export interface AtmRoutesPrintDto {
  replenishDate: string;
  printedAt: string;
  unassigned: number;
  routes: {
    id: string;
    name: string;
    leaderName: string | null;
    rows: AtmHandoverPrintRowDto[];
    machines: number;
    bags: number;
    notPrepared: number;
  }[];
}

export interface AtmRepTapeExportDto {
  bankCode: AtmBankCode;
  replenishDate: string;
  rows: {
    serial: number;
    reference: string | null;
    location: string | null;
    /** Physical slots 1..n; null = blank (§8.5, `repTapeSlots`). */
    slots: ({ notes: number; denomination: number } | null)[];
    byDenomination: AtmDenominationNotes[];
    egpTotalMinor: number;
    comment: string;
    dep: string | null;
    typeLabel: string | null;
    hubLabel: string | null;
  }[];
}
