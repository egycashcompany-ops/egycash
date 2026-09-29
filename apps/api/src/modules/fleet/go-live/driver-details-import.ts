// The DRIVERS REGISTRY'S MISSING FACTS — «الوظيفة / التخصص / الرخصة / تاريخ الرخصة» and the area,
// brought across from the two old books that hold them.
//
// «ضيف الداتا دى بتاعت السواقيين عشان كانت ناقصه». The registry lists every driving-seat employee
// from HR, and most of its rows read «غير مسجّل» in exactly those four columns: nobody ever typed a
// profile for them, and the go-live steps before this one brought the licence SCANS across but not
// the facts written beside them. The facts are in two exports the owner handed over:
//
//   driver-details.json — the old HR register (`employees`), cut down to the rows that are drivers
//                         (a title with «سائق») or carry a licence, and to the columns this reads.
//                         It is keyed by the EMPLOYEE CODE, the same join the licence scans use.
//                         National ids, wages and the rest of the HR file were left out of the
//                         build on purpose: HR already holds them, and nothing here reads them.
//   drivers.json        — the old drivers book (`drivers`), 152 rows, cut down to the columns this
//                         reads. It has NO code: a row names its driver by name and phone, so it
//                         is matched to a person (below) and fills only what the register lacks.
//
// THE NEWER BOOK WINS, the older fills gaps. The HR register is the later export (December 2025)
// and is the one the house kept up — a driver whose licence was renewed has the new expiry there
// and the old one in the drivers book. So a fact the register has is taken from it; the drivers
// book is read only for a fact the register left empty.
//
// NOTHING A PERSON TYPED IS OVERWRITTEN. A profile field that already holds a value is left as it
// is, whatever the books say — the screen is where facts get corrected, and a deploy that put the
// old value back over a correction would be the import undoing the owner's work. Only EMPTY fields
// are filled, one field at a time, each guarded by «still empty» in the same write.
//
// THE WORDS ARE KEPT AS WRITTEN, with two exceptions that are spellings rather than values.
// «الوظيفة» is the register's job title — «سائق», «سائق ب», «سائق ج», «سائق صراف الى» — and the
// owner's answer for the bare «سائق» was «أضيف «سائق» للقائمة»: add it to the list as written,
// not read it as grade A. «التخصص» likewise, with «Operation» added as written («أضيف «Operation»
// (مقترح)»). The exceptions: the licence classes are «اولى» and «تانيه» in the catalog and are
// spelled six ways in the books («أولى», «ثانية», «ثانيه», «تانية», «اتانية» …), and «سوزوكى» is
// the catalog's «سزوكى» — those are the same word, and adding «ثانية» beside «تانيه» would split
// one licence class in two. Everything else that no catalog item names is ADDED to its catalog,
// under its own words, and listed on the run.
import { Types } from 'mongoose';
import { type FleetCatalogKind } from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { type DirectoryEmployee } from '../../../platform/directory';
import { ConflictError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetCatalogItemRepository, fleetCatalogItemService } from '../catalogs';
import {
  DRIVER_PROFILE_KIND,
  FleetDriverProfileModel,
  type FleetDriverProfileDoc,
} from '../driver-profiles/driver-profile.model';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { legacyDateOf } from './legacy-row';
import { fold } from './vehicles-import';

/** The register's file, beside `cars.json`. */
export const DRIVER_DETAILS_FILE = 'driver-details.json';
/** The drivers book's file, beside `cars.json`. */
export const LEGACY_DRIVERS_FILE = 'drivers.json';

// ── Reading the two books ───────────────────────────────────────────────────────────────────

/**
 * A book's word, or `null` when it wrote nothing. The old books write «nothing» three ways — no
 * key, an empty string, and the NUMBER 0 (the drivers book has `"Column5": 0` for an address
 * nobody gave, the register `"license": 0`) — and all three are the same absence. Any other
 * number is kept as its digits: it is what the book wrote, however odd a value it is for the field.
 */
export const wordOf = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value === 0 ? null : String(value);
  if (typeof value !== 'string') return null;
  const word = value.replace(/\s+/g, ' ').trim();
  return word === '' || word === '0' ? null : word;
};

/**
 * A phone as the join reads it: its last ten digits. The register writes «01144357250», the
 * drivers book the NUMBER 1144357250 (the leading zero lost to a spreadsheet), and once a
 * `$numberLong` — the same phone three ways, and the last ten digits are what they share. Fewer
 * than ten digits is not a phone anybody can be found by.
 */
export const phoneKey = (value: unknown): string | null => {
  const raw =
    typeof value === 'object' && value !== null && '$numberLong' in value
      ? String((value as { $numberLong: unknown }).$numberLong)
      : typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '';
  const digits = raw.replace(/\D/g, '');
  return digits.length < 10 ? null : digits.slice(-10);
};

/** A name as the join compares it: folded, and with the spaces taken out. */
const compact = (name: string): string => fold(name).replace(/ /g, '');
/** A name's words, folded. */
const tokens = (name: string): string[] =>
  fold(name)
    .split(' ')
    .filter((token) => token !== '');

/** One row of the register, as this step reads it. */
export interface DetailsRow {
  code: string;
  name: string;
  title: string | null;
  licenseType: string | null;
  licenseDate: Date | null;
  specialization: string | null;
  area: string | null;
  phones: string[];
  /** The register had deleted the row. */
  deleted: boolean;
}

/** One row of the drivers book, as this step reads it. */
export interface LegacyDriverRow {
  name: string;
  licenseType: string | null;
  licenseDate: Date | null;
  area: string | null;
  phone: string | null;
  /** How the run names the row: the name and the phone as the book wrote them. */
  label: string;
  deleted: boolean;
}

export const parseDriverDetails = (raw: unknown): { rows: DetailsRow[]; rejected: string[] } => {
  if (!Array.isArray(raw)) throw new Error('the driver details file is not a JSON array');
  const rows: DetailsRow[] = [];
  const rejected: string[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    const code = wordOf(entry['employee_id']);
    const name = wordOf(entry['employee_name']);
    if (code === null || name === null) {
      rejected.push(JSON.stringify(entry['_id'] ?? entry));
      continue;
    }
    rows.push({
      code,
      name,
      title: wordOf(entry['employee_title']),
      licenseType: wordOf(entry['license']),
      licenseDate: legacyDateOf(entry['license_date']),
      specialization: wordOf(entry['specialization']),
      area: wordOf(entry['area']),
      phones: [phoneKey(entry['phone']), phoneKey(entry['phone2'])].filter(
        (phone): phone is string => phone !== null,
      ),
      deleted: entry['deleted'] === 1,
    });
  }
  return { rows, rejected };
};

export const parseLegacyDrivers = (
  raw: unknown,
): { rows: LegacyDriverRow[]; rejected: string[] } => {
  if (!Array.isArray(raw)) throw new Error('the drivers book is not a JSON array');
  const rows: LegacyDriverRow[] = [];
  const rejected: string[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    const name = wordOf(entry['Column1']);
    if (name === null) {
      rejected.push(JSON.stringify(entry['_id'] ?? entry));
      continue;
    }
    const phone = phoneKey(entry['Column10']);
    // The phone as the book wrote it, with the leading zero a spreadsheet took off put back.
    const written = String(
      typeof entry['Column10'] === 'object' && entry['Column10'] !== null
        ? ((entry['Column10'] as { $numberLong?: unknown }).$numberLong ?? '')
        : (entry['Column10'] ?? ''),
    ).replace(/\D/g, '');
    const shown = written.length === 10 && written.startsWith('1') ? `0${written}` : written;
    rows.push({
      name,
      licenseType: wordOf(entry['Column3']),
      licenseDate: legacyDateOf(entry['Column4']),
      area: wordOf(entry['Column6']),
      phone,
      label: shown === '' ? name : `${name} — ${shown}`,
      deleted: entry['Column13'] === 1,
    });
  }
  return { rows, rejected };
};

// ── The catalog words ───────────────────────────────────────────────────────────────────────

/** The six spellings of the two licence classes, folded, to the catalog's own two words. */
const LICENSE_TYPE_SPELLINGS: Readonly<Record<string, string>> = {
  [fold('أولى')]: 'اولى',
  [fold('اولى')]: 'اولى',
  [fold('ثانية')]: 'تانيه',
  [fold('ثانيه')]: 'تانيه',
  [fold('تانية')]: 'تانيه',
  [fold('تانيه')]: 'تانيه',
  [fold('اتانية')]: 'تانيه',
};

/** «سوزوكى» is the catalog's «سزوكى». */
const SPECIALIZATION_SPELLINGS: Readonly<Record<string, string>> = {
  [fold('سوزوكى')]: 'سزوكى',
};

export const licenseTypeWord = (word: string | null): string | null =>
  word === null ? null : (LICENSE_TYPE_SPELLINGS[fold(word)] ?? word);
export const specializationWord = (word: string | null): string | null =>
  word === null ? null : (SPECIALIZATION_SPELLINGS[fold(word)] ?? word);

// ── Matching the drivers book to people ─────────────────────────────────────────────────────

/** Somebody the join can land on: a code, a name and the phones on file for them. */
export interface Candidate {
  code: string;
  name: string;
  phones: readonly string[];
}

export type LegacyMatch =
  | { kind: 'matched'; code: string; how: 'phone' | 'name' | 'prefix' }
  | { kind: 'ambiguous'; codes: string[] }
  | { kind: 'unmatched' };

/**
 * Who a drivers-book row is, by the three things it gives — in the order of how sure each is.
 *
 * 1. THE PHONE. A mobile number belongs to one person; the register and HR both carry it.
 * 2. THE WHOLE NAME, folded and with its spaces taken out («منيرعلى» is «منير على»).
 * 3. THE NAME AS THE START OF A LONGER ONE — the drivers book writes three names where the
 *    register writes four or five («وليد عاطف عبدالنبى» for «وليد عاطف عبد النبى سليم»). Only at
 *    a WORD boundary, and only for a name of three words or more: «احمد محمد» is the start of half
 *    the payroll, and a boundary in the middle of a word would read «محمد» as «محمدين».
 *
 * At each step, ONE person is a match and two or more is ambiguous — reported, never guessed. A
 * row nobody matches is somebody no longer in the company's books at all, and is listed.
 */
export const matchLegacyRow = (
  row: LegacyDriverRow,
  candidates: readonly Candidate[],
): LegacyMatch => {
  const decide = (codes: Set<string>, how: 'phone' | 'name' | 'prefix'): LegacyMatch | null => {
    if (codes.size === 1) return { kind: 'matched', code: [...codes][0] as string, how };
    if (codes.size > 1) return { kind: 'ambiguous', codes: [...codes].sort() };
    return null;
  };
  if (row.phone !== null) {
    const byPhone = new Set(
      candidates.filter((c) => c.phones.includes(row.phone as string)).map((c) => c.code),
    );
    const found = decide(byPhone, 'phone');
    if (found !== null) return found;
  }
  const wanted = compact(row.name);
  const byName = new Set(candidates.filter((c) => compact(c.name) === wanted).map((c) => c.code));
  const named = decide(byName, 'name');
  if (named !== null) return named;
  if (tokens(row.name).length >= 3) {
    const byPrefix = new Set(
      candidates
        .filter((c) => {
          const words = tokens(c.name);
          for (let n = 1; n < words.length; n += 1) {
            if (words.slice(0, n).join('') === wanted) return true;
          }
          return false;
        })
        .map((c) => c.code),
    );
    const prefixed = decide(byPrefix, 'prefix');
    if (prefixed !== null) return prefixed;
  }
  return { kind: 'unmatched' };
};

// ── The plan ────────────────────────────────────────────────────────────────────────────────

/** The facts one driver is to get, each already in the catalog's words. */
export interface DriverFacts {
  code: string;
  /** How the run names the driver. */
  name: string;
  job: string | null;
  specialization: string | null;
  licenseType: string | null;
  licenseExpiresAt: Date | null;
  area: string | null;
}

export interface DriverDetailsPlan {
  drivers: DriverFacts[];
  /** Drivers-book rows matched to nobody — «name — phone». */
  unmatchedLegacy: string[];
  /** Drivers-book rows that fit more than one person — «name — codes». */
  ambiguousLegacy: string[];
  /** Rows either book had deleted — not read as anybody's facts. */
  deletedRows: string[];
  /** Codes the register lists twice; the first live row is read. */
  duplicateCodes: string[];
}

const hasAnyFact = (facts: DriverFacts): boolean =>
  facts.job !== null ||
  facts.specialization !== null ||
  facts.licenseType !== null ||
  facts.licenseExpiresAt !== null ||
  facts.area !== null;

/**
 * The two books, joined per driver. Pure — the roster is handed in — so every rule above can be
 * tested without a database.
 *
 * `roster` is who HR says holds a driving seat (leavers included); it is only a second place to
 * find a drivers-book row's person, since the register's codes are the same codes HR has.
 */
export const planDriverDetails = (
  details: readonly DetailsRow[],
  legacy: readonly LegacyDriverRow[],
  roster: readonly Pick<DirectoryEmployee, 'code' | 'fullNameAr' | 'phone'>[],
): DriverDetailsPlan => {
  const plan: DriverDetailsPlan = {
    drivers: [],
    unmatchedLegacy: [],
    ambiguousLegacy: [],
    deletedRows: [],
    duplicateCodes: [],
  };

  const register = new Map<string, DetailsRow>();
  for (const row of details) {
    if (row.deleted) {
      plan.deletedRows.push(`${row.code} — ${row.name}`);
      continue;
    }
    if (register.has(row.code)) {
      plan.duplicateCodes.push(row.code);
      continue;
    }
    register.set(row.code, row);
  }

  const candidates: Candidate[] = [
    ...[...register.values()].map((row) => ({
      code: row.code,
      name: row.name,
      phones: row.phones,
    })),
    ...roster.map((employee) => ({
      code: employee.code,
      name: employee.fullNameAr,
      phones: [phoneKey(employee.phone)].filter((phone): phone is string => phone !== null),
    })),
  ];

  // The drivers book, per person. Two rows for one person keep the later licence.
  const fromBook = new Map<string, LegacyDriverRow>();
  for (const row of legacy) {
    if (row.deleted) {
      plan.deletedRows.push(row.label);
      continue;
    }
    const match = matchLegacyRow(row, candidates);
    if (match.kind === 'unmatched') {
      plan.unmatchedLegacy.push(row.label);
      continue;
    }
    if (match.kind === 'ambiguous') {
      plan.ambiguousLegacy.push(`${row.label} — ${match.codes.join(', ')}`);
      continue;
    }
    const earlier = fromBook.get(match.code);
    if (
      earlier === undefined ||
      (row.licenseDate?.getTime() ?? -Infinity) > (earlier.licenseDate?.getTime() ?? -Infinity)
    ) {
      fromBook.set(match.code, row);
    }
  }

  const codes = [...new Set([...register.keys(), ...fromBook.keys()])].sort();
  const nameOf = new Map(candidates.map((c) => [c.code, c.name]));
  for (const code of codes) {
    const reg = register.get(code);
    const book = fromBook.get(code);
    const facts: DriverFacts = {
      code,
      name: reg?.name ?? nameOf.get(code) ?? book?.name ?? code,
      job: reg?.title ?? null,
      specialization: specializationWord(reg?.specialization ?? null),
      licenseType: licenseTypeWord(reg?.licenseType ?? book?.licenseType ?? null),
      licenseExpiresAt: reg?.licenseDate ?? book?.licenseDate ?? null,
      area: reg?.area ?? book?.area ?? null,
    };
    if (hasAnyFact(facts)) plan.drivers.push(facts);
  }
  return plan;
};

// ── Applying it ─────────────────────────────────────────────────────────────────────────────

/** The five profile fields this step fills, in the order the registry shows them. */
export const FILLED_FIELDS = [
  'jobId',
  'specializationId',
  'licenseTypeId',
  'licenseExpiresAt',
  'area',
] as const;
export type FilledField = (typeof FILLED_FIELDS)[number];

export interface DriverDetailsOutcome {
  /** Profiles opened because the driver had none. */
  enrolled: number;
  /** …of which for a driver who has left — kept, and switched off (see `applyDriverDetails`). */
  enrolledExited: string[];
  /** Empty fields filled, per field. */
  filled: Record<FilledField, number>;
  /** Fields that already held exactly what the books say. */
  alreadyThere: number;
  /** Fields a person had already set to something else — left as they are. «code: field». */
  keptOnScreen: string[];
  /** Planned drivers HR has in no driving seat — «code — name». */
  notOnRegistry: string[];
  /** Catalog items this step added, «kind: name». */
  catalogCreated: string[];
  failures: { code: string; error: string }[];
}

/** «سائق» in English, for the one item the owner asked to add by name. Every other is as written. */
const ENGLISH: Readonly<Record<string, string>> = { سائق: 'Driver' };

/**
 * Each word to its catalog item's id — an existing item whose folded name is the same word, else a
 * new item under the word itself. Archived items count: the owner archiving «سائق ب» retires it
 * from the dropdown, it does not make it a different grade, and a second «سائق ب» would.
 */
const catalogResolver = (by: string, created: string[]) => {
  const cache = new Map<string, Types.ObjectId>();
  return async (kind: FleetCatalogKind, word: string): Promise<Types.ObjectId> => {
    const key = `${kind}::${fold(word)}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const existing = (await fleetCatalogItemRepository.listKind(kind)).find(
      (item) => fold(item.name.ar) === fold(word),
    );
    const item =
      existing ??
      (await fleetCatalogItemService.ensure(
        { kind, name: { ar: word, en: ENGLISH[word] ?? word }, countsForAlarm: false },
        by,
      ));
    if (existing === undefined) created.push(`${kind}: ${word}`);
    const id = item._id as Types.ObjectId;
    cache.set(key, id);
    return id;
  };
};

const sameValue = (stored: unknown, wanted: unknown): boolean =>
  stored instanceof Date && wanted instanceof Date
    ? stored.getTime() === wanted.getTime()
    : String(stored) === String(wanted);

/** The audit trail stores ids as text, as the profile service's own snapshot does. */
const auditable = (values: Partial<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value instanceof Types.ObjectId ? String(value) : value,
    ]),
  );

/**
 * Write the plan. One driver at a time and NOT in a transaction, like every go-live step: a
 * failure on one driver must not undo the ones already written, and a re-run — which finds every
 * written field no longer empty — finishes the job.
 *
 * A DRIVER WHO HAS LEFT still gets their facts («المهم تضيف كل الداتا»), on a profile opened
 * SWITCHED OFF. The screen's own «enrol» refuses a leaver because a profile is an operational
 * capability, and that stays true: an inactive profile puts nobody on a roster, and the licence
 * sweep reads active profiles only, so a leaver's lapsed licence announces nothing.
 */
export const applyDriverDetails = async (
  plan: DriverDetailsPlan,
  roster: readonly DirectoryEmployee[],
  by: string,
): Promise<DriverDetailsOutcome> => {
  const outcome: DriverDetailsOutcome = {
    enrolled: 0,
    enrolledExited: [],
    filled: { jobId: 0, specializationId: 0, licenseTypeId: 0, licenseExpiresAt: 0, area: 0 },
    alreadyThere: 0,
    keptOnScreen: [],
    notOnRegistry: [],
    catalogCreated: [],
    failures: [],
  };
  const byCode = new Map(roster.map((employee) => [employee.code, employee]));
  const idOf = catalogResolver(by, outcome.catalogCreated);
  const actor = { userId: by, ip: null, userAgent: null };
  const entityRef = (id: string) => ({
    moduleId: 'fleet',
    entityType: 'driverProfile',
    entityId: id,
  });

  for (const facts of plan.drivers) {
    const employee = byCode.get(facts.code);
    if (employee === undefined) {
      outcome.notOnRegistry.push(`${facts.code} — ${facts.name}`);
      continue;
    }
    try {
      const wanted: Partial<Record<FilledField, Types.ObjectId | Date | string>> = {};
      if (facts.job !== null) wanted.jobId = await idOf('driverJob', facts.job);
      if (facts.specialization !== null) {
        wanted.specializationId = await idOf('driverSpecialization', facts.specialization);
      }
      if (facts.licenseType !== null) {
        wanted.licenseTypeId = await idOf('driverLicenseType', facts.licenseType);
      }
      if (facts.licenseExpiresAt !== null) wanted.licenseExpiresAt = facts.licenseExpiresAt;
      if (facts.area !== null) wanted.area = facts.area;

      let profile = await fleetDriverProfileRepository.findDriverByEmployeeId(employee.employeeId);
      if (profile === null) {
        try {
          const exited = employee.status === 'exited';
          const doc = await fleetDriverProfileRepository.create(
            {
              employeeId: new Types.ObjectId(employee.employeeId),
              kind: DRIVER_PROFILE_KIND,
              licenseNumber: null,
              licenseExpiresAt: (wanted.licenseExpiresAt as Date | undefined) ?? null,
              jobId: (wanted.jobId as Types.ObjectId | undefined) ?? null,
              specializationId: (wanted.specializationId as Types.ObjectId | undefined) ?? null,
              licenseTypeId: (wanted.licenseTypeId as Types.ObjectId | undefined) ?? null,
              specialization: null,
              area: (wanted.area as string | undefined) ?? null,
              isActive: !exited,
              licenseImage: null,
            },
            { by },
          );
          outcome.enrolled += 1;
          if (exited) outcome.enrolledExited.push(`${facts.code} — ${facts.name}`);
          for (const field of FILLED_FIELDS)
            if (wanted[field] !== undefined) outcome.filled[field] += 1;
          await auditService.record({
            entityRef: entityRef(String(doc._id)),
            action: 'create',
            changes: diffChanges({}, auditable({ employeeId: employee.employeeId, ...wanted })),
            actor,
          });
          continue;
        } catch (error) {
          // Another step (the licence scans) opened this driver's profile a moment ago: fill it.
          if (!(error instanceof ConflictError)) throw error;
          profile = await fleetDriverProfileRepository.findDriverByEmployeeId(employee.employeeId);
          if (profile === null) throw error;
        }
      }

      const set: Partial<Record<FilledField, unknown>> = {};
      for (const field of FILLED_FIELDS) {
        const value = wanted[field];
        if (value === undefined) continue;
        const stored = (profile as FleetDriverProfileDoc)[field];
        if (stored != null) {
          if (sameValue(stored, value)) outcome.alreadyThere += 1;
          else outcome.keptOnScreen.push(`${facts.code}: ${field}`);
          continue;
        }
        // «Still empty» rides inside the write: a person filling this field between the read
        // above and this line keeps what they wrote.
        const written = await FleetDriverProfileModel.updateOne(
          { _id: profile._id, isDeleted: false, [field]: null },
          { $set: { [field]: value, updatedBy: new Types.ObjectId(by) }, $inc: { __v: 1 } },
        ).exec();
        if (written.modifiedCount === 1) {
          outcome.filled[field] += 1;
          set[field] = value;
        } else {
          outcome.keptOnScreen.push(`${facts.code}: ${field}`);
        }
      }
      if (Object.keys(set).length > 0) {
        await auditService.record({
          entityRef: entityRef(String(profile._id)),
          action: 'update',
          changes: diffChanges({}, auditable(set)),
          actor,
        });
      }
    } catch (error) {
      outcome.failures.push({
        code: facts.code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcome;
};
