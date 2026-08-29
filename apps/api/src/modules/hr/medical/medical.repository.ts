// Medical data access.
//
// THE CLINICAL REPOSITORY DECLARES NO SCOPE FIELDS, AND THAT IS D4. Read the model's note for the
// full reasoning; the short version is that in this one collection a WIDER scope must not mean
// WIDER reading, so the permission gates and the axis does not.
//
// This is the inverse of the four scope guards elsewhere in HR, each of which REQUIRES the
// declaration. `medical-visibility.spec.ts` holds the inversion in source so that somebody who
// notices the «missing» field reads why before adding it.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { MedicalProfileModel, type MedicalProfileDoc } from './profiles/medical-profile.model';

export interface ProfileListFilter {
  employeeId?: string | undefined;
  search?: string | undefined;
}

class MedicalProfileRepository extends BaseRepository<MedicalProfileDoc> {
  constructor() {
    // NO `branchField`, NO `departmentField` — D4. Soft delete only.
    super(MedicalProfileModel, { softDelete: true });
  }

  /** The profile for one person, or null when nobody has recorded anything about them yet. */
  async findByEmployee(employeeId: string): Promise<MedicalProfileDoc | null> {
    if (!Types.ObjectId.isValid(employeeId)) return null;
    return MedicalProfileModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
    })
      .lean<MedicalProfileDoc>()
      .exec();
  }

  /**
   * The list. SEARCH IS BY PERSON ONLY — name and code, never by condition.
   *
   * «Who here is diabetic» is a query with no legitimate HR answer, and a repository that could
   * serve it would make this module a screening tool whatever the screen above it offered. The
   * clinical fields are not searchable and not indexed (see the model).
   */
  async listFiltered(
    f: ProfileListFilter,
    query: {
      page: number;
      pageSize: number;
      sortBy?: string | undefined;
      sortDir?: 'asc' | 'desc' | undefined;
    },
    scope: ScopeSelector,
  ): Promise<Paginated<MedicalProfileDoc>> {
    const clauses: FilterQuery<MedicalProfileDoc>[] = [];
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.search !== undefined && f.search.trim() !== '') {
      const pattern = new RegExp(f.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      clauses.push({ $or: [{ employeeName: pattern }, { employeeCode: pattern }] });
    }
    return this.list({
      filter: (clauses.length === 0 ? {} : { $and: clauses }) as FilterQuery<MedicalProfileDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['employeeCode', 'updatedAt'],
      scope,
    });
  }
}

export const medicalProfileRepository = new MedicalProfileRepository();
