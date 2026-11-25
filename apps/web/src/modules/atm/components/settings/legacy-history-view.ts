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

export const legacyImportBody = (
  source: AtmLegacySource,
  cutoverAt: string | null,
  includeOpen: boolean,
): AtmLegacyImportBody => ({ source, cutoverAt, includeOpen });

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

/** The unresolved codes of both kinds, «code (rows)», the first ten and how many more. */
export const unresolvedCodesText = (
  preview: AtmLegacyImportPreviewDto,
  t: Translate,
  locale: Locale,
): string => {
  const codes = ATM_LEGACY_KINDS.flatMap((kind) =>
    preview[kind].unresolvedCodes.map(
      (entry) => `${entry.code} (${formatNumber(entry.rows, locale)})`,
    ),
  );
  const shown = codes.slice(0, LEGACY_CODES_LISTED).join(listSeparator(locale));
  return codes.length <= LEGACY_CODES_LISTED
    ? shown
    : `${shown} ${t('atm.settings.move.more', {
        count: formatNumber(codes.length - LEGACY_CODES_LISTED, locale),
      })}`;
};

/** Legacy rows a run has read so far, of all it will read — the bar's numbers. */
export const legacyRunProgress = (run: AtmLegacyImportRunDto): { done: number; total: number } => ({
  done: run.replenishment.read + run.maintenance.read,
  total: run.totals.replenishment + run.totals.maintenance,
});

/** Whole percent, 0–100; an empty total is done. */
export const percentOf = (done: number, total: number): number =>
  total <= 0 ? 100 : Math.min(100, Math.floor((done / total) * 100));

/** What a source's row says under its name: its last run, and the copies it holds now. */
export const legacySourceStatus = (
  entry: AtmLegacySourceDto,
  t: Translate,
  locale: Locale,
): string => {
  const n = (value: number): string => formatNumber(value, locale);
  if (entry.branchId === null) return t('atm.settings.legacy.noBranch');
  const run = entry.lastRun;
  const last =
    run === null
      ? t('atm.settings.legacy.never')
      : run.state === 'running'
        ? t('atm.settings.legacy.paused', {
            done: n(legacyRunProgress(run).done),
            total: n(legacyRunProgress(run).total),
          })
        : t(`atm.settings.legacy.last.${run.state}`);
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

/** A refusal in the reader's language; anything else as the shared helper words it. */
export const legacyErrorText = (error: unknown, t: Translate, locale: Locale): string => {
  const key = error instanceof ApiError ? LEGACY_ERRORS[error.code] : undefined;
  return key === undefined ? errorMessage(error, locale) : t(key);
};

/** A step refused because another step holds the run — retried, never shown as a failure. */
export const isStepBusy = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCodes.ATM_LEGACY_IMPORT_STEP_BUSY;
