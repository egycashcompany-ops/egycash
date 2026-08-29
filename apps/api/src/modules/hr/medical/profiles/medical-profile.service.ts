// The health profile: reading it, recording it, and leaving a trace of both (P-HR-MED D3, D5, D14).
//
// THE READ IS AUDITED, AND IT IS THE ONLY AUDITED READ IN THIS PLATFORM. Everywhere else «who
// changed it» is the question, and a read leaves no trace because the harm from an unauthorized
// look at a leave balance is recoverable and small. A clinical record is neither: it cannot be
// un-seen, the person it describes may never know, and the duty to be able to say who looked
// outlives any one employment.
//
// It is audited even when it returns NOTHING. «Somebody went looking» is the fact worth keeping,
// and a lookup that found no profile is the same act as one that found one — recording only the
// hits would make the log a list of people who HAVE conditions, which is the opposite of the point.
import {
  type ListMedicalProfilesQuery,
  type Paginated,
  type UpsertMedicalProfile,
} from '@ecms/contracts';
import { NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { diffChanges } from '../../../../shared/utils/diff';
import { employeeRepository } from '../../employee-management/employees/employee.repository';
import { medicalProfileRepository } from '../medical.repository';
import { type MedicalProfileDoc } from './medical-profile.model';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'medicalProfile',
  entityId: id,
});

/**
 * What the audit row records about a read.
 *
 * THE EMPLOYEE, NEVER THE CONTENT. An audit row saying «read Ahmed's profile: diabetic» would put
 * the clinical fact into a second collection with a different permission model — one whose whole
 * purpose is to be widely readable by administrators. The log answers «who looked at whom», which
 * is what D14 is for.
 */
const readRef = (employeeId: string) => ({
  moduleId: 'hr',
  entityType: 'medicalProfile',
  entityId: employeeId,
});

const snapshot = (doc: MedicalProfileDoc) => ({
  bloodType: doc.bloodType,
  chronicConditions: doc.chronicConditions.join(' | '),
  allergies: doc.allergies.join(' | '),
  hasDisability: String(doc.hasDisability),
  disabilityNote: doc.disabilityNote,
  note: doc.note,
});

class MedicalProfileService {
  async list(
    query: ListMedicalProfilesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<MedicalProfileDoc>> {
    return medicalProfileRepository.listFiltered(
      { employeeId: query.employeeId, search: query.search },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  /**
   * One person's profile, and the audit row that says somebody asked (D14).
   *
   * Null rather than a 404 when nothing is recorded: «no profile» is an ordinary answer about an
   * employee nobody has written anything about, not a missing resource. The screen shows an empty
   * form; a 404 would make it show an error for the normal case.
   */
  async getByEmployee(ctx: AuthContext, employeeId: string): Promise<MedicalProfileDoc | null> {
    const doc = await medicalProfileRepository.findByEmployee(employeeId);
    await auditService.record({
      entityRef: readRef(employeeId),
      action: 'medicalRecordRead',
      actor: { userId: ctx.userId, ip: null, userAgent: null },
    });
    return doc;
  }

  /**
   * D5 — the employee's own profile, in full.
   *
   * It is about them. There is no state in which the company knows something about somebody's body
   * and they cannot read it, so this needs no permission and hides nothing — the whole record, not
   * a summary of it.
   *
   * STILL AUDITED. Not because reading your own file is suspicious, but because the log's value is
   * that it is complete: a gap for self-reads would be a gap somebody could aim at.
   */
  async getMine(ctx: AuthContext): Promise<MedicalProfileDoc | null> {
    const employee = await employeeRepository.findByUserIdSystem(ctx.userId);
    if (employee === null) return null;
    return this.getByEmployee(ctx, String(employee._id));
  }

  /**
   * Record or correct a profile — one row per person, so this upserts.
   *
   * The employee is read first and their name and code copied: a profile for an id that is not an
   * employee would be clinical data attached to nobody, which is worse than useless because it is
   * still a leak waiting to happen.
   */
  async upsert(
    ctx: AuthContext,
    employeeId: string,
    input: UpsertMedicalProfile,
  ): Promise<MedicalProfileDoc> {
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null) throw new NotFoundError('no such employee');

    const existing = await medicalProfileRepository.findByEmployee(employeeId);
    const fields = {
      employeeCode: employee.code,
      employeeName: employee.personal.fullNameAr,
      ...(input.bloodType === undefined ? {} : { bloodType: input.bloodType }),
      ...(input.chronicConditions === undefined
        ? {}
        : { chronicConditions: input.chronicConditions }),
      ...(input.allergies === undefined ? {} : { allergies: input.allergies }),
      ...(input.hasDisability === undefined ? {} : { hasDisability: input.hasDisability }),
      ...(input.disabilityNote === undefined ? {} : { disabilityNote: input.disabilityNote }),
      ...(input.note === undefined ? {} : { note: input.note }),
    };

    if (existing === null) {
      const created = await medicalProfileRepository.create(
        {
          employeeId: employee._id,
          bloodType: null,
          chronicConditions: [],
          allergies: [],
          hasDisability: false,
          disabilityNote: null,
          note: null,
          ...fields,
        },
        { by: ctx.userId },
      );
      await auditService.record({
        entityRef: entityRef(String(created._id)),
        action: 'create',
        changes: diffChanges({}, snapshot(created)),
      });
      return created;
    }

    const updated = await medicalProfileRepository.updateById(String(existing._id), fields, {
      by: ctx.userId,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(String(existing._id)),
      action: 'update',
      changes: diffChanges(snapshot(existing), snapshot(updated)),
    });
    return updated;
  }
}

export const medicalProfileService = new MedicalProfileService();
