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
import { type InsuranceCardStatus, type MedicalEventType, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { BusinessRuleError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { MedicalProfileModel, type MedicalProfileDoc } from './profiles/medical-profile.model';
import { MedicalEventModel, type MedicalEventDoc } from './events/medical-event.model';
import { InsuranceCardModel, type InsuranceCardDoc } from './insurance/insurance-card.model';

/** One escaper for the whole feature — a second copy is a second chance to forget a character. */
const escaped = (search: string): RegExp =>
  new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

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
      const pattern = escaped(f.search);
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

export interface EventListFilter {
  employeeId?: string | undefined;
  type?: readonly MedicalEventType[] | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

/**
 * Medical events. NO SCOPE FIELDS either — same reasoning as the profile (D4).
 *
 * AND NO WRITE PATH THAT CAN CHANGE ONE (D9). `writeConditions` returns a filter nothing satisfies,
 * so every `updateById` and `softDeleteById` through this seam misses, and `assertWritable`
 * explains why rather than letting the miss surface as a version conflict.
 *
 * A filter rather than an override that throws, because the condition then rides inside the same
 * atomic `findOneAndUpdate` as the write — there is no window in which a concurrent request could
 * slip past a check that had already run.
 */
class MedicalEventRepository extends BaseRepository<MedicalEventDoc> {
  constructor() {
    super(MedicalEventModel, { softDelete: true });
  }

  /**
   * Nothing is writable. `_id: null` matches no document, ever.
   *
   * The alternative — trusting every service never to call `updateById` — is the kind of rule that
   * holds until somebody adds a «fix a typo in the provider name» endpoint in good faith. This way
   * that endpoint does not work, and the person writing it finds out immediately.
   */
  protected override writeConditions(): FilterQuery<MedicalEventDoc> {
    return { _id: null } as unknown as FilterQuery<MedicalEventDoc>;
  }

  protected override assertWritable(): void {
    throw new BusinessRuleError(
      'a medical event records what was said on a day and is never edited — record a new one',
    );
  }

  async listFiltered(
    f: EventListFilter,
    query: {
      page: number;
      pageSize: number;
      sortBy?: string | undefined;
      sortDir?: 'asc' | 'desc' | undefined;
    },
    scope: ScopeSelector,
  ): Promise<Paginated<MedicalEventDoc>> {
    const clauses: FilterQuery<MedicalEventDoc>[] = [];
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.type !== undefined) clauses.push({ type: { $in: f.type } });
    if (f.from !== undefined) clauses.push({ occurredOn: { $gte: f.from } });
    if (f.to !== undefined) clauses.push({ occurredOn: { $lte: f.to } });
    return this.list({
      filter: (clauses.length === 0 ? {} : { $and: clauses }) as FilterQuery<MedicalEventDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'occurredOn',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['occurredOn', 'createdAt'],
      scope,
    });
  }
}

export const medicalEventRepository = new MedicalEventRepository();

export interface CardListFilter {
  employeeId?: string | undefined;
  status?: InsuranceCardStatus | undefined;
  provider?: string | undefined;
  search?: string | undefined;
}

/**
 * The insurance card — THE ONE MEDICAL REPOSITORY THAT DECLARES BOTH AXES.
 *
 * That is not an inconsistency with the two above it; it is D4 drawn where the design draws it. A
 * card number is an administrative fact an HR officer legitimately administers by branch. A blood
 * type is not. Scoping the two the same way would mean either exposing clinical data to a branch
 * scope, or making benefits administration impossible to delegate — and the design refuses both by
 * splitting the collections rather than the permissions.
 *
 * `medical-visibility.spec.ts` asserts the split in both directions: the clinical repositories
 * declare NO axes, and this one declares BOTH.
 */
class InsuranceCardRepository extends BaseRepository<InsuranceCardDoc> {
  constructor() {
    super(InsuranceCardModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      softDelete: true,
    });
  }

  /** The card somebody would present today, or null. Used to refuse a second live one. */
  async findActive(employeeId: string): Promise<InsuranceCardDoc | null> {
    if (!Types.ObjectId.isValid(employeeId)) return null;
    return InsuranceCardModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      status: 'active',
      isDeleted: false,
    })
      .lean<InsuranceCardDoc>()
      .exec();
  }

  async listFiltered(
    f: CardListFilter,
    query: {
      page: number;
      pageSize: number;
      sortBy?: string | undefined;
      sortDir?: 'asc' | 'desc' | undefined;
    },
    scope: ScopeSelector,
  ): Promise<Paginated<InsuranceCardDoc>> {
    const clauses: FilterQuery<InsuranceCardDoc>[] = [];
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.provider !== undefined && f.provider.trim() !== '') {
      clauses.push({ provider: escaped(f.provider) });
    }
    if (f.search !== undefined && f.search.trim() !== '') {
      const pattern = escaped(f.search);
      // BY PERSON AND BY CARD NUMBER — «whose card is this» is a real question an HR officer holding
      // a physical card needs to answer. It is administrative, not clinical.
      clauses.push({
        $or: [{ employeeName: pattern }, { employeeCode: pattern }, { cardNumber: pattern }],
      });
    }
    return this.list({
      filter: (clauses.length === 0 ? {} : { $and: clauses }) as FilterQuery<InsuranceCardDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['startsOn', 'employeeCode'],
      scope,
    });
  }
}

export const insuranceCardRepository = new InsuranceCardRepository();
