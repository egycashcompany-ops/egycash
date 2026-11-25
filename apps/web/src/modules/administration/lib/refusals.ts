// The server's refusals, worded beside the field each one names (design §13.6 E, §5.15).
//
// The dialog's alert box says the refusal itself through the shared `FRIENDLY` table
// (`shared/lib/errors.ts`), in the reader's language. A refusal that names a field also carries it
// in its `details` — which name clashed, which level is out of order, why a parent was refused — and
// that is said here, on the field's own `Field error`, so the reader sees which box to change. Pure:
// the details in, the catalog key per field out, so a spec reaches it without a browser.
import {
  ADMINISTRATION_CATEGORY_PARENT_PROBLEMS,
  ADMINISTRATION_DEACTIVATION_PROBLEMS,
  ADMINISTRATION_STOCK_LEVEL_FIELDS,
  ErrorCodes,
  type ApiErrorDetail,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';

/** The form fields a refusal can name, keyed as the module's forms key their boxes. */
export type RefusalField =
  | 'nameAr'
  | 'code'
  | 'barcode'
  | 'parentId'
  | 'minQty'
  | 'reorderPointQty'
  | 'maxQty'
  | 'unitId'
  | 'categoryId'
  | 'branchId'
  | 'responsibleEmployeeId'
  | 'isActive';

/** What a duplicate names (`ADMINISTRATION_DUPLICATE_FIELDS`), as the form's box for it. */
const DUPLICATE_FIELDS: Readonly<Record<string, RefusalField>> = {
  name: 'nameAr',
  code: 'code',
  barcode: 'barcode',
};

const isOneOf = <T extends string>(values: readonly T[], value: string | undefined): value is T =>
  value !== undefined && (values as readonly string[]).includes(value);

/** The field and the catalog key one detail of one refusal is worded with, or null. */
const wording = (code: string, detail: ApiErrorDetail): [RefusalField, string] | null => {
  switch (code) {
    case ErrorCodes.ADMINISTRATION_DUPLICATE: {
      const field = detail.field === undefined ? undefined : DUPLICATE_FIELDS[detail.field];
      return field === undefined
        ? null
        : [field, `administration.refusals.duplicate.${detail.field as string}`];
    }
    case ErrorCodes.ADMINISTRATION_CATEGORY_PARENT_INVALID:
      return isOneOf(ADMINISTRATION_CATEGORY_PARENT_PROBLEMS, detail.code)
        ? ['parentId', `administration.refusals.parent.${detail.code}`]
        : null;
    case ErrorCodes.ADMINISTRATION_STOCK_LEVELS_ORDER:
      return isOneOf(ADMINISTRATION_STOCK_LEVEL_FIELDS, detail.field)
        ? [detail.field, 'administration.refusals.levelsOutOfOrder']
        : null;
    case ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE:
      return detail.field === 'unitId' || detail.field === 'categoryId'
        ? [detail.field, `administration.refusals.inactive.${detail.field}`]
        : null;
    case ErrorCodes.ADMINISTRATION_SUBCATEGORY_REQUIRED:
      return ['categoryId', 'administration.refusals.subcategoryRequired'];
    case ErrorCodes.ADMINISTRATION_EMPLOYEE_EXITED:
      return ['responsibleEmployeeId', 'administration.refusals.keeperExited'];
    case ErrorCodes.ADMINISTRATION_DEACTIVATION_BLOCKED:
      return isOneOf(ADMINISTRATION_DEACTIVATION_PROBLEMS, detail.code)
        ? ['isActive', `administration.refusals.deactivation.${detail.code}`]
        : null;
    // A branch outside the top bar's choice (ADR-028): the create files a store only there.
    case ErrorCodes.VALIDATION_FAILED:
      return detail.code === 'OUT_OF_REACH' && detail.field === 'body.branchId'
        ? ['branchId', 'administration.refusals.branchOutOfReach']
        : null;
    default:
      return null;
  }
};

/**
 * For each field a refusal names, the catalog key that words it beside that field. Several details
 * on one field keep the first; a refusal that names no field (a 403, a stale version) gives none —
 * the alert box above the form says those.
 */
export const refusalFieldKeys = (error: unknown): Partial<Record<RefusalField, string>> => {
  if (!(error instanceof ApiError)) return {};
  const keys: Partial<Record<RefusalField, string>> = {};
  for (const detail of error.details ?? []) {
    const worded = wording(error.code, detail);
    if (worded !== null && keys[worded[0]] === undefined) keys[worded[0]] = worded[1];
  }
  return keys;
};

/** Every catalog key `refusalFieldKeys` can answer — what the module's i18n spec checks. */
export const REFUSAL_FIELD_KEYS: readonly string[] = [
  ...Object.keys(DUPLICATE_FIELDS).map((field) => `administration.refusals.duplicate.${field}`),
  ...ADMINISTRATION_CATEGORY_PARENT_PROBLEMS.map(
    (code) => `administration.refusals.parent.${code}`,
  ),
  'administration.refusals.levelsOutOfOrder',
  'administration.refusals.inactive.unitId',
  'administration.refusals.inactive.categoryId',
  'administration.refusals.subcategoryRequired',
  'administration.refusals.keeperExited',
  ...ADMINISTRATION_DEACTIVATION_PROBLEMS.map(
    (code) => `administration.refusals.deactivation.${code}`,
  ),
  'administration.refusals.branchOutOfReach',
];

/**
 * A save refused for a moved `version` (409 `STALE_DOCUMENT`): someone saved the record since the
 * form opened. The form rebases on the record as it now is, so the next Save is judged against it.
 */
export const isStaleRefusal = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT;

/**
 * The form a stale save rebases on: the record as it now is, with what the reader changed since the
 * form opened laid over it. A box the reader did not touch takes the other person's value, so the
 * next Save sends only the reader's own changes and never undoes the other save; a box both changed
 * keeps the reader's typing, which they can see before pressing Save again.
 */
export const carryEdits = <F extends object>(opened: F, typed: F, fresh: F): F => {
  const mine = Object.fromEntries(
    Object.entries(typed).filter(([key, value]) => value !== opened[key as keyof F]),
  );
  return { ...fresh, ...mine };
};

/** One field's refusal, in the reader's words, or nothing — what its `Field error` takes. */
export const fieldRefusal = (
  keys: Partial<Record<RefusalField, string>>,
  field: RefusalField,
  t: (key: string) => string,
): string | undefined => {
  const key = keys[field];
  return key === undefined ? undefined : t(key);
};
