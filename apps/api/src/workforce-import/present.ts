// How a change LOOKS in the preview — separate from what it WRITES.
//
// THE THREE THINGS THIS FILE FIXES were one screen, one afternoon. A department move read
// `6a9d5b17… → 6a9c84e1…`; an insurance file that would be created read `— → 0`; a qualification
// whose institution changed read `bachelor → bachelor`. All three were the same mistake: the
// preview reused the write's shape, and a write does not need to be readable. A `$set` of a whole
// block is correct for MongoDB and useless for a person, so the block was being summarised by its
// first non-null field, and an ObjectId is the right thing to store and the wrong thing to show.
//
// So presentation is its own pass, after the diff and before the DTO. It never changes a
// `FieldChange` — `sync.spec.ts` pins the write shape and it stays pinned — it only decides how
// each one is shown: expanded to the fields a person recognises, ids swapped for names, closed
// vocabularies tagged so the screen can label them in the reader's language.
import {
  EDUCATION_LEVELS,
  EMPLOYEE_EXIT_TYPES,
  EMPLOYEE_STATUSES,
  INSURANCE_STATUSES,
  MARITAL_STATUSES,
  MILITARY_STATUSES,
  WEAPON_LICENSE_TYPES,
  type LocalizedString,
  type RosterEnumFamily,
  type RosterFieldChangeDto,
  type RosterValueDto,
} from '@ecms/contracts';
import {
  branchService,
  departmentService,
  jobTitleService,
  sectionService,
} from '../platform/organization';
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { type FieldChange } from './sync';

/** Paths whose value is an org entity id, and which registry answers for it. */
const NAMED_PATHS: Record<string, 'branch' | 'department' | 'section' | 'jobTitle'> = {
  'employment.branchId': 'branch',
  'employment.departmentId': 'department',
  'employment.sectionId': 'section',
  'employment.jobTitleId': 'jobTitle',
  branchId: 'branch',
  departmentId: 'department',
  sectionId: 'section',
};

/**
 * Paths whose value is a token from a closed vocabulary the UI already labels.
 *
 * The token is what travels, never a translation: the screen owns the words, and the same
 * `bachelor` that is «Bachelor» in English is «بكالوريوس» in Arabic without this file knowing.
 */
const ENUM_PATHS: Record<string, RosterEnumFamily> = {
  'personal.education.level': 'educationLevel',
  'personal.maritalStatus': 'maritalStatus',
  'personal.military.status': 'militaryStatus',
  'insurance.status': 'insuranceStatus',
  'officer.weaponLicense.type': 'weaponLicenseType',
  status: 'employeeStatus',
  exitType: 'exitType',
};

const ENUM_VALUES: Record<RosterEnumFamily, readonly string[]> = {
  educationLevel: EDUCATION_LEVELS,
  insuranceStatus: INSURANCE_STATUSES,
  weaponLicenseType: WEAPON_LICENSE_TYPES,
  maritalStatus: MARITAL_STATUSES,
  militaryStatus: MILITARY_STATUSES,
  employeeStatus: EMPLOYEE_STATUSES,
  exitType: EMPLOYEE_EXIT_TYPES,
};

/**
 * Blocks the write stores whole, shown field by field.
 *
 * `insurance` and `officer` are written whole when absent (a dotted `$set` into `null` fails), and
 * `personal.education`, `personal.military` and `officer.weaponLicense` are objects the diff
 * compares whole. None of that is what a reader wants to approve: they want to see that the
 * institution changed and the level did not. The fields are listed, not discovered, so a new field
 * added to a block shows up as a label to add rather than a surprise.
 */
const EXPANDED: Record<string, readonly string[]> = {
  insurance: [
    'insuranceNumber',
    'occupation',
    'occupationCode',
    'grossWage',
    'contributionWage',
    'basicWage',
    'employerShare',
    'employeeShare',
    'status',
  ],
  officer: ['reserveOfficer', 'rank', 'weaponLicense', 'professionPractice', 'retirementDate'],
  'personal.education': ['level', 'institution', 'specialization', 'graduationYear'],
  'personal.military': ['status', 'certificateRef', 'completedAt'],
  'officer.weaponLicense': ['type', 'expiry'],
};

/**
 * Blocks shown as ONE value rather than expanded, and what that value is.
 *
 * The address is deliberately reduced to its governorate: the DTO's own contract says a preview
 * never carries a whole address, and the governorate is what a roster move is about. A licence
 * is its expiry — the sheet never records a class.
 */
const SUMMARISED: Record<string, (v: Record<string, unknown>) => unknown> = {
  'personal.currentAddress': (v) => v.governorate ?? v.city ?? null,
  'personal.drivingLicenses': (v) =>
    Array.isArray(v) ? (v[0] as { expiry?: unknown })?.expiry : null,
};

const PLACEHOLDER = /^dry-run:(branch|department|section|jobTitle|departmentCatalog|sectionCatalog):(.*)$/;

/** The org entity names the presenter can look up, read once per report. */
export interface OrgNames {
  branch: ReadonlyMap<string, LocalizedString>;
  department: ReadonlyMap<string, LocalizedString>;
  section: ReadonlyMap<string, LocalizedString>;
  jobTitle: ReadonlyMap<string, LocalizedString>;
}

const isObjectId = (v: unknown): v is { toHexString: () => string } =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { toHexString?: unknown }).toHexString === 'function';

const asText = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (isObjectId(v)) return v.toHexString();
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
};

const absent: RosterValueDto = { kind: 'absent' };

/**
 * A `dry-run:*` token is a thing the file would CREATE. It is shown as the name it would have,
 * flagged as new — never as the token, which is an implementation detail that leaked into a screen
 * asking a manager to approve it.
 *
 * The token's tail is `${code}` for a branch, `${key}` for a department/section (the folded name,
 * or `${parentId}|${folded name}`), and `${key}` for a job title. The last `|`-segment is the name.
 */
const placeholderName = (token: string): string => {
  const m = token.match(PLACEHOLDER);
  const tail = m?.[2] ?? token;
  const parts = tail.split('|');
  return parts[parts.length - 1] ?? tail;
};

/** One value, given the path it sits at and the registries it may consult. */
export const presentValue = (path: string, value: unknown, names: OrgNames): RosterValueDto => {
  if (value === null || value === undefined) return absent;
  if (Array.isArray(value) && value.length === 0) return absent;

  const registry = NAMED_PATHS[path];
  if (registry !== undefined) {
    const raw = asText(value);
    if (PLACEHOLDER.test(raw)) {
      const name = placeholderName(raw);
      return { kind: 'named', name: { ar: name, en: name }, isNew: true };
    }
    const name = names[registry].get(raw);
    // An id the registry does not know is still shown, as the id: hiding it would make a real
    // reference indistinguishable from a blank. It is a data problem to notice, not to paper over.
    return name === undefined
      ? { kind: 'text', text: raw }
      : { kind: 'named', name, isNew: false };
  }

  const family = ENUM_PATHS[path];
  if (family !== undefined) {
    const token = asText(value);
    if (ENUM_VALUES[family].includes(token)) return { kind: 'enum', family, value: token };
    return { kind: 'text', text: token };
  }

  const summarise = SUMMARISED[path];
  if (summarise !== undefined) {
    const v = summarise(value as Record<string, unknown>);
    return v === null || v === undefined ? absent : { kind: 'text', text: asText(v) };
  }

  if (typeof value === 'object' && !(value instanceof Date) && !isObjectId(value)) {
    // A block that reached here was not expanded (unknown shape). Say so honestly rather than
    // summarising it by its first field, which is the mistake this file replaces.
    return { kind: 'text', text: asText(value) };
  }
  if (typeof value === 'boolean') return { kind: 'text', text: value ? '✓' : '✗' };
  return { kind: 'text', text: asText(value) };
};

/**
 * One write, shown as the rows a person can read.
 *
 * `from`/`to` come from the STORED and INCOMING values, not from the strings the diff formatted:
 * the diff's strings were the collapsed ones. A block is expanded field by field and only the
 * fields that actually differ are shown — the level that stayed `bachelor` is not a change and
 * must not read as one.
 */
export const presentChange = (
  change: FieldChange,
  stored: unknown,
  names: OrgNames,
): RosterFieldChangeDto[] => {
  const fields = EXPANDED[change.path];
  if (fields === undefined) {
    return [
      {
        path: change.path,
        from: presentValue(change.path, stored, names),
        to: presentValue(change.path, change.value, names),
      },
    ];
  }
  const before = (stored ?? {}) as Record<string, unknown>;
  const after = (change.value ?? {}) as Record<string, unknown>;
  const rows: RosterFieldChangeDto[] = [];
  for (const field of fields) {
    const path = `${change.path}.${field}`;
    const nested = EXPANDED[path];
    if (nested !== undefined) {
      rows.push(...presentChange({ ...change, path, value: after[field] }, before[field], names));
      continue;
    }
    const from = presentValue(path, before[field], names);
    const to = presentValue(path, after[field], names);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    rows.push({ path, from, to });
  }
  return rows;
};

const readAll = async <T>(
  read: (page: number, pageSize: number) => Promise<{ items: T[]; meta: { totalPages: number } }>,
): Promise<T[]> => {
  const out: T[] = [];
  for (let page = 1; ; page += 1) {
    const res = await read(page, MAX_PAGE_SIZE);
    out.push(...res.items);
    if (page >= res.meta.totalPages) return out;
  }
};

/**
 * Every org name the preview might need, read once.
 *
 * The same four registries `org.ts` resolves against, read with the same organization-wide scope,
 * so a name the resolver could find is a name the preview can show. Four reads per report, not
 * one per change.
 */
export const loadOrgNames = async (actorId: string): Promise<OrgNames> => {
  const scope = {
    scope: 'organization' as const,
    userId: actorId,
    branchId: null,
    departmentId: null,
    sectionId: null,
  };
  const index = <T extends { _id: unknown; name: LocalizedString }>(items: T[]) =>
    new Map(items.map((i) => [String(i._id), i.name] as const));
  const [branches, departments, sections, jobTitles] = await Promise.all([
    readAll((page, pageSize) => branchService.list({ page, pageSize, sortDir: 'asc' }, scope)),
    readAll((page, pageSize) => departmentService.list({ page, pageSize, sortDir: 'asc' }, scope)),
    readAll((page, pageSize) => sectionService.list({ page, pageSize, sortDir: 'asc' }, scope)),
    readAll((page, pageSize) => jobTitleService.list({ page, pageSize, sortDir: 'asc' }, scope)),
  ]);
  return {
    branch: index(branches),
    department: index(departments),
    section: index(sections),
    jobTitle: index(jobTitles),
  };
};
