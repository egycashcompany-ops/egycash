// What an uploaded workbook would CHANGE about somebody already in the registry.
//
// The rule the whole file turns on: a BLANK CELL MEANS "no information", never "delete what you
// have". HR fills gaps in the system by hand — an address typed into the profile, a phone somebody
// phoned in — and a monthly roster export carries none of that. If blank overwrote, every upload
// would quietly undo a month of that work, and the report would say "0 changes" while doing it.
// So only a cell with a value in it can change anything, and `desiredFrom` simply omits the rest.
//
// Pure, and separate from the run, so the interesting half — which fields move, which are refused,
// and what counts as "the same value" — is checked without a database.
import { type Types } from 'mongoose';
import { type MaritalStatus } from '@ecms/contracts';
import { normalizeArabic } from '../modules/hr/shared/arabic';
import { maritalStatus } from './vocabulary';
import { type SourceRow } from './plan';

/** Where a change lands, in the same dotted paths a `$set` takes. */
export interface FieldChange {
  path: string;
  /** For the report: what the field reads as today, and what the file would make it. Never values
   *  that identify a person beyond what the reader is already looking at. */
  from: string;
  to: string;
  value: unknown;
}

/** A change the file asks for that this importer will not make, and why. */
export interface RefusedChange {
  path: string;
  from: string;
  to: string;
  reason: string;
}

export interface PersonDiff {
  changes: FieldChange[];
  refused: RefusedChange[];
}

/** The four placement ids, already resolved against the org structure. */
export interface ResolvedPlacement {
  branchId: string;
  departmentId: string;
  sectionId: string | null;
  jobTitleId: string;
}

/**
 * The employee as this file reads it — only the fields the workbook actually filled in.
 *
 * Two paths deliberately absent, because neither is an edit:
 *   - `code` / `employeeNumber` — issued once and frozen (ADR-017).
 *   - `hiredAt` / `employmentPeriods` — the employment history, which a roster export cannot
 *     rewrite without claiming somebody started on a different day than their file says.
 */
export const desiredFrom = (row: SourceRow, placement: ResolvedPlacement): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const put = (path: string, value: unknown): void => {
    if (value !== null && value !== undefined) out[path] = value;
  };

  put('personal.fullNameAr', row.fullNameAr);
  put('personal.fullNameEn', row.fullNameEn);
  if (row.fullNameAr !== null) {
    // Derived, never supplied: the search index has to move with the name or a renamed employee
    // stops being findable under the name they now have.
    out['personal.searchName'] = normalizeArabic([row.fullNameAr, row.fullNameEn ?? ''].join(' '));
  }
  put('personal.contact.primaryPhone', row.primaryPhone);
  put('personal.contact.secondaryPhone', row.emergencyPhone);
  put('personal.maritalStatus', maritalStatus(row.maritalStatus) as MaritalStatus | null);
  put('personal.religion', row.religion);
  put('personal.nationalIdExpiry', row.nationalIdExpiry);

  // The sheet carries one free-text line plus a governorate, and no city column — so the
  // governorate answers both, exactly as it does at creation. Written whole: a half-updated
  // address is a worse record than either the old one or the new one.
  if (row.addressLine !== null && row.governorate !== null) {
    out['personal.currentAddress'] = {
      line1: row.addressLine,
      city: row.governorate,
      governorate: row.governorate,
    };
  }
  if (row.military.status !== null) {
    out['personal.military'] = {
      status: row.military.status,
      certificateRef: row.military.certificateRef,
      completedAt: row.military.completedAt,
    };
  }
  if (row.education.level !== null) {
    out['personal.education'] = {
      level: row.education.level,
      institution: row.education.institution,
      specialization: row.education.specialization,
      graduationYear: row.education.graduationYear,
      grade: null,
    };
  }
  if (row.drivingLicenseExpiry !== null) {
    // The sheet records an expiry but never a class, as at creation.
    out['personal.drivingLicenses'] = [{ class: '—', expiry: row.drivingLicenseExpiry }];
  }

  for (const [key, value] of Object.entries(row.insurance)) put(`insurance.${key}`, value);

  put('officer.rank', row.officer.rank);
  put('officer.retirementDate', row.officer.retirementDate);
  // Booleans carry no "blank": `false` in the sheet is a statement, not a gap.
  out['officer.reserveOfficer'] = row.officer.reserveOfficer;
  out['officer.professionPractice'] = row.officer.professionPractice;
  if (row.officer.weaponLicenseType !== null) {
    out['officer.weaponLicense'] = {
      type: row.officer.weaponLicenseType,
      expiry: row.officer.weaponLicenseExpiry,
    };
  }

  // Placement. Written to BOTH the employment block and the top-level mirrors the list and the
  // scope filters read — set one without the other and the profile and the list disagree.
  out['employment.branchId'] = placement.branchId;
  out['employment.departmentId'] = placement.departmentId;
  out['employment.sectionId'] = placement.sectionId;
  out['employment.jobTitleId'] = placement.jobTitleId;
  out.branchId = placement.branchId;
  out.departmentId = placement.departmentId;
  out.sectionId = placement.sectionId;

  return out;
};

/** The shape `diffPerson` reads. Narrowed to what is compared, so a test needs no full document. */
export interface ExistingEmployee {
  personal: Record<string, unknown> & { nationalId?: string | null };
  insurance: Record<string, unknown> | null;
  officer: Record<string, unknown> | null;
  employment: Record<string, unknown>;
  branchId?: unknown;
  departmentId?: unknown;
  sectionId?: unknown;
}

/** Read a dotted path off the stored document, tolerating the null insurance/officer blocks. */
export const readPath = (doc: ExistingEmployee, path: string): unknown => {
  let cursor: unknown = doc;
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

/**
 * Whether the stored value and the file's are the same fact.
 *
 * Dates compare by instant and ids by their string form, because the document holds `Date` and
 * `ObjectId` where the file gives a plain value — compared with `===` every date and every
 * placement id would read as changed on every upload, and the report would be noise.
 */
export const sameValue = (stored: unknown, incoming: unknown): boolean => {
  if (stored === incoming) return true;
  if (stored === null || stored === undefined) return incoming === null || incoming === undefined;
  if (incoming === null || incoming === undefined) return false;
  if (stored instanceof Date || incoming instanceof Date) {
    const a = stored instanceof Date ? stored.getTime() : new Date(stored as string).getTime();
    const b = incoming instanceof Date ? incoming.getTime() : new Date(incoming as string).getTime();
    return a === b;
  }
  if (typeof stored === 'object' || typeof incoming === 'object') {
    return stableString(stored) === stableString(incoming);
  }
  return String(stored) === String(incoming);
};

/** Order-independent for objects, order-preserving for arrays, dates as instants, ids as strings. */
const stableString = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return String(value.getTime());
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown> & { toHexString?: () => string };
    // An ObjectId is an object with no useful keys — compare it the way it is written.
    if (typeof o.toHexString === 'function') return o.toHexString();
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== null && o[k] !== undefined)
      .map((k) => `${k}:${stableString(o[k])}`)
      .join(',')}}`;
  }
  return String(value);
};

/** How a value reads in the report — short, and never a whole address on one line. */
export const describe = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.length === 0 ? '—' : `${value.length}`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown> & { toHexString?: () => string };
    if (typeof o.toHexString === 'function') return o.toHexString();
    const first = Object.values(o).find((v) => v !== null && v !== undefined);
    return first === undefined ? '—' : String(first);
  }
  return String(value);
};

/**
 * What this file would change about this person, and what it asks for that will not be done.
 *
 * The one refusal: a National ID that DISAGREES with the one on file. It is filled in when the
 * record has none — that is a gap closing — but never overwritten, because the registry derives
 * birth date, gender and place of birth from it and treats it as the one-person-forever key. A
 * spreadsheet cell is not enough to re-identify a human being; it is reported so somebody can look.
 */
export const diffPerson = (
  existing: ExistingEmployee,
  row: SourceRow,
  placement: ResolvedPlacement,
): PersonDiff => {
  const desired = desiredFrom(row, placement);
  const changes: FieldChange[] = [];
  const refused: RefusedChange[] = [];

  const held = existing.personal.nationalId ?? null;
  if (row.nationalId !== null && row.nationalId !== held) {
    if (held === null) {
      desired['personal.nationalId'] = row.nationalId;
    } else {
      refused.push({
        path: 'personal.nationalId',
        from: held,
        to: row.nationalId,
        reason: 'the record already holds a different National ID — re-identifying a person is not an import edit',
      });
    }
  }

  for (const [path, value] of Object.entries(desired)) {
    const stored = readPath(existing, path);
    if (sameValue(stored, value)) continue;
    changes.push({ path, from: describe(stored), to: describe(value), value });
  }
  return { changes, refused };
};

/** The `$set` for the changes, ids left as strings for the caller to cast where the schema wants one. */
export const setFrom = (changes: readonly FieldChange[]): Record<string, unknown> =>
  Object.fromEntries(changes.map((c) => [c.path, c.value]));

/** Paths whose value is an id the document stores as an ObjectId. */
export const OBJECT_ID_PATHS = new Set([
  'employment.branchId',
  'employment.departmentId',
  'employment.sectionId',
  'employment.jobTitleId',
  'branchId',
  'departmentId',
  'sectionId',
]);

export type ObjectIdCast = (id: string) => Types.ObjectId;
