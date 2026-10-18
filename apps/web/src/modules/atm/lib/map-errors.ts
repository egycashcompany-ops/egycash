// What a refused zone save tells the person (docs/12-planning/atm-map-zones.md §8.10). Pure: the page
// opens the conflict dialog, reloads, or shows the key this returns.
//
// The codes arrive two ways. The service's own checks put theirs in `details[].code`
// (`DUPLICATE_NAME`, `TOO_MANY_ZONES`, the geometry codes, `BRANCH_MISMATCH`). The schema's
// refinements are Zod custom issues, which the validation edge reports as `CUSTOM` with the code in
// the message (`TOO_MANY_POINTS_IN_SAVE`), so both places are read.
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';

export type ZoneSaveFailure =
  { kind: 'conflict' } | { kind: 'reload'; key: string } | { kind: 'message'; key: string };

const GEOMETRY = new Set(['SELF_INTERSECTION', 'TOO_FEW_POINTS', 'DUPLICATE_POINT', 'TOO_SMALL']);
const TOO_MANY_POINTS = new Set([
  'TOO_MANY_POINTS_IN_SAVE',
  'TOO_MANY_POINTS_IN_BRANCH',
  'TOO_MANY_POINTS',
]);

/** Null: nothing this screen words itself — `errorMessage` speaks for it. */
export const zoneSaveFailure = (error: unknown): ZoneSaveFailure | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.code === ErrorCodes.ATM_MAP_ZONES_STALE) return { kind: 'conflict' };
  if (error.code === ErrorCodes.BUSINESS_RULE_VIOLATION) {
    return { kind: 'message', key: 'atm.map.edit.chooseBranch' };
  }
  if (error.code === ErrorCodes.FORBIDDEN) {
    return { kind: 'message', key: 'atm.map.edit.branchNotEditable' };
  }
  if (error.code !== ErrorCodes.VALIDATION_FAILED) return null;
  const codes = (error.details ?? []).flatMap((detail) => [detail.code, detail.message]);
  if (codes.includes('BRANCH_MISMATCH')) {
    return { kind: 'reload', key: 'atm.map.save.error.branchChanged' };
  }
  if (codes.includes('DUPLICATE_NAME')) {
    return { kind: 'message', key: 'atm.map.save.error.duplicateName' };
  }
  if (codes.includes('TOO_MANY_ZONES')) {
    return { kind: 'message', key: 'atm.map.save.error.tooManyZones' };
  }
  if (codes.some((code) => TOO_MANY_POINTS.has(code))) {
    return { kind: 'message', key: 'atm.map.save.error.tooManyPoints' };
  }
  if (codes.some((code) => GEOMETRY.has(code))) {
    return { kind: 'message', key: 'atm.map.save.error.geometry' };
  }
  return null;
};

/**
 * The warning a refused «اعتماد الموقع» shows (§8.10), or null for `errorMessage` to speak: the
 * register's text moved since the pin was derived (sync first), or the pin is no longer waiting
 * for review — a colleague approved it, or a sync cleared it, in between (the list is re-read, so
 * the stale row leaves it).
 */
export const approveFailureKey = (error: unknown): string | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.code === ErrorCodes.ATM_MAP_SOURCE_CHANGED) return 'atm.map.unlocated.sourceChanged';
  if (error.code === ErrorCodes.ATM_MAP_NOT_UNDER_REVIEW) return 'atm.map.unlocated.notUnderReview';
  return null;
};
