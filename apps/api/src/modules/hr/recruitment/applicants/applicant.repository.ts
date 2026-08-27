// Applicant data access (Sprint 4.1 plan §2/§9). Scoped on TWO axes — `branchId` (ADR-015) and
// `departmentId` (F-REQ-1) — both mirrors of the placement, written by `writePlacement` and by
// nothing else. The second was missing for four phases, and its absence was silent: an
// undeclared scope field makes `scopeFilter` return an empty filter, which `baseFilter` drops, so
// a department-scoped recruiter was served the whole organization with nothing failing. Search is
// Arabic-normalized against the denormalized `searchName` (§9).
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { escapeRegExp, normalizeArabic } from '../../shared/arabic';
import { ApplicantModel, type ApplicantDoc } from './applicant.model';

export interface ApplicantListFilter {
  status?: readonly string[] | undefined;
  sourceId?: readonly string[] | undefined;
  intakeChannel?: readonly string[] | undefined;
  jobRequisitionId?: string | undefined;
  branchId?: string | undefined;
  identityVerification?: readonly string[] | undefined;
  duplicateOnly?: boolean | undefined;
  hasAttachments?: boolean | undefined;
  movedToOffer?: boolean | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
  search?: string | undefined;
}

export interface DuplicateProbe {
  nationalId?: string | null;
  primaryPhone?: string | null;
  searchName?: string | null;
  birthDate?: Date | null;
  excludeId?: string | undefined;
}

class ApplicantRepository extends BaseRepository<ApplicantDoc> {
  constructor() {
    super(ApplicantModel, {
      branchField: 'branchId',
      // F-REQ-1 — declared, or `scopeFilter` answers a department-scoped reader with an EMPTY
      // filter and `baseFilter` drops it: the whole organization, silently, with nothing failing.
      departmentField: 'departmentId',
      softDelete: true,
    });
  }

  private buildFilter(f: ApplicantListFilter): FilterQuery<ApplicantDoc> {
    const clauses: FilterQuery<ApplicantDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: { $in: f.status } });
    if (f.sourceId !== undefined)
      clauses.push({ sourceId: { $in: f.sourceId.map((id) => new Types.ObjectId(id)) } });
    if (f.intakeChannel !== undefined) clauses.push({ intakeChannel: { $in: f.intakeChannel } });
    if (f.jobRequisitionId !== undefined) {
      clauses.push({ jobRequisitionId: new Types.ObjectId(f.jobRequisitionId) });
    }
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.identityVerification !== undefined) {
      clauses.push({ identityVerification: { $in: f.identityVerification } });
    }
    if (f.duplicateOnly === true) clauses.push({ duplicateFlag: true });
    if (f.hasAttachments !== undefined) {
      clauses.push(f.hasAttachments ? { attachmentCount: { $gt: 0 } } : { attachmentCount: 0 });
    }
    if (f.movedToOffer !== undefined) {
      clauses.push(f.movedToOffer ? { movedToOfferAt: { $ne: null } } : { movedToOfferAt: null });
    }
    if (f.createdFrom !== undefined || f.createdTo !== undefined) {
      const range: Record<string, Date> = {};
      if (f.createdFrom !== undefined) range.$gte = f.createdFrom;
      if (f.createdTo !== undefined) range.$lte = f.createdTo;
      clauses.push({ createdAt: range } as FilterQuery<ApplicantDoc>);
    }
    if (f.search !== undefined && f.search.trim() !== '') {
      const term = f.search.trim();
      const normalized = normalizeArabic(term);
      const nameRe = new RegExp(escapeRegExp(normalized), 'i');
      const rawRe = new RegExp(escapeRegExp(term), 'i');
      clauses.push({
        $or: [
          { searchName: nameRe },
          { code: rawRe },
          { nationalId: rawRe },
          { 'contact.primaryPhone': rawRe },
          { 'contact.secondaryPhone': rawRe },
        ],
      } as FilterQuery<ApplicantDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<ApplicantDoc>;
    return { $and: clauses } as FilterQuery<ApplicantDoc>;
  }

  async listApplicants(params: {
    filter: ApplicantListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<ApplicantDoc>> {
    return this.list({
      filter: this.buildFilter(params.filter),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['createdAt', 'code', 'fullNameAr'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }

  /**
   * The whole filtered set for export, row-capped (no MAX_PAGE_SIZE paging cap). Scope +
   * soft-delete are applied via the base filter; masking happens in the mapper.
   */
  async streamForExport(
    filter: ApplicantListFilter,
    scope: ScopeSelector | undefined,
    limit: number,
  ): Promise<ApplicantDoc[]> {
    return this.model
      .find(this.baseFilter(scope, this.buildFilter(filter)))
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<ApplicantDoc[]>()
      .exec();
  }

  /**
   * By national id, WHATEVER their status — the portal's reader (P-HR-APP §4).
   *
   * Deliberately not `findLiveByNationalId`: a candidate who was refused keeps their portal so
   * they can read that they were refused (D-APP-7ب), and a hired one keeps it until the account is
   * retired. Narrowing to `new` here would sign exactly those two out with no explanation.
   */
  async findAnyByNationalId(nationalId: string): Promise<ApplicantDoc | null> {
    return this.model
      .findOne({ nationalId, isDeleted: false })
      .sort({ createdAt: -1 })
      .lean<ApplicantDoc>()
      .exec();
  }

  async findLiveByNationalId(nationalId: string): Promise<ApplicantDoc | null> {
    return this.model
      .findOne({ nationalId, isDeleted: false, status: 'new' })
      .lean<ApplicantDoc>()
      .exec();
  }

  async findByIntakeKey(intakeKey: string): Promise<ApplicantDoc | null> {
    return this.model.findOne({ intakeKey, isDeleted: false }).lean<ApplicantDoc>().exec();
  }

  /** Heuristic duplicate candidates among live applicants (§2.1 rule 5). */
  async findDuplicateCandidates(probe: DuplicateProbe): Promise<ApplicantDoc[]> {
    const ors: FilterQuery<ApplicantDoc>[] = [];
    if (probe.nationalId != null && probe.nationalId !== '') {
      ors.push({ nationalId: probe.nationalId });
    }
    if (probe.primaryPhone != null && probe.primaryPhone !== '') {
      ors.push({ 'contact.primaryPhone': probe.primaryPhone });
    }
    if (probe.searchName != null && probe.searchName !== '' && probe.birthDate != null) {
      ors.push({ searchName: probe.searchName, birthDate: probe.birthDate });
    }
    if (ors.length === 0) return [];
    const filter: FilterQuery<ApplicantDoc> = { isDeleted: false, status: 'new', $or: ors };
    if (probe.excludeId !== undefined && Types.ObjectId.isValid(probe.excludeId)) {
      filter._id = { $ne: new Types.ObjectId(probe.excludeId) };
    }
    return this.model.find(filter).limit(20).lean<ApplicantDoc[]>().exec();
  }

  async setDuplicateFlag(
    id: string,
    duplicateOf: Types.ObjectId[],
    by: string | null,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: new Types.ObjectId(id) },
        {
          $set: {
            duplicateFlag: duplicateOf.length > 0,
            duplicateOf,
            updatedBy: by === null ? null : new Types.ObjectId(by),
          },
          $inc: { __v: 1 },
        },
      )
      .exec();
  }

  async adjustAttachmentCount(id: string, delta: number): Promise<void> {
    await this.model
      .updateOne({ _id: new Types.ObjectId(id) }, { $inc: { attachmentCount: delta } })
      .exec();
  }
}

export const applicantRepository = new ApplicantRepository();
