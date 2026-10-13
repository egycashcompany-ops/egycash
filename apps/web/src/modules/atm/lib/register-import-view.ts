// The import page's decisions, kept pure so they are tested without rendering (spec §8.6, §10.2):
// when Apply may be pressed, what the `apply` field says, in which order the categories show, and
// how one of the Data Report's 57 cells is named.
//
// The server is the rule — it refuses an apply that a blocker stands against, whatever the screen
// sent — so `canApply` is a courtesy that keeps the button honest, not a guard.
import {
  ATM_BANK_NAMES,
  ATM_REGISTER_IMPORT_CATEGORIES,
  ATM_REGISTER_IMPORT_OUTCOMES,
  ErrorCodes,
  type AtmRegisterImportBlocker,
  type AtmRegisterImportCategory,
  type AtmRegisterImportCategoryDto,
  type AtmRegisterImportReportCellDto,
  type AtmRegisterImportResultDto,
  type Locale,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The blockers still standing once the owner's explicit override is taken into account (D8). */
export const standingBlockers = (
  result: Pick<AtmRegisterImportResultDto, 'blockers'>,
  reportOverride: boolean,
): AtmRegisterImportBlocker[] =>
  result.blockers.filter((blocker) => blocker !== 'reportMismatch' || !reportOverride);

/** The approved categories, in the catalogue's order, unknown names dropped — the `apply` list. */
export const approvedCategories = (approved: Iterable<string>): AtmRegisterImportCategory[] => {
  const chosen = new Set(approved);
  return ATM_REGISTER_IMPORT_CATEGORIES.filter((category) => chosen.has(category));
};

/** The multipart `apply` field: comma-separated, empty for a preview. */
export const applyField = (approved: Iterable<string>): string =>
  approvedCategories(approved).join(',');

/**
 * Apply is offered when at least one category is approved and nothing blocks — a report mismatch
 * counts only until the owner ticks the override. An applied result is a fresh plan, so the same
 * rule holds for the next pass.
 */
export const canApply = (
  result: Pick<AtmRegisterImportResultDto, 'blockers'>,
  approved: Iterable<string>,
  reportOverride: boolean,
): boolean =>
  approvedCategories(approved).length > 0 && standingBlockers(result, reportOverride).length === 0;

/** Report categories that back a blocker are read FIRST, under the blocker list (§8.6). */
const BLOCKER_BACKED = ['openInRegister', 'changedSinceImport'] as const;

/** The order the category cards show in: blocker-backed reports, approvable, the other reports. */
export const orderedCategories = (
  categories: readonly AtmRegisterImportCategoryDto[],
): { blocking: AtmRegisterImportCategoryDto[]; rest: AtmRegisterImportCategoryDto[] } => {
  const blocking = categories.filter(
    (c) => (BLOCKER_BACKED as readonly string[]).includes(c.key) && c.count > 0,
  );
  const approvable = categories.filter((c) => c.approvable);
  const reports = categories.filter(
    (c) => !c.approvable && !(BLOCKER_BACKED as readonly string[]).includes(c.key),
  );
  return { blocking, rest: [...approvable, ...reports] };
};

/** The blockers that carry a remedy line (`atm.registerImport.blockerHint.<code>`). */
const HINTED = new Set<AtmRegisterImportBlocker>([
  'dateUnreadable',
  'openInRegister',
  'changedSinceImport',
  'secretsOutOfReach',
]);
export const blockerHintKey = (blocker: AtmRegisterImportBlocker): string | null =>
  HINTED.has(blocker) ? `atm.registerImport.blockerHint.${blocker}` : null;

/** One of the 57 cells, named the way the Data Report page names it. */
export const reportCellLabel = (
  cell: Pick<AtmRegisterImportReportCellDto, 'section' | 'branchCode' | 'bankCode' | 'isTotal'>,
  t: Translate,
  locale: Locale,
): string => {
  if (cell.isTotal) return t('atm.registerReport.total');
  if (cell.section === 1)
    return cell.bankCode === null ? '' : ATM_BANK_NAMES[cell.bankCode][locale];
  if (cell.section === 2) {
    return cell.branchCode === null ? '' : t(`atm.registerReport.branch2.${cell.branchCode}`);
  }
  const branch = cell.branchCode === null ? '' : t(`atm.registerReport.branch3.${cell.branchCode}`);
  const bank = cell.bankCode === null ? '' : ATM_BANK_NAMES[cell.bankCode][locale];
  return `${branch} · ${bank}`;
};

/** A run's or an apply's counts, in the catalogue's order, without the zeros. */
export const outcomeEntries = (counts: Record<string, number>): [string, number][] =>
  ATM_REGISTER_IMPORT_OUTCOMES.flatMap((key): [string, number][] => {
    const n = counts[key] ?? 0;
    return n > 0 ? [[key, n]] : [];
  });

/**
 * Preview is offered with a file chosen and NO run in flight. The preview and the apply share one
 * mutation, and TanStack runs only the latest call's own callbacks — a preview pressed during an
 * apply swallowed the apply's summary and toast (review finding WEB-3).
 */
export const canPreview = (hasFile: boolean, running: boolean): boolean => hasFile && !running;

/** How a short list of labels is joined in the reader's language. */
export const listSeparator = (locale: Locale): string => (locale === 'ar' ? '، ' : ', ');

/** One page of a category's items — the lists are paged in the browser, never truncated. */
export const pageOf = <T>(items: readonly T[], page: number, size: number): T[] =>
  items.slice((page - 1) * size, page * size);

const IMPORT_ERROR_CODES = new Set<string>(
  Object.values(ErrorCodes).filter((code) => code.startsWith('ATM_REGISTER_')),
);

/** The file-level reason a refused upload gave, when it gave one (`details[].code` on `file`). */
const fileReason = (error: ApiError): string | undefined =>
  error.details?.find((d) => d.field === 'file')?.code;

/**
 * A refused upload in the reader's words: the register's own codes by name, the rest generically
 * — except the three file-level reasons, which say what is wrong with the FILE: no `ATMs` sheet,
 * not a workbook at all, or past a cap (review finding LIVE-2: they read "the expected columns"
 * and "some fields need attention" on a page with no fields).
 */
export const importErrorText = (error: unknown, t: Translate, locale: Locale): string => {
  if (!(error instanceof ApiError)) return errorMessage(error, locale);
  const reason = fileReason(error);
  if (reason === 'MISSING_SHEET') return t('atm.registerImport.error.missingSheet');
  if (reason === 'UNREADABLE') return t('atm.registerImport.error.unreadable');
  if (reason === 'TOO_LARGE') return t('atm.registerImport.error.tooLarge');
  return IMPORT_ERROR_CODES.has(error.code)
    ? t(`atm.register.error.${error.code}`)
    : errorMessage(error, locale);
};

/**
 * What a refusal pointed at, when it named something: the missing header's column letter, or a
 * blocker code — both safe to show (headers and codes are not register data).
 */
export const importErrorDetails = (error: unknown, t: Translate): string[] => {
  if (!(error instanceof ApiError) || error.details === undefined) return [];
  if (error.code === ErrorCodes.ATM_REGISTER_IMPORT_BLOCKED) {
    return error.details.map((d) => t(`atm.registerImport.blocker.${d.code}`));
  }
  if (error.code === ErrorCodes.ATM_REGISTER_IMPORT_LAYOUT) {
    // A missing sheet is named in the text itself; a bare «ATMs» line said nothing more.
    return error.details
      .filter((d) => d.code !== 'MISSING_SHEET')
      .map((d) =>
        d.code === 'MISSING_HEADER'
          ? `${d.field ?? ''}: ${d.message.replace(/\n/g, ' ')}`
          : d.message,
      );
  }
  return [];
};
