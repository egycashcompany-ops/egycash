// Employee data access. Scoped by the full org hierarchy via the denormalized
// branch/department/section fields, so the platform own→section→department→branch→organization
// machinery (ADR-004, ADR-015, ADR-017) applies uniformly. System lookups (national-id guard,
// due scheduled work) are deliberately unscoped — they serve boot/scheduler/guard flows.
import { Types, type FilterQuery } from 'mongoose';
import { EMPLOYED_STATUSES, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { normalizeArabic } from '../../shared/arabic';
import { EmployeeModel, type EmployeeDoc, type EmployeeEntity } from './employee.model';

export interface EmployeeListFilter {
  status?: string | undefined;
  employed?: boolean | undefined;
  origin?: string | undefined;
  applicantId?: string | undefined;
  jobOfferId?: string | undefined;
  branchId?: readonly string[] | undefined;
  departmentId?: string | undefined;
  sectionId?: string | undefined;
  jobTitleId?: string | undefined;
  managerId?: string | undefined;
  employmentType?: string | undefined;
  search?: string | undefined;
  governorate?: string | undefined;
  phone?: string | undefined;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class EmployeeRepository extends BaseRepository<EmployeeDoc> {
  constructor() {
    super(EmployeeModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      sectionField: 'sectionId',
      softDelete: true,
    });
  }

  /** The employee created from a given accepted offer, if any (duplicate-hire guard). */
  async findByOfferId(jobOfferId: string): Promise<EmployeeDoc | null> {
    if (!Types.ObjectId.isValid(jobOfferId)) return null;
    return this.model
      .findOne({ jobOfferId: new Types.ObjectId(jobOfferId), isDeleted: false })
      .lean<EmployeeDoc>()
      .exec();
  }

  /** The employee created from a given applicant, if any — the post-hire guard (RW13). */
  async findByApplicantIdSystem(applicantId: string): Promise<EmployeeDoc | null> {
    if (!Types.ObjectId.isValid(applicantId)) return null;
    return this.model
      .findOne({ applicantId: new Types.ObjectId(applicantId), isDeleted: false })
      .lean<EmployeeDoc>()
      .exec();
  }

  /**
   * Unscoped person-identity lookup by national id (duplicate guard + rehire check — frozen
   * design F2/I6). One person = one employee, whatever their branch, so scoping cannot apply.
   */
  async findByNationalIdSystem(nationalId: string): Promise<EmployeeDoc | null> {
    return this.model.findOne({ 'personal.nationalId': nationalId, isDeleted: false }).exec();
  }

  /** Employed direct reports of a manager (exit direct-reports decision + subordinates view). */
  async findDirectReports(managerId: string, scope?: ScopeSelector): Promise<EmployeeDoc[]> {
    const filter: FilterQuery<EmployeeDoc> = {
      'employment.managerId': new Types.ObjectId(managerId),
      status: { $in: [...EMPLOYED_STATUSES] },
      isDeleted: false,
    };
    return this.model
      .find(scope === undefined ? filter : { $and: [filter, this.scopeFilter(scope)] })
      .sort({ code: 1 })
      .exec();
  }

  /** Hydrated (save-able) doc for the Personnel Actions engine's apply path. Unscoped. */
  async findRawById(id: string): Promise<EmployeeEntity | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model.findOne({ _id: new Types.ObjectId(id), isDeleted: false }).exec();
  }

  /** Atomically allocate the next Personnel Action sequence number for an employee. */
  async allocateActionSeq(id: string): Promise<number | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        { $inc: { actionSeq: 1 } },
        { new: true, projection: { actionSeq: 1 } },
      )
      .exec();
    return doc === null ? null : doc.actionSeq;
  }

  /** Repoint every direct report of `fromUserId` to `toUserId` (or clear). Returns matched count. */
  async reassignDirectReports(fromUserId: string, toUserId: string | null): Promise<number> {
    const res = await this.model
      .updateMany(
        { 'employment.managerId': new Types.ObjectId(fromUserId), isDeleted: false },
        { $set: { 'employment.managerId': toUserId === null ? null : new Types.ObjectId(toUserId) } },
      )
      .exec();
    return res.modifiedCount;
  }

  /** Employee by CODE (auth design 4.3 — the employee-code login identifier). */
  async findByCodeSystem(code: string): Promise<EmployeeDoc | null> {
    return this.model.findOne({ code, isDeleted: false }).lean<EmployeeDoc>().exec();
  }

  /**
   * By code, INCLUDING soft-deleted rows — the question to ask before CREATING one.
   *
   * `ux_code` is deliberately not partial on `isDeleted`: the Employee Code is an identity nobody
   * may reuse, deleted or not. So a soft-deleted employee still holds its code, and
   * `findByCodeSystem` cannot see it. Anything that checks "is this code free?" with that method
   * and then inserts gets a clean answer followed by `E11000` on the index, with nothing in the
   * error to say which employee is in the way.
   */
  async findByCodeAnyState(code: string): Promise<EmployeeDoc | null> {
    return this.model.findOne({ code }).lean<EmployeeDoc>().exec();
  }

  /**
   * Employee by the PERMANENT Global Employee Number (attendance punch import): device exports
   * outlive transfers, and the displayed `code` changes its branch prefix on transfer while
   * `employeeNumber` never changes (ADR-017).
   */
  async findByEmployeeNumberSystem(employeeNumber: string): Promise<EmployeeDoc | null> {
    return this.model.findOne({ employeeNumber, isDeleted: false }).lean<EmployeeDoc>().exec();
  }

  /**
   * Ids of everyone the attendance engine may owe a day row. Everyone non-deleted, INCLUDING the
   * exited — an exit yesterday still leaves yesterday's day derivable — and the engine's own
   * employment-period check is what decides each date, so this list only bounds the sweep.
   */
  async listIdsForAttendance(): Promise<string[]> {
    const rows = await this.model.find({ isDeleted: false }).select({ _id: 1 }).lean().exec();
    return rows.map((r) => String(r._id));
  }

  /** Ids of a section's employees — the daily sheet's section filter (day rows carry no section). */
  async listIdsBySectionSystem(sectionId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(sectionId)) return [];
    const rows = await this.model
      .find({ sectionId: new Types.ObjectId(sectionId), isDeleted: false })
      .select({ _id: 1 })
      .lean()
      .exec();
    return rows.map((r) => String(r._id));
  }

  /** Batch fetch for display enrichment (AT-6 lists) — ids in, docs out, no scope (labels only). */
  async findByIdsSystem(ids: string[]): Promise<EmployeeDoc[]> {
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return [];
    return this.model
      .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) } })
      .lean<EmployeeDoc[]>()
      .exec();
  }

  /**
   * Which of these people have LEFT (P-HR-SEP F1) — the subset, as a set of ids.
   *
   * IT ASKS WHO HAS EXITED, NOT WHO IS STILL EMPLOYED, and the direction is the whole guard.
   *
   * The caller is a sweep deciding whom NOT to act on, so the two phrasings fail in opposite
   * directions. «Who is employed» would treat an id this read cannot resolve — a deleted record,
   * a contract pointing at nobody, a page of results that came back short — as somebody to skip,
   * and a reminder system that goes quiet on a data fault is one nobody discovers is broken.
   * «Who has exited» treats the same hole as somebody to act on: the notice still goes out, and it
   * is a person's job to see that it names nobody.
   *
   * `System` like its neighbours: the caller is a scheduled task with no subject, and a sweep
   * narrowed by a scope nobody holds would act on part of the company at random.
   */
  async listExitedIdsSystem(ids: readonly string[]): Promise<Set<string>> {
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return new Set<string>();
    const rows = await this.model
      .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) }, status: 'exited' }, { _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((row) => String(row._id)));
  }

  /** The employee a login belongs to (self-service own-resolution, leave design C1-R). */
  async findByUserIdSystem(userId: string): Promise<EmployeeDoc | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    return this.model
      .findOne({ userId: new Types.ObjectId(userId), isDeleted: false })
      .lean<EmployeeDoc>()
      .exec();
  }

  /**
   * Everyone non-deleted, INCLUDING the exited — the payroll batch's population (PY-7).
   *
   * Deliberately NOT `listEmployedSystem` below: that one means "employed right now", and someone
   * who left on the 10th still worked ten days of the month and is owed for them. Who actually
   * qualifies for a given period is decided by the caller from the employment spans, which is the
   * same reading the calculation clips by — so the batch and the arithmetic cannot disagree.
   */
  async listAllSystem(): Promise<EmployeeDoc[]> {
    return this.model.find({ isDeleted: false }).lean<EmployeeDoc[]>().exec();
  }

  /**
   * Every employee the CALLER may see — the scoped counterpart of `listAllSystem` (P-HR-15-A).
   *
   * The two differ on purpose. Issuing payslips is a system act: the batch must cover everyone
   * regardless of who pressed the button, so PY-7 uses the unscoped read. A reconciliation is a
   * READ, and a branch payroll reader reconciling a run must be counting their own branch —
   * otherwise the coverage number would be organization-wide while the money beside it was not,
   * and the report would state a discrepancy it invented.
   */
  async listAllInScope(scope: ScopeSelector): Promise<EmployeeDoc[]> {
    return this.model.find(this.baseFilter(scope)).lean<EmployeeDoc[]>().exec();
  }

  /**
   * The employees an ANNOUNCEMENT's audience selects — criteria narrowed by the sender's own scope.
   *
   * `baseFilter(scope, criteria)` is the whole security of the feature and the reason this lives
   * here rather than in the announcements service: it ANDs the caller's scope with the criteria,
   * so a branch-scoped HR manager who names three branches still reaches only their own. Resolving
   * an audience anywhere else would mean re-deriving that intersection, and an intersection
   * re-derived is an intersection that can be written as a union by mistake — which for a
   * company-wide message is the difference between one branch and everybody.
   *
   * Deliberately unpaginated: an audience is counted and sent in one pass, and the alternative is
   * a filter whose second page has changed under it mid-send.
   */
  async listForAudience(
    criteria: FilterQuery<EmployeeDoc>,
    scope: ScopeSelector,
  ): Promise<EmployeeDoc[]> {
    return this.model
      .find(this.baseFilter(scope, criteria))
      .sort({ code: 1 })
      .lean<EmployeeDoc[]>()
      .exec();
  }

  /**
   * The distinct values a free-text personal field actually holds, within the caller's scope.
   *
   * The audience builder offers these rather than a list this codebase invents: `religion` and
   * `nationality` are typed onto employee files by whoever registers them, so the only honest set
   * of choices is the set that exists. A hardcoded list would silently fail to match "مسيحي" the
   * day somebody wrote "مسيحى".
   */
  async distinctPersonal(field: 'religion' | 'nationality', scope: ScopeSelector): Promise<string[]> {
    const values = await this.model
      .distinct(`personal.${field}`, this.baseFilter(scope, { status: { $in: [...EMPLOYED_STATUSES] } }))
      .exec();
    return (values as unknown[])
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .sort((a, b) => a.localeCompare(b, 'ar'));
  }

  /** Every employed employee (probation/active/onLeave/suspended) — leave grants iterate this. */
  async listEmployedSystem(): Promise<EmployeeDoc[]> {
    return this.model
      .find({ status: { $in: [...EMPLOYED_STATUSES] }, isDeleted: false })
      .lean<EmployeeDoc[]>()
      .exec();
  }

  /**
   * Everyone EMPLOYED in these departments — the platform directory's by-department seam.
   *
   * `System` like its neighbours: the caller is another module reading through the seam, not a
   * user browsing HR, so the data scope of whoever happens to be logged in must not narrow it.
   * An Operations planner in Giza still needs the whole crew of the department they plan.
   */
  async listByDepartmentsSystem(departmentIds: readonly string[]): Promise<EmployeeDoc[]> {
    if (departmentIds.length === 0) return [];
    return this.model
      .find({
        departmentId: { $in: departmentIds.map((id) => new Types.ObjectId(id)) },
        status: { $in: [...EMPLOYED_STATUSES] },
        isDeleted: false,
      })
      .lean<EmployeeDoc[]>()
      .exec();
  }

  /**
   * Everyone EMPLOYED at this placement — the two lists ANDed, either one omitted meaning «any».
   *
   * `System` like its neighbours, and for the reason the one above states: the caller is another
   * feature reading through a seam, not a person browsing HR. A performance cycle's scope is a
   * STATEMENT of who the round covers (P-HR-PRF D3), so narrowing it by whoever happened to press
   * «open» would produce a round that claims to cover the company and holds only one branch —
   * a discrepancy nothing downstream could see, because the missing rows look exactly like people
   * who were never in scope.
   *
   * Both lists empty is «everybody employed», which is the caller stating it and never a filter
   * that lost its last criterion: `PerformanceCycleScopeSchema` refuses an empty filter, so the
   * only way to reach here with neither is the explicit `everyone` branch of its union.
   */
  async listEmployedByPlacementSystem(
    branchIds: readonly string[],
    departmentIds: readonly string[],
  ): Promise<EmployeeDoc[]> {
    const filter: FilterQuery<EmployeeDoc> = {
      status: { $in: [...EMPLOYED_STATUSES] },
      isDeleted: false,
    };
    if (branchIds.length > 0) {
      filter.branchId = { $in: branchIds.map((id) => new Types.ObjectId(id)) };
    }
    if (departmentIds.length > 0) {
      filter.departmentId = { $in: departmentIds.map((id) => new Types.ObjectId(id)) };
    }
    return this.model.find(filter).sort({ code: 1 }).lean<EmployeeDoc[]>().exec();
  }

  /** Employees whose probation deadline falls inside the window (the reminder task). */
  async findProbationEndingSystem(from: Date, to: Date): Promise<EmployeeDoc[]> {
    return this.model
      .find({
        status: 'probation',
        isDeleted: false,
        'probation.failed': false,
        'probation.confirmedAt': null,
        $or: [
          { 'probation.extendedTo': { $gte: from, $lte: to } },
          { 'probation.extendedTo': null, 'probation.endDate': { $gte: from, $lte: to } },
        ],
      })
      .exec();
  }

  private buildFilter(f: EmployeeListFilter): FilterQuery<EmployeeDoc> {
    const clauses: FilterQuery<EmployeeDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.employed !== undefined)
      clauses.push(
        f.employed ? { status: { $in: [...EMPLOYED_STATUSES] } } : { status: 'exited' },
      );
    if (f.origin !== undefined) clauses.push({ origin: f.origin });
    if (f.applicantId !== undefined) clauses.push({ applicantId: new Types.ObjectId(f.applicantId) });
    if (f.jobOfferId !== undefined) clauses.push({ jobOfferId: new Types.ObjectId(f.jobOfferId) });
    if (f.branchId !== undefined)
      clauses.push({ branchId: { $in: f.branchId.map((id) => new Types.ObjectId(id)) } });
    if (f.departmentId !== undefined) clauses.push({ departmentId: new Types.ObjectId(f.departmentId) });
    if (f.sectionId !== undefined) clauses.push({ sectionId: new Types.ObjectId(f.sectionId) });
    if (f.jobTitleId !== undefined)
      clauses.push({ 'employment.jobTitleId': new Types.ObjectId(f.jobTitleId) });
    if (f.managerId !== undefined)
      clauses.push({ 'employment.managerId': new Types.ObjectId(f.managerId) });
    if (f.employmentType !== undefined) clauses.push({ 'employment.employmentType': f.employmentType });
    if (f.governorate !== undefined && f.governorate.trim() !== '') {
      const re = new RegExp(escapeRegExp(f.governorate.trim()), 'i');
      // Mirrors how the address is READ — `officialAddress ?? currentAddress` — rather than
      // matching either one. Matching either would return a person whose displayed governorate
      // is not the one that was asked for, which is a filter that looks broken to the user.
      // `field: null` in Mongo also matches an ABSENT field, so a row stored before the address
      // existed falls to the current-address branch instead of vanishing from both.
      clauses.push({
        $or: [
          { 'personal.officialAddress.governorate': re },
          {
            $and: [
              { 'personal.officialAddress': null },
              { 'personal.currentAddress.governorate': re },
            ],
          },
        ],
      } as FilterQuery<EmployeeDoc>);
    }
    if (f.phone !== undefined && f.phone.trim() !== '') {
      // The PRIMARY number only — the one every screen displays. Including the secondary would
      // match rows whose shown phone does not contain the search term.
      clauses.push({
        'personal.contact.primaryPhone': new RegExp(escapeRegExp(f.phone.trim()), 'i'),
      } as FilterQuery<EmployeeDoc>);
    }
    if (f.search !== undefined && f.search.trim() !== '') {
      const term = f.search.trim();
      const re = new RegExp(escapeRegExp(term), 'i');
      const nameRe = new RegExp(escapeRegExp(normalizeArabic(term)), 'i');
      clauses.push({
        $or: [{ code: re }, { applicantCode: re }, { 'personal.searchName': nameRe }],
      } as FilterQuery<EmployeeDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<EmployeeDoc>;
    return { $and: clauses } as FilterQuery<EmployeeDoc>;
  }

  async listEmployees(params: {
    filter: EmployeeListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<EmployeeDoc>> {
    return this.list({
      filter: this.buildFilter(params.filter),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['createdAt', 'code', 'hiredAt'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const employeeRepository = new EmployeeRepository();
