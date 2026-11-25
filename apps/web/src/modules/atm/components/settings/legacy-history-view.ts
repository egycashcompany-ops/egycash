// The legacy history card's pure parts (LegacyHistoryCard, LegacyHistoryDialog): what a row and a
// preview say, and how a refusal is worded. Kept apart so the specs pin them without rendering.
import {
  ATM_LEGACY_KINDS,
  ATM_LEGACY_SKIP_REASONS,
  ErrorCodes,
  type AtmLegacyImportBody,
  type AtmLegacyImportPreviewDto,
  type AtmLegacyImportRunDto,
  type AtmLegacyKind,
  type AtmLegacySkipReason,
  type AtmLegacySource,
  type AtmLegacySourceDto,
  type Locale,
} from '@ecms/contracts';
import { ApiError } from '../../../../shared/lib/api-client';
import { errorMessage } from '../../../../shared/lib/errors';
import { formatNumber } from '../../../../shared/lib/format';
import { DONE_RANGE_MIN_YEAR } from '../../lib/done-range-commit';
import { listSeparator } from '../../lib/register-import-view';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Codes a preview lists before «و… أخرى» — the move dialog's ten. */
export const LEGACY_CODES_LISTED = 10;

/**
 * The moment a cut typed in the box names — empty is no cut. The box shows minutes; the server's
 * own suggestion is kept to the second until the box is changed.
 */
export const cutoverFromLocal = (value: string): string | null =>
  value === '' ? null : new Date(value).toISOString();

const LOCAL_MOMENT = /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Pure: may this box value be sent as a cut — a complete moment in a year from
 * `DONE_RANGE_MIN_YEAR`, or empty (no cut)? A year still being typed (0002, 0020, 0202) is not
 * one: each of those is a whole read of the legacy source (review finding, 2026-11-25).
 */
export const isCommittableCut = (value: string): boolean => {
  if (value === '') return true;
  const match = LOCAL_MOMENT.exec(value);
  return (
    match !== null &&
    Number(match[1]) >= DONE_RANGE_MIN_YEAR &&
    !Number.isNaN(new Date(value).getTime())
  );
};

/** What the preview and the start send — only «Done» operations are copied, so no open switch. */
export const legacyImportBody = (
  source: AtmLegacySource,
  cutoverAt: string | null,
): AtmLegacyImportBody => ({ source, cutoverAt });

/** «استيراد» runs only on a preview that found rows, decided both modes, and has rows to copy. */
export const legacyImportAllowed = (preview: AtmLegacyImportPreviewDto): boolean =>
  preview.sourceFound &&
  ATM_LEGACY_KINDS.every((kind) => preview[kind].timeModeClear) &&
  ATM_LEGACY_KINDS.some((kind) => preview[kind].toImport > 0);

/** The kinds whose rows leave the time mode undecided. */
export const unclearKinds = (preview: AtmLegacyImportPreviewDto): AtmLegacyKind[] =>
  ATM_LEGACY_KINDS.filter((kind) => !preview[kind].timeModeClear);

/** The reasons that left a row out in either kind — a zero says nothing to the reader. */
export const shownSkipReasons = (preview: AtmLegacyImportPreviewDto): AtmLegacySkipReason[] =>
  ATM_LEGACY_SKIP_REASONS.filter((reason) =>
    ATM_LEGACY_KINDS.some((kind) => preview[kind].skipped[reason] > 0),
  );

/**
 * The unresolved codes of both kinds, «code (rows)» — one entry per code, as the server merges
 * them — the first ten, then how many more there are IN ALL (the server's distinct count), not
 * only how many more it sent.
 */
export const unresolvedCodesText = (
  preview: AtmLegacyImportPreviewDto,
  t: Translate,
  locale: Locale,
): string => {
  const shown = preview.unresolvedCodes.slice(0, LEGACY_CODES_LISTED);
  const text = shown
    .map((entry) => `${entry.code} (${formatNumber(entry.rows, locale)})`)
    .join(listSeparator(locale));
  const more = Math.max(preview.unresolvedCodeCount, preview.unresolvedCodes.length) - shown.length;
  return more <= 0
    ? text
    : `${text} ${t('atm.settings.move.more', { count: formatNumber(more, locale) })}`;
};

/** Legacy rows a run has read so far, of all it will read — the bar's numbers. */
export const legacyRunProgress = (run: AtmLegacyImportRunDto): { done: number; total: number } => ({
  done: run.replenishment.read + run.maintenance.read,
  total: run.totals.replenishment + run.totals.maintenance,
});

/** Whole percent, 0–100; an empty total is done. */
export const percentOf = (done: number, total: number): number =>
  total <= 0 ? 100 : Math.max(0, Math.min(100, Math.floor((done / total) * 100)));

/**
 * What a source's row says under its name: its last run, and the copies it holds now.
 * `stoppedHere`: this window drove the run and its step failed — no window drives it, whatever
 * the server's two-minute `active` still says.
 */
export const legacySourceStatus = (
  entry: AtmLegacySourceDto,
  t: Translate,
  locale: Locale,
  stoppedHere = false,
): string => {
  const n = (value: number): string => formatNumber(value, locale);
  if (entry.branchId === null) return t('atm.settings.legacy.noBranch');
  const run = entry.lastRun;
  const place = (key: string): string =>
    run === null
      ? ''
      : t(key, {
          done: n(legacyRunProgress(run).done),
          total: n(legacyRunProgress(run).total),
        });
  // A running run is one of three, on the server's clock: a window driving it now, paused (its
  // page closed), or stale (left 30 minutes — the next start or undo ends it).
  const last =
    run === null
      ? t('atm.settings.legacy.never')
      : run.state !== 'running'
        ? t(`atm.settings.legacy.last.${run.state}`)
        : run.active && !stoppedHere
          ? place('atm.settings.legacy.runningElsewhere')
          : run.stale
            ? place('atm.settings.legacy.stale')
            : place('atm.settings.legacy.paused');
  return entry.copiedRows > 0
    ? `${last} — ${t('atm.settings.legacy.copied', { count: n(entry.copiedRows) })}`
    : last;
};

/** The success toast's summary: operations copied, and those already there, per kind. */
export const legacyRunSummary = (run: AtmLegacyImportRunDto, t: Translate, locale: Locale) =>
  t('atm.settings.legacy.summary', {
    replenishment: formatNumber(run.replenishment.written, locale),
    maintenance: formatNumber(run.maintenance.written, locale),
    existing: formatNumber(run.replenishment.existing + run.maintenance.existing, locale),
  });

const LEGACY_ERRORS: Partial<Record<string, string>> = {
  [ErrorCodes.ATM_LEGACY_IMPORT_RUNNING]: 'atm.settings.legacy.error.running',
  [ErrorCodes.ATM_LEGACY_IMPORT_STATE]: 'atm.settings.legacy.error.state',
  [ErrorCodes.ATM_LEGACY_IMPORT_STEP_BUSY]: 'atm.settings.legacy.error.busy',
  [ErrorCodes.ATM_LEGACY_IMPORT_UNREADABLE]: 'atm.settings.legacy.error.unreadable',
  [ErrorCodes.ATM_BRANCH_MOVE_RUNNING]: 'atm.settings.legacy.error.moveRunning',
};

/** This card's own refusal in the reader's language; undefined for any other failure. */
export const legacyRefusalText = (error: unknown, t: Translate): string | undefined => {
  const key = error instanceof ApiError ? LEGACY_ERRORS[error.code] : undefined;
  return key === undefined ? undefined : t(key);
};

/** A refusal in the reader's language; anything else as the shared helper words it. */
export const legacyErrorText = (error: unknown, t: Translate, locale: Locale): string =>
  legacyRefusalText(error, t) ?? errorMessage(error, locale);

/** A step refused because its run is no longer running — ended by another window, or taken over. */
export const isRunEnded = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCodes.ATM_LEGACY_IMPORT_STATE;

/** A step refused because another step holds the run — retried, never shown as a failure. */
export const isStepBusy = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCodes.ATM_LEGACY_IMPORT_STEP_BUSY;
