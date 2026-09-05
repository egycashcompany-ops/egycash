// One-time boot migration to the Employee-registry shape (frozen design §10). Idempotent:
// only touches documents that predate the registry (detected by a missing `origin` field);
// safe on every boot. Mapping:
//   - `terminated` → `exited` + a termination-typed exit subdocument (from the last status
//     event; `eligibleForRehire: false` — legacy terminations recorded no decision).
//   - `origin: 'recruitment'`, one employment period from `hiredAt`, `probation: null`
//     (no retroactive probation for existing actives).
//   - `personal` copied ONCE from the linked applicant's RAW document (nationalId raw —
//     masking stays a DTO concern), with a minimal placeholder if the applicant is gone.
//   - A `hire` Personnel Action (seq 1) is synthesized so every history starts uniformly;
//     `statusHistory[0]` is linked to it and the trail is frozen thereafter.
import { type Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logging/logger';
import { normalizeArabic } from '../../shared/arabic';
import { applicantService } from '../../recruitment/applicants';
// Deliberately NOT the employee-actions barrel: the barrel pulls in the actions service,
// which imports this feature's barrel — the repository file alone keeps the graph acyclic.
import { employeeActionRepository } from '../employee-actions/employee-action.repository';
import { EmployeeModel, type EmployeePersonalData } from './employee.model';

interface LegacyEmployee {
  _id: Types.ObjectId;
  code: string;
  status: string;
  hiredAt: Date;
  updatedAt: Date;
  applicantId?: Types.ObjectId | null;
  applicantCode?: string | null;
  statusHistory?: {
    from: string | null;
    to: string;
    reason: string | null;
    effectiveDate: Date;
    at: Date;
    by: Types.ObjectId | null;
  }[];
}

const placeholderPersonal = (nameFallback: string): EmployeePersonalData => ({
  fullNameAr: nameFallback,
  fullNameEn: null,
  searchName: normalizeArabic(nameFallback),
  nationalId: null,
  birthDate: null,
  gender: null,
  nationality: 'Egyptian',
  placeOfBirth: null,
  photoFileId: null,
  maritalStatus: null,
  religion: null,
  nationalIdExpiry: null,
  dependentsCount: null,
  contact: { primaryPhone: 'N/A', secondaryPhone: null, email: null, preferredContactChannel: null },
  officialAddress: null,
  currentAddress: null,
  military: null,
  education: null,
  experience: [],
  drivingLicenses: [],
  certifications: [],
  references: [],
});

/** Build the owned personal snapshot from the applicant's raw document (frozen design I5). */
export const personalFromApplicant = (a: {
  fullNameAr: string;
  fullNameEn: string | null;
  searchName: string;
  nationalId: string | null;
  birthDate: Date | null;
  gender: EmployeePersonalData['gender'];
  nationality: string;
  placeOfBirth: string | null;
  photoFileId: Types.ObjectId | null;
  maritalStatus: EmployeePersonalData['maritalStatus'];
  religion: string | null;
  nationalIdExpiry: Date | null;
  dependentsCount: number | null;
  contact: EmployeePersonalData['contact'];
  officialAddress: EmployeePersonalData['officialAddress'];
  currentAddress: EmployeePersonalData['currentAddress'];
  military: EmployeePersonalData['military'];
  education: EmployeePersonalData['education'];
  experience: EmployeePersonalData['experience'];
  drivingLicenses: EmployeePersonalData['drivingLicenses'];
  certifications: string[];
  references: EmployeePersonalData['references'];
}): EmployeePersonalData => ({
  fullNameAr: a.fullNameAr,
  fullNameEn: a.fullNameEn,
  searchName: a.searchName,
  nationalId: a.nationalId,
  birthDate: a.birthDate,
  gender: a.gender,
  nationality: a.nationality,
  placeOfBirth: a.placeOfBirth,
  photoFileId: a.photoFileId,
  maritalStatus: a.maritalStatus,
  religion: a.religion,
  nationalIdExpiry: a.nationalIdExpiry,
  dependentsCount: a.dependentsCount,
  contact: { ...a.contact },
  officialAddress: a.officialAddress === null ? null : { ...a.officialAddress },
  currentAddress: a.currentAddress === null ? null : { ...a.currentAddress },
  military: a.military === null ? null : { ...a.military },
  education: a.education === null ? null : { ...a.education },
  experience: a.experience.map((e) => ({ ...e })),
  drivingLicenses: a.drivingLicenses.map((d) => ({ ...d })),
  certifications: [...a.certifications],
  references: a.references.map((r) => ({ ...r })),
});

/**
 * Drop the legacy UNIQUE index on `employeeNumber` so the schema's plain `ix_employeeNumber` can
 * take over (ADR-017 — see the index comment in `employee.model.ts` for why it is relaxed).
 *
 * `autoIndex` is off outside development, and in any case Mongo will not silently downgrade a
 * built unique index because a declaration changed: the old definition has to be dropped.
 *
 * MATCHED BY SHAPE, NOT BY NAME. The first version of this looked for the name `ux_employeeNumber`
 * and nothing else, which is only the name this repository happens to declare today. A database
 * whose index was built before the schema named it carries Mongo's own default, `employeeNumber_1`
 * — the migration walked straight past it, the unique constraint survived, and the go-live import
 * then failed on the 148 people who legitimately share a global number. Any unique index keyed on
 * exactly `employeeNumber` is the legacy one, whatever it is called.
 *
 * A no-op from the second boot onward, and on a fresh install where no such index existed.
 */
export const migrateEmployeeNumberIndex = async (): Promise<void> => {
  try {
    const indexes = await EmployeeModel.collection.indexes();
    const legacy = indexes.filter((ix) => {
      if (ix.unique !== true) return false;
      const keys = Object.keys(ix.key ?? {});
      return keys.length === 1 && keys[0] === 'employeeNumber';
    });
    if (legacy.length === 0) return;
    for (const ix of legacy) {
      if (typeof ix.name !== 'string') continue;
      await EmployeeModel.collection.dropIndex(ix.name);
      logger.info(
        { index: ix.name },
        'employees: legacy unique index on employeeNumber dropped — the global number may repeat',
      );
    }
    await EmployeeModel.createIndexes();
  } catch (error) {
    // A missing collection (fresh install) is fine — autoIndex/createIndexes builds the new shape.
    logger.warn({ err: error }, 'employees: employeeNumber index migration skipped');
  }
};

export const migrateEmployeesToRegistry = async (): Promise<number> => {
  const legacy = (await EmployeeModel.collection
    .find({ origin: { $exists: false } })
    .toArray()) as unknown as LegacyEmployee[];
  for (const doc of legacy) {
    const id = doc._id;
    const applicant =
      doc.applicantId == null ? null : await applicantService.findByIdSystem(String(doc.applicantId));
    const personal =
      applicant === null
        ? placeholderPersonal(doc.applicantCode ?? doc.code)
        : personalFromApplicant(applicant);

    const history = doc.statusHistory ?? [];
    const last = history.length > 0 ? history[history.length - 1] : undefined;
    const wasTerminated = doc.status === 'terminated';
    const exit = wasTerminated
      ? {
          type: 'termination' as const,
          reason: last?.reason ?? null,
          effectiveDate: last?.effectiveDate ?? doc.updatedAt,
          eligibleForRehire: false,
          by: last?.by ?? null,
        }
      : null;

    // Synthesize the hire action (idempotent via the unique (employeeId, seq) index).
    const hireAction = await employeeActionRepository.ensureHireAction({
      employeeId: id,
      employeeCode: doc.code,
      hiredAt: doc.hiredAt,
      by: history[0]?.by ?? null,
    });

    const linkedHistory = history.map((h, i) => ({
      ...h,
      actionId: i === 0 ? hireAction._id : null,
    }));

    await EmployeeModel.collection.updateOne(
      { _id: id },
      {
        $set: {
          origin: 'recruitment',
          personal,
          probation: null,
          exit,
          employmentPeriods: [
            {
              hiredAt: doc.hiredAt,
              exitedAt: exit === null ? null : exit.effectiveDate,
              exitType: exit === null ? null : exit.type,
            },
          ],
          actionSeq: 1,
          statusHistory: linkedHistory,
          ...(wasTerminated ? { status: 'exited' } : {}),
        },
      },
    );
  }
  return legacy.length;
};
