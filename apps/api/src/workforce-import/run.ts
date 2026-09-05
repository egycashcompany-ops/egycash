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
  type ImportedPeriod,
} from '../modules/hr/employee-management/employees';
import { raiseEmployeeSequenceTo } from '../modules/hr/employee-management/employees/employee-sequence';
import { logger } from '../infrastructure/logging/logger';
import { type AuthContext } from '../shared/types';
import { readWorkbook } from './read-workbook';
import { buildPlan, type PersonPlan, type Rejection, type SourceRow } from './plan';
import { OrgResolver, deriveBranchCodes } from './org';
import { maritalStatus } from './vocabulary';
import { type MaritalStatus } from '@ecms/contracts';

export interface ImportReport {
  mode: 'dry-run' | 'write';
  fingerprints: { sheet: string; fingerprint: string }[];
  branchCodes: Record<string, string>;
  counts: {
    rowsRead: number;
    people: number;
    serving: number;
    exited: number;
    imported: number;
    alreadyPresent: number;
    failed: number;
    branchesCreated: number;
    departmentsCreated: number;
    sectionsCreated: number;
    jobTitlesCreated: number;
  };
  /** Rows that were not imported, each with the reason and the row a human can go and open. */
  rejected: (Rejection | { sheet: string; rowNumber: number; code: string | null; reason: string })[];
  orgProblems: { what: string; detail: string }[];
  ambiguousSites: { site: string; counts: Record<string, number> }[];
}

export const runImport = async (opts: {
  file: string;
  write: boolean;
  actorId: string;
}): Promise<ImportReport> => {
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
  const resolver = new OrgResolver(codes, opts.actorId, !opts.write);

  const rejected: ImportReport['rejected'] = [...plan.rejected];
  let imported = 0;
  let alreadyPresent = 0;
  let failed = 0;

  for (const person of plan.people) {
    try {
      const outcome = await importPerson(person, resolver, opts);
      if (outcome === 'imported') imported += 1;
      else if (outcome === 'already-present') alreadyPresent += 1;
      else {
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

  if (opts.write) await advanceSequencePast(plan.people);

  return {
    mode: opts.write ? 'write' : 'dry-run',
    fingerprints: read.fingerprints,
    branchCodes: Object.fromEntries(codes),
    counts: {
      rowsRead: read.rows.length,
      people: plan.people.length,
      serving: plan.people.filter((p) => p.serving).length,
      exited: plan.people.filter((p) => !p.serving).length,
      imported,
      alreadyPresent,
      failed,
      branchesCreated: resolver.created.branches,
      departmentsCreated: resolver.created.departments,
      sectionsCreated: resolver.created.sections,
      jobTitlesCreated: resolver.created.jobTitles,
    },
    rejected,
    orgProblems: resolver.problems,
    ambiguousSites: ambiguous,
  };
};

type Outcome = 'imported' | 'already-present' | { reason: string };

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
  opts: { write: boolean; actorId: string },
): Promise<Outcome> => {
  // Idempotence: the code is the identity, and a re-run must not create a second copy of anybody.
  //
  // Asked of EVERY state, not just the live ones, because that is what `ux_code` enforces: a
  // soft-deleted employee still holds its code. Checking only live rows would report the code free
  // and then fail the insert on the index, which is an unreadable `Duplicate resource` where a
  // named reason belongs.
  const existing = await employeeRepository.findByCodeAnyState(person.code);
  if (existing !== null) {
    if (existing.isDeleted !== true) return 'already-present';
    return {
      reason:
        `code ${person.code} is held by a DELETED employee record, which still occupies it in the ` +
        'unique index. Restore that record or purge it, then re-run.',
    };
  }

  const org = await resolver.resolve(person.current);
  if (org === null) {
    return { reason: `could not place this person in the organization (site/department/job title)` };
  }
  if (!opts.write) return 'imported'; // the dry run counts what it would do, and does none of it

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

  const closed: ImportedPeriod[] = person.spells
    .filter((s) => s.exit !== null && s.exit.effectiveDate !== null && s.exit.type !== null)
    .map((s) => ({
      hiredAt: s.hiredAt as Date,
      exitedAt: s.exit?.effectiveDate as Date,
      exitType: s.exit?.type as NonNullable<NonNullable<SourceRow['exit']>['type']>,
      // The exit note is kept where somebody will read it — `ملاحظات` is the only place the sheet
      // records why a departure went the way it did.
      reason: [s.exit?.reason, s.exit?.note].filter((v) => v != null && v !== '').join(' — ') || null,
    }));

  await applyImportedHistory(String(doc._id), {
    closed,
    current: person.serving ? { hiredAt: person.current.hiredAt as Date } : null,
  });

  return 'imported';
};

/** The personal block, with the fields the sheet actually carries. */
const personalOf = (row: SourceRow) => ({
  identity: {
    fullNameAr: row.fullNameAr as string,
    ...(row.fullNameEn === null ? {} : { fullNameEn: row.fullNameEn }),
    // Guaranteed by the planner, which refuses a row without one. The service derives birth date,
    // gender and place of birth FROM it — the sheet's own values for those are never sent, so the
    // registry and the national ID cannot disagree.
    nationalId: row.nationalId as string,
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
