// Pure view logic for the operation grids — the Cairo day and the live timer, ported from the
// legacy templates and kept out of the components so the behaviour is testable. Which day a board
// shows is `board-day.ts`.
import { ATM_TIMER_THRESHOLD_HOURS, ErrorCodes, type Locale } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { listSeparator } from './register-import-view';

const CAIRO_TZ = 'Africa/Cairo';

const cairoDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` of the Cairo calendar day an instant falls on — the day a board shows it on. */
export const cairoDay = (isoInstant: string | Date): string =>
  cairoDayFormatter.format(typeof isoInstant === 'string' ? new Date(isoInstant) : isoInstant);

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

const present = (value: string | null): string | null =>
  value === null || value === '' ? null : value;

/**
 * The done pages' range, from their URL. The server's own ladder first — a bound absent or cleared
 * takes the other, both = today (replenishment.service.ts `listDone`) — then IN ORDER: a «إلى»
 * before «من» reads the days between instead of nothing, and the statement's title names the
 * period the table actually shows rather than «من … إلى —».
 */
export const doneRange = (
  fromParam: string | null,
  toParam: string | null,
  today: string,
): { from: string; to: string } => {
  const from = present(fromParam) ?? present(toParam) ?? today;
  const to = present(toParam) ?? present(fromParam) ?? today;
  return from <= to ? { from, to } : { from: to, to: from };
};

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

// ── A row's own buttons, over the checked rows ───────────────────────────────────────────────────

/**
 * The rows one row's close, edit or delete acts on — «تتشال الأزرار ولو أنا معلم على 5 مثلاً ..
 * فلو دوست على أى واحده فيهم تقفيل يقفلهم .. ولو حذف يحذفهم .. ولو تعديل يعدل فى كله»
 * (2026-10-27). The boards have no bulk bar: a button on a CHECKED row acts on every checked row,
 * a button on an unchecked row on that row alone — a click elsewhere never sweeps the selection
 * into it. The confirmation names the count either way.
 */
export const actionTargets = <T extends { id: string }>(row: T, checked: readonly T[]): T[] =>
  checked.some((one) => one.id === row.id) ? [...checked] : [row];
