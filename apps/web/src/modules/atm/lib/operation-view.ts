// Pure view logic for the operation grids — the two-group split and the live timer, ported from
// the legacy templates and kept out of the components so the behaviour is testable.
import { ATM_TIMER_THRESHOLD_HOURS, ErrorCodes, type Locale } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { type TableSelection } from '../../../shared/ui/useTableSelection';
import { listSeparator } from './register-import-view';

const CAIRO_TZ = 'Africa/Cairo';

const cairoDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` of the Cairo calendar day an instant falls on — the grouping day. */
export const cairoDay = (isoInstant: string | Date): string =>
  cairoDayFormatter.format(typeof isoInstant === 'string' ? new Date(isoInstant) : isoInstant);

/**
 * The legacy open grid renders TWO groups (atm_replenishment.ejs:1013 / :1086): rows opened
 * TODAY — live timer, white — and open rows of any OTHER day — grey, no timer. The comparison is
 * by calendar day of the open time. The legacy grey group had no close control; since the owner's
 * rule (port doc OD-1) an open row of ANY day blocks its machine, so both groups can be closed and
 * checked (D4).
 */
export const isOpenedToday = (openedAt: string, now: Date = new Date()): boolean =>
  cairoDay(openedAt) === cairoDay(now);

/**
 * One selection over a board's two groups: the bulk bar acts on every checked row, whichever
 * group it sits in, while each table's "select all" reaches only its OWN rows.
 */
export const groupSelection = (
  selection: TableSelection,
  groupIds: readonly string[],
): TableSelection => ({
  ...selection,
  toggleAll: (checked) => selection.toggleMany(groupIds, checked),
});

/** Whole seconds since open — the "Taken Time" the timer cell counts up. */
export const elapsedSeconds = (openedAt: string, now: Date = new Date()): number =>
  Math.max(0, Math.floor((now.getTime() - new Date(openedAt).getTime()) / 1000));

export const formatElapsed = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${pad(hours)}h : ${pad(minutes)}m : ${pad(seconds)}s`;
};

/**
 * The colour ladder (atm_replenishment.ejs:1915-1921): <1h unpainted, ≥1h green, ≥2h yellow,
 * ≥3h crimson. Returned as a semantic level; the component maps levels to classes so the ladder
 * itself stays one testable fact.
 */
export type TimerLevel = 'none' | 'green' | 'yellow' | 'red';

export const timerLevel = (totalSeconds: number): TimerLevel => {
  const hours = totalSeconds / 3600;
  if (hours >= ATM_TIMER_THRESHOLD_HOURS.red) return 'red';
  if (hours >= ATM_TIMER_THRESHOLD_HOURS.yellow) return 'yellow';
  if (hours >= ATM_TIMER_THRESHOLD_HOURS.green) return 'green';
  return 'none';
};

/**
 * The done pages' "Taken Time": close − open as whole hours and minutes. The legacy added +3 to
 * the hours to bridge its own mixed-epoch storage (atm_replenishment_done.ejs:471-478, port doc
 * T1); over honest instants the plain difference IS the duration that display was reaching for.
 */
export const formatDuration = (openedAt: string, closedAt: string): string => {
  const ms = Math.max(0, new Date(closedAt).getTime() - new Date(openedAt).getTime());
  const totalMinutes = Math.floor(ms / 60_000);
  return `${String(Math.floor(totalMinutes / 60))}h : ${String(totalMinutes % 60).padStart(2, '0')}m`;
};

/** Today's Cairo date string — the done pages' default range and the open form's default date. */
export const cairoToday = (): string => cairoDay(new Date());

// ── The owner's rule: a machine is never open twice (port doc OD-1) ─────────────────────────────

export type AtmOperationKind = 'replenishment' | 'maintenance';

/**
 * A list of machine codes as every ATM refusal line prints it, joined in the reader's language —
 * the Arabic comma in Arabic, a plain comma in English (the module's own `listSeparator`).
 */
export const joinCodes = (codes: readonly string[], locale: Locale): string =>
  codes.join(listSeparator(locale));

/** The line an open form prints for the codes it did NOT open because they are already open. */
export const alreadyOpenCodesKey = (kind: AtmOperationKind): string =>
  kind === 'replenishment'
    ? 'atm.replenishments.alreadyOpenCodes'
    : 'atm.maintenance.alreadyOpenCodes';

/** The done page's words for a reopen the rule refused. */
export const reopenRefusalKey = (kind: AtmOperationKind): string =>
  kind === 'replenishment' ? 'atm.done.reopenAlreadyOpenRep' : 'atm.done.reopenAlreadyOpenMaint';

/** Was this failure the rule's refusal — the machine already has another open operation? */
export const isAlreadyOpenRefusal = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCodes.ATM_OPERATION_ALREADY_OPEN;

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The accept confirm's words. When some of the selected mails are painted DUPLICATE, a second
 * sentence says those will NOT be accepted and stay pending — the page already knows it, because
 * `duplication` is exactly the condition accept refuses (OD-1). Without it the dialog promised a
 * maintenance for every mail and the refusal arrived only afterwards.
 */
export const acceptConfirmBody = (
  t: Translate,
  rows: readonly { id: string; duplication: boolean }[],
  ids: readonly string[],
): string => {
  const selected = new Set(ids);
  const flagged = rows.filter((row) => row.duplication && selected.has(row.id)).length;
  const body = t('atm.mail.acceptBody', { count: ids.length });
  return flagged === 0 ? body : `${body} ${t('atm.mail.acceptBodyFlagged', { count: flagged })}`;
};

/** The machine codes of the tickets accept refused, each once, in the order the server named them. */
export const refusedMachineCodes = (refused: readonly { machineCode: string }[]): string[] => [
  ...new Set(refused.map((row) => row.machineCode)),
];
