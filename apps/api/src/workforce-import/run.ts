// The import run: read → plan → resolve the org → write, and a report of everything either way.
//
// Separated from the CLI so the sequence is testable and so the CLI stays argument parsing. The one
// rule that shapes the whole file: a dry run and a real run take the SAME path and differ only in
// whether writes happen, because a dry run that walked a different path would be reassuring about
// something nobody is going to do.
import {
  employeeService,
  employeeRepository,
  applyImportedHistory,
  applyImportedExit,
  applyImportedUpdate,
  type ImportedPeriod,
} from '../modules/hr/employee-management/employees';
import { raiseEmployeeSequenceTo } from '../modules/hr/employee-management/employees/employee-sequence';
import { logger } from '../infrastructure/logging/logger';
import { auditService } from '../platform/audit';
import { Types } from 'mongoose';
import { type AuthContext } from '../shared/types';
import { readWorkbook, type WorkbookSource } from './read-workbook';
import { buildPlan, type PersonPlan, type Rejection, type SourceRow } from './plan';
import { OrgResolver, deriveBranchCodes } from './org';
import { maritalStatus } from './vocabulary';
import {
  diffPerson,
  setFrom,
  OBJECT_ID_PATHS,
  type ExistingEmployee,
  type FieldChange,
  type RefusedChange,
} from './sync';
import { type EmployeeExitType, type MaritalStatus } from '@ecms/contracts';

/**
 * The kinds of write an upload can make, each of which the operator agrees to separately.
 *
 * Separate because they are different decisions with different weight. Adding somebody the file
 * names and the registry does not is nearly always right. Recording that a leaver has left is
 * nearly always right. Rewriting the personal data of two thousand people already on file is not
 * obviously right at all — it depends on whether this export is more current than the registry —
 * so it is offered rather than assumed.
 */
export type ImportAction = 'added' | 'updated' | 'exited';

export const ALL_IMPORT_ACTIONS: readonly ImportAction[] = ['added', 'updated', 'exited'];

/** One person the file would change, and how — what the preview shows and the result confirms. */
export interface PersonUpdate {
  code: string;
  name: string;
  changes: { path: string; from: string; to: string }[];
}

/** Somebody the file says has left, who the registry still has on the books. */
export interface PersonExit {
  code: string;
  name: string;
  /** The last day of service, as the Resignation sheet records it. */
  effectiveDate: string;
  reason: string | null;
}

export interface ImportReport {
  /** Which kinds of write actually happened. Empty is a preview: nothing was touched. */
  applied: ImportAction[];
  mode: 'dry-run' | 'write';
  fingerprints: { sheet: string; fingerprint: string }[];
  branchCodes: Record<string, string>;
  counts: {
    rowsRead: number;
    people: number;
    serving: number;
    exited: number;
    imported: number;
    /** Already in the registry AND identical to the file — read, compared, left alone. */
    unchanged: number;
    /** Already in the registry and differing — updated, or listed by a dry run. */
    updated: number;
    /** On the Resignation sheet, and still on the books here — their exit is waiting to be recorded. */
    exits: number;
    failed: number;
    branchesCreated: number;
    departmentsCreated: number;
    sectionsCreated: number;
    jobTitlesCreated: number;
  };
  /** Rows that were not imported, each with the reason and the row a human can go and open. */
  rejected: (Rejection | { sheet: string; rowNumber: number; code: string | null; reason: string })[];
  /** Who would change and how. Capped for the report; `counts.updated` is the real total. */
  updates: PersonUpdate[];
  /** People the file is newly adding, by code — so a preview can be read before it is agreed to. */
  additions: { code: string; name: string }[];
  /** Leavers whose exit the file would record. */
  exits: PersonExit[];
  /** Changes the file asks for that this importer will not make, each with its reason. */
  refused: { code: string; path: string; from: string; to: string; reason: string }[];
  orgProblems: { what: string; detail: string }[];
  ambiguousSites: { site: string; counts: Record<string, number> }[];
}

/**
 * How many changed people the report names one by one.
 *
 * A preview of 2,600 updates is not a preview — nobody reads it, and shipping it to a browser turns
 * a confirmation dialog into a several-megabyte download. The count above is always the whole truth;
 * this is how much of the detail travels with it, and the UI says when it is showing a sample.
 */
export const UPDATE_SAMPLE = 200;

export const runImport = async (opts: {
  file: string | WorkbookSource;
  /**
   * What to actually write. An EMPTY set is the preview: every person is read and compared and the
   * report says exactly what would happen, and nothing is written — the same path, so a preview can
   * never be reassuring about something a run would do differently.
   */
  apply: ReadonlySet<ImportAction>;
  actorId: string;
}): Promise<ImportReport> => {
  const writes = opts.apply.size > 0;
  const read = await readWorkbook(opts.file);
  if ('errors' in read) {
    throw new Error(
      `the workbook does not have the expected layout:\n  ${read.errors
        .map((e) => `${e.sheet}: ${e.problem}`)
        .join('\n  ')}`,
    );
  }

  const plan = buildPlan(read.rows);
  const { codes, ambiguous } = deriveBranchCodes(read.rows);
  // The org structure is only created for real when somebody is actually being added — a preview,
  // or a run that only records exits, has no business minting a department.
  const resolver = new OrgResolver(codes, opts.actorId, !opts.apply.has('added'));

  const rejected: ImportReport['rejected'] = [...plan.rejected];
  const updates: PersonUpdate[] = [];
  const additions: ImportReport['additions'] = [];
  const exits: PersonExit[] = [];
  const refusedChanges: ImportReport['refused'] = [];
  let imported = 0;
  let unchanged = 0;
  let updated = 0;
  let exitCount = 0;
  let failed = 0;

  const named = (person: PersonPlan) => ({
    code: person.code,
    name: person.current.fullNameAr ?? person.code,
  });

  for (const person of plan.people) {
    try {
      const outcome = await importPerson(person, resolver, opts);
      for (const r of outcome.refused ?? []) refusedChanges.push({ code: person.code, ...r });

      switch (outcome.kind) {
        case 'added':
          imported += 1;
          if (additions.length < UPDATE_SAMPLE) additions.push(named(person));
          break;
        case 'unchanged':
          unchanged += 1;
          break;
        case 'updated':
          updated += 1;
          if (updates.length < UPDATE_SAMPLE) {
            updates.push({
              ...named(person),
              changes: outcome.changes.map((c) => ({ path: c.path, from: c.from, to: c.to })),
            });
          }
          break;
        case 'exited':
          exitCount += 1;
          if (exits.length < UPDATE_SAMPLE) {
            exits.push({
              ...named(person),
              effectiveDate: outcome.exit.effectiveDate.toISOString().slice(0, 10),
              reason: outcome.exit.reason,
            });
          }
          break;
        default:
          failed += 1;
          rejected.push({
            sheet: person.current.sheet,
            rowNumber: person.current.rowNumber,
            code: person.code,
            reason: outcome.reason,
          });
      }
    } catch (error) {
      // One bad person must not end the run: 2,638 imported plus a named failure beats an
      // exception with 2,639 unknown outcomes behind it.
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      rejected.push({
        sheet: person.current.sheet,
        rowNumber: person.current.rowNumber,
        code: person.code,
        reason,
      });
      logger.warn({ code: person.code, err: error }, 'workforce import: person failed');
    }
  }

  // Only after somebody was actually added: the counter guards against a future hire colliding with
  // an imported code, and nothing was imported unless `added` was agreed to.
  if (opts.apply.has('added')) await advanceSequencePast(plan.people);

  return {
    applied: [...opts.apply],
    mode: writes ? 'write' : 'dry-run',
    fingerprints: read.fingerprints,
    branchCodes: Object.fromEntries(codes),
    counts: {
      rowsRead: read.rows.length,
      people: plan.people.length,
      serving: plan.people.filter((p) => p.serving).length,
      exited: plan.people.filter((p) => !p.serving).length,
      imported,
      unchanged,
      updated,
      exits: exitCount,
      failed,
      branchesCreated: resolver.created.branches,
      departmentsCreated: resolver.created.departments,
      sectionsCreated: resolver.created.sections,
      jobTitlesCreated: resolver.created.jobTitles,
    },
    rejected,
    updates,
    additions,
    exits,
    refused: refusedChanges,
    orgProblems: resolver.problems,
    ambiguousSites: ambiguous,
  };
};

/**
 * What happened, or would happen, to one person. Exactly one kind each — a person appears in one
 * card on the screen and is agreed to once.
 *
 * `exited` WINS over `updated` when both are true. Somebody the roster has moved to the Resignation
 * sheet has left, and that is the fact about them worth agreeing to; their field changes ride along
 * with it, because a record you are already writing should not be left half stale.
 */
type Outcome =
  | { kind: 'added'; refused?: RefusedChange[] }
  | { kind: 'unchanged'; refused: RefusedChange[] }
  | { kind: 'updated'; changes: FieldChange[]; refused: RefusedChange[] }
  | {
      kind: 'exited';
      changes: FieldChange[];
      refused: RefusedChange[];
      exit: { type: EmployeeExitType; effectiveDate: Date; reason: string | null };
    }
  | { kind: 'failed'; reason: string; refused?: RefusedChange[] };

/**
 * The context the import acts as — the seed admin, so every audited write is attributable to a
 * real account rather than to nobody. `sessionId: 'workforce-import'` is what the audit trail will
 * show, which is the honest answer to "who created these 2,600 employees".
 */
const importContext = (actorId: string): AuthContext => ({
  userId: actorId,
  sessionId: 'workforce-import',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {
    'employee.registerDirect': 'organization',
    'employee.manageInsurance': 'organization',
    'employee.manageOfficer': 'organization',
  },
  permissionVersion: 0,
  isPrivileged: true,
});

/**
 * One person: create them in the state they are in TODAY, then write the history behind them.
 *
 * Order matters and is the opposite of the obvious one. The employee is registered from their
 * CURRENT row — the job, site and personal data they have now — and the earlier spells are then
 * recorded as closed periods. Replaying spells forward through the actions engine would be the
 * intuitive shape and is wrong twice over: it synthesizes decisions nobody made, and each exit
 * notifies every holder of `employee.view` in the organization, 967 times.
 */
const importPerson = async (
  person: PersonPlan,
  resolver: OrgResolver,
  opts: { apply: ReadonlySet<ImportAction>; actorId: string },
): Promise<Outcome> => {
  // Idempotence: the code is the identity, and a re-run must not create a second copy of anybody.
  //
  // Asked of EVERY state, not just the live ones, because that is what `ux_code` enforces: a
  // soft-deleted employee still holds its code. Checking only live rows would report the code free
  // and then fail the insert on the index, which is an unreadable `Duplicate resource` where a
  // named reason belongs.
  const existing = await employeeRepository.findByCodeAnyState(person.code);
  if (existing !== null && existing.isDeleted === true) {
    return {
      kind: 'failed',
      reason:
        `code ${person.code} is held by a DELETED employee record, which still occupies it in the ` +
        'unique index. Restore that record or purge it, then re-run.',
    };
  }

  const org = await resolver.resolve(person.current);
  if (org === null) {
    return {
      kind: 'failed',
      reason: `could not place this person in the organization (site/department/job title)`,
    };
  }

  // ALREADY HERE — so this is an update, not a second copy of somebody. What the file has nothing
  // to say about is not in the diff at all, so it cannot be touched; see `sync.ts`.
  if (existing !== null) {
    return updatePerson(existing as unknown as ExistingEmployee & { _id: unknown }, person, org, opts);
  }

  // Counted either way; written only when adding was agreed to.
  if (!opts.apply.has('added')) return { kind: 'added' };

  const row = person.current;
  const { doc } = await employeeService.registerDirect(
    importContext(opts.actorId),
    {
      personal: personalOf(row),
      employment: {
        jobTitleId: org.jobTitleId,
        departmentId: org.departmentId,
        sectionId: org.sectionId,
        branchId: org.branchId,
        employmentType: 'fullTime',
        // Never from the insurance block: those figures are statutory brackets, not pay.
        salary: null,
        allowances: row.incentive === null ? [] : [{ name: 'حافز', amount: row.incentive, currency: 'EGP' }],
        benefits: [],
        // Tenured staff are not on probation — they have been here for years.
        probationMonths: 0,
        startDate: row.hiredAt as Date,
      },
      hiringDate: row.hiredAt as Date,
      entryStatus: 'active',
      insurance: {
        insuranceNumber: row.insurance.insuranceNumber,
        occupation: row.insurance.occupation,
        occupationCode: row.insurance.occupationCode,
        grossWage: row.insurance.grossWage,
        contributionWage: row.insurance.contributionWage,
        basicWage: row.insurance.basicWage,
        employerShare: row.insurance.employerShare,
        employeeShare: row.insurance.employeeShare,
        status: row.insurance.status,
      },
      officer: {
        reserveOfficer: row.officer.reserveOfficer,
        rank: row.officer.rank,
        weaponLicense:
          row.officer.weaponLicenseType === null
            ? null
            : { type: row.officer.weaponLicenseType, expiry: row.officer.weaponLicenseExpiry },
        professionPractice: row.officer.professionPractice,
        retirementDate: row.officer.retirementDate,
      },
    },
    { scope: 'organization', userId: opts.actorId, branchId: null, departmentId: null, sectionId: null },
    { provisionLogin: false, identity: { code: person.code, employeeNumber: person.employeeNumber } },
  );

  const closed = closedPeriodsOf(person);

  await applyImportedHistory(String(doc._id), {
    closed,
    current: person.serving ? { hiredAt: person.current.hiredAt as Date } : null,
  });

  return { kind: 'added' };
};

/** The closed spells behind somebody, oldest first — the same shape creation and exit both need. */
const closedPeriodsOf = (person: PersonPlan): ImportedPeriod[] =>
  person.spells
    .filter((s) => s.exit !== null && s.exit.effectiveDate !== null && s.exit.type !== null)
    .map((s) => ({
      hiredAt: s.hiredAt as Date,
      exitedAt: s.exit?.effectiveDate as Date,
      exitType: s.exit?.type as NonNullable<NonNullable<SourceRow['exit']>['type']>,
      // The exit note is kept where somebody will read it — `ملاحظات` is the only place the sheet
      // records why a departure went the way it did.
      reason: [s.exit?.reason, s.exit?.note].filter((v) => v != null && v !== '').join(' — ') || null,
    }));

/**
 * Bring somebody already in the registry into line with the file.
 *
 * The history is deliberately NOT rewritten here. A roster export names where a person is today; it
 * does not restate when they were hired or how a spell ended, and `applyImportedHistory` recomputes
 * the whole `employmentPeriods`/`exit`/`status` triple from the sheet. Running that over a record
 * HR has since corrected would overwrite the correction with the spreadsheet's version of the past.
 * Creation loads history once, from a registry that had none; an update leaves it alone.
 */
const updatePerson = async (
  existing: ExistingEmployee & { _id: unknown },
  person: PersonPlan,
  org: { branchId: string; departmentId: string; sectionId: string | null; jobTitleId: string },
  opts: { apply: ReadonlySet<ImportAction>; actorId: string },
): Promise<Outcome> => {
  const diff = diffPerson(existing, person.current, org);
  const leaving = pendingExit(existing, person);

  // A REHIRE — exited here, serving in the file. Reported and not applied: bringing somebody back
  // is a decision with a start date, a job and a rehire eligibility check behind it, and the system
  // has a Rehire action that asks for all three. A spreadsheet row is not that decision.
  if (person.serving && existing.status === 'exited') {
    return {
      kind: 'unchanged',
      refused: [
        ...diff.refused,
        {
          path: 'status',
          from: 'exited',
          to: 'active',
          reason:
            'the file lists this person as serving but the registry has them exited — bringing ' +
            'somebody back is a Rehire, which records a decision an upload cannot make',
        },
      ],
    };
  }

  if (leaving !== null) {
    if (opts.apply.has('exited')) {
      await writeChanges(existing, person, diff.changes, opts.actorId);
      await applyImportedExit(String(existing._id), leaving, opts.actorId);
      await auditImportedUpdate(
        String(existing._id),
        person.code,
        [
          {
            path: 'status',
            from: String(existing.status ?? '—'),
            to: 'exited',
            value: 'exited',
          },
          ...diff.changes,
        ],
        opts.actorId,
      );
    }
    return { kind: 'exited', changes: diff.changes, refused: diff.refused, exit: leaving };
  }

  if (diff.changes.length === 0) return { kind: 'unchanged', refused: diff.refused };
  if (opts.apply.has('updated')) {
    await writeChanges(existing, person, diff.changes, opts.actorId);
    await auditImportedUpdate(String(existing._id), person.code, diff.changes, opts.actorId);
  }
  return { kind: 'updated', changes: diff.changes, refused: diff.refused };
};

/**
 * The exit this file records for somebody the registry still has on the books — or null.
 *
 * Null when the person is still serving in the file, when the registry has already exited them, or
 * when the Resignation row carries no usable exit date. The last is a cell to fill in, not a
 * departure to invent a date for.
 */
const pendingExit = (
  existing: ExistingEmployee,
  person: PersonPlan,
): { type: EmployeeExitType; effectiveDate: Date; reason: string | null } | null => {
  if (person.serving || existing.status === 'exited') return null;
  const last = closedPeriodsOf(person).at(-1);
  if (last === undefined) return null;
  return { type: last.exitType, effectiveDate: last.exitedAt, reason: last.reason };
};

/** Apply the field changes, casting the ids the document stores as ObjectIds. */
const writeChanges = async (
  existing: { _id: unknown },
  person: PersonPlan,
  changes: readonly FieldChange[],
  actorId: string,
): Promise<void> => {
  void person;
  if (changes.length === 0) return;
  const set = setFrom(changes);
  for (const path of Object.keys(set)) {
    // The document stores these as ObjectIds; the diff carries the string the resolver returned.
    if (OBJECT_ID_PATHS.has(path) && typeof set[path] === 'string') {
      set[path] = new Types.ObjectId(set[path] as string);
    }
  }
  await applyImportedUpdate(String(existing._id), set, actorId);
};

/** The trail that says a person uploaded a file and what it moved — one entry, not one per field. */
const auditImportedUpdate = async (
  employeeId: string,
  code: string,
  changes: readonly FieldChange[],
  actorId: string,
): Promise<void> => {
  await auditService.record({
    entityRef: { moduleId: 'hr', entityType: 'employee', entityId: employeeId },
    action: 'update',
    actor: { userId: actorId, ip: null, userAgent: null },
    // One entry naming every field that moved, rather than one entry per field: the reader wants
    // "this upload changed these six things about this person", not six disconnected rows.
    changes: [
      { field: 'source', old: null, new: `workforce-import (${code})` },
      ...changes.map((c) => ({ field: c.path, old: c.from, new: c.to })),
    ],
  });
};

/** The personal block, with the fields the sheet actually carries. */
const personalOf = (row: SourceRow) => ({
  identity: {
    fullNameAr: row.fullNameAr as string,
    ...(row.fullNameEn === null ? {} : { fullNameEn: row.fullNameEn }),
    // OMITTED, not nulled, when the company holds no national ID: the service keys every use of it
    // on `!== undefined` and stores `null`, so leaving the key out is what records "we do not have
    // one". Sending a placeholder would be worse than sending nothing — the service DERIVES birth
    // date, gender and place of birth from this number, so a made-up one would manufacture three
    // more facts about a real person and file them as if they were true.
    ...(row.nationalId === null ? {} : { nationalId: row.nationalId }),
    nationality: 'Egyptian',
    ...(maritalStatus(row.maritalStatus) === null
      ? {}
      : { maritalStatus: maritalStatus(row.maritalStatus) as MaritalStatus }),
    ...(row.religion === null ? {} : { religion: row.religion }),
    ...(row.nationalIdExpiry === null ? {} : { nationalIdExpiry: row.nationalIdExpiry }),
  },
  contact: {
    // The registry requires a primary phone. 3% of rows have none, and `N/A` is the placeholder the
    // existing employee migration already uses for exactly this — a person with no recorded phone.
    primaryPhone: row.primaryPhone ?? 'N/A',
    // The emergency contact has no home of its own; the second phone slot is where it can live
    // without being lost, and the import report says so.
    ...(row.emergencyPhone === null ? {} : { secondaryPhone: row.emergencyPhone }),
  },
  // The sheet carries one free-text address line plus a governorate. `city` has no column of its
  // own, so the governorate answers both rather than a city being invented for 2,600 people.
  ...(row.addressLine === null || row.governorate === null
    ? {}
    : {
        currentAddress: {
          line1: row.addressLine,
          city: row.governorate,
          governorate: row.governorate,
        },
      }),
  ...(row.military.status === null
    ? {}
    : {
        military: {
          status: row.military.status,
          ...(row.military.certificateRef === null ? {} : { certificateRef: row.military.certificateRef }),
          ...(row.military.completedAt === null ? {} : { completedAt: row.military.completedAt }),
        },
      }),
  ...(row.education.level === null
    ? {}
    : {
        education: {
          level: row.education.level,
          ...(row.education.institution === null ? {} : { institution: row.education.institution }),
          ...(row.education.specialization === null
            ? {}
            : { specialization: row.education.specialization }),
          ...(row.education.graduationYear === null
            ? {}
            : { graduationYear: row.education.graduationYear }),
        },
      }),
  experience: [],
  drivingLicenses:
    row.drivingLicenseExpiry === null
      ? []
      : // The sheet records an expiry but never a class. `—` says "a licence, class not recorded"
        // rather than inventing one the employee may not hold.
        [{ class: '—', expiry: row.drivingLicenseExpiry }],
  // `certifications` is the only list that can hold the SECOND qualification without losing it:
  // `education` is one object, so a person with a master's on top of a bachelor's would otherwise
  // keep whichever the importer chose. Both are kept, and the extra one says so in full.
  certifications: [
    ...(row.additionalQualification.qualification === null
      ? []
      : [
          [
            row.additionalQualification.qualification,
            row.additionalQualification.institution,
            row.additionalQualification.year === null
              ? null
              : String(row.additionalQualification.year),
          ]
            .filter((v) => v !== null && v !== '')
            .join(' — '),
        ]),
    ...(row.hasPriorExperience ? ['خبرة سابقة'] : []),
  ],
  references: [],
});

/**
 * Push the global counter past every number the import used.
 *
 * Without this the next real hire is allocated `0001` and collides with an imported employee on
 * `ux_code` — the import would look fine and hiring would break the following week.
 */
const advanceSequencePast = async (people: readonly PersonPlan[]): Promise<void> => {
  const highest = people.reduce((max, p) => Math.max(max, Number(p.employeeNumber)), 0);
  if (highest === 0) return;
  await raiseEmployeeSequenceTo(highest);
  logger.info({ highest }, 'employee sequence raised past the imported numbers');
};
