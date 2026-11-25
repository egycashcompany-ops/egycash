// Purchase requests (P2 plan §4; design §5.4, §7.3, §7.5): the register, the record, the create
// and a draft's edit — P2.2. Submission, decisions, returns, cancels and request files join with
// their slices (P2.3 to P2.6). Nothing is deleted: a request ends in a terminal status.
//
// THE REQUESTER IS THE CALLER (OD-16 A, design §7.3). The create reads the caller's own employee
// through the directory, never a body field, and files the request on that employee's department
// copy and the branch the copy lies in (design §7.5). A draft is its requester's alone: an edit by
// anyone else is a 403, so pair A1 — the requester, the creator, the submitter — stays one person
// in every round (P2 plan §1.2 item 22).
//
// SCOPED READS, ONE KEY AT A TIME. Every read loads through the selector of the key its route
// authorized: the register under `.view`; the record under `.view`, then `.approve`, each with its
// own scope, the first that finds the request winning — never the widest of the two (design
// §11.3). A miss under every key is a 404.
//
// THE ORDER OF A WRITE'S CHECKS (P2 plan §4.2). A request is not master data: it is loaded (404),
// the act's key must cover its Unit (403), the act must be the requester's own (403), its status
// must allow the act (422), its version must be current (409), and only then are the act's rules
// judged (422) — the base repository's "never writable" before "someone else wrote it first",
// applied before the write too. Every write is followed, after commit, by its audit row and the
// branch signal.
import {
  ADMINISTRATION_PURCHASE_REQUEST_SORTS,
  CONTENT_EDITABLE,
  ymdToUtcDate,
  type CreateAdministrationPurchaseRequest,
  type ListAdministrationPurchaseRequestsQuery,
  type Paginated,
  type UpdateAdministrationPurchaseRequest,
  type AdministrationAvailableActionDto,
  type AdministrationPurchaseRequestLineEdit,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { departmentRepository } from '../../../../platform/organization';
import { narrowToBranch } from '../../../../shared/base/branch-scope';
import { ForbiddenError, NotFoundError, type AppError } from '../../../../shared/errors';
import {
  hasPermission,
  keyCoversUnit,
  scopeSelector,
  selectorBranches,
  type AuthContext,
} from '../../../../shared/types';
import { itemActiveFor, itemSnapsOf } from '../../catalog/items/index';
import { administrationPeopleService } from '../../people/index';
import { addDaysYmd, cairoDayStart } from '../../shared/cairo-day';
import { ensureCounter } from '../../shared/counter.model';
import { documentNumberAt } from '../../shared/document-number';
import { assertCurrentVersion, escapeRegExp } from '../../shared/master-data';
import { auditPurchaseRequestCreated, auditPurchaseRequestEdited } from './purchase-request-audit';
import {
  inactiveItemsRefusal,
  invalidTransition,
  isRequester,
  purchaseRequestActions,
  requesterRefusal,
  unknownLinesRefusal,
} from './purchase-request-rules';
import { branchSnap } from './purchase-request-snapshots';
import {
  type AdministrationPurchaseRequestDoc,
  type AdministrationPurchaseRequestLineSub,
} from './purchase-request.model';
import { administrationPurchaseRequestRepository as repository } from './purchase-request.repository';

const VIEW = 'administrationPurchaseRequest.view';
const CREATE = 'administrationPurchaseRequest.create';
const EDIT = 'administrationPurchaseRequest.edit';
const APPROVE = 'administrationPurchaseRequest.approve';

/** An id as the database spells it: the contract takes A-F too, and ids compare as strings. */
const canonicalId = (id: string): string => String(new Types.ObjectId(id));

/**
 * A directory id that names a place. HR's directory answers `String(id)`, so a person with no
 * department reads as 'null'; that is no place either.
 */
const placed = (id: string | null): string | null =>
  id !== null && Types.ObjectId.isValid(id) ? canonicalId(id) : null;

const refuseIf = (refusal: AppError | null): void => {
  if (refusal !== null) throw refusal;
};

/** A line as the create or an edit sends it. */
type SentLine = Pick<AdministrationPurchaseRequestLineEdit, 'lineId' | 'itemId' | 'qty' | 'notes'>;

/** A person as the directory answers them, through the module's one door to people. */
type DirectoryPerson = Parameters<typeof administrationPeopleService.resolvePerson>[0];

/**
 * The yearly series' counter, raised to the highest number of this Cairo year already taken and
 * never lowered — at every boot, and before each submission, OUTSIDE its transaction (P2 plan
 * §6.3). A counter lost while requests exist comes back above their numbers.
 */
export const ensurePurchaseRequestNumberCounter = async (at = new Date()): Promise<void> => {
  const { series } = documentNumberAt('purchaseRequest', at);
  await ensureCounter(series.key, await repository.highestNumber(series));
};

class AdministrationPurchaseRequestService {
  /** The register, within the reader's `.view` reach; every filter only narrows it. */
  async list(
    query: ListAdministrationPurchaseRequestsQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AdministrationPurchaseRequestDoc>> {
    const scope = scopeSelector(ctx, VIEW);
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = { $in: query.status };
    // A copy outside the reach adds no row: the scope is its own `$and` clause in the
    // repository's filter, so this only narrows it.
    if (query.departmentIds !== undefined) {
      filter.departmentId = { $in: query.departmentIds.map((id) => new Types.ObjectId(id)) };
    }
    if (query.requesterUserId !== undefined) {
      filter.requesterUserId = new Types.ObjectId(query.requesterUserId);
    }
    // Cairo days, both inclusive: from the start of `from` to before the start of the day after
    // `to`, so a request made at 23:30 in Cairo counts on its own day.
    const created: Record<string, Date> = {};
    if (query.from !== undefined) created.$gte = cairoDayStart(query.from);
    if (query.to !== undefined) created.$lt = cairoDayStart(addDaysYmd(query.to, 1));
    if (Object.keys(created).length > 0) filter.createdAt = created;
    // The start of a number as typed, without regard to case: «pr-2026-00» finds every number
    // that begins so. A draft has no number, so a search never finds one.
    if (query.search !== undefined && query.search !== '') {
      filter.number = new RegExp(`^${escapeRegExp(query.search)}`, 'i');
    }
    return repository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ADMINISTRATION_PURCHASE_REQUEST_SORTS,
      scope,
    });
  }

  /**
   * One request, under the first of `.view` and `.approve` the reader holds whose own scope finds
   * it (design §11.3): an approver who holds `.approve` alone opens what they decide. Else a 404.
   */
  async get(id: string, ctx: AuthContext): Promise<AdministrationPurchaseRequestDoc> {
    for (const key of [VIEW, APPROVE]) {
      if (!hasPermission(ctx, key)) continue;
      const doc = await repository.findById(id, scopeSelector(ctx, key));
      if (doc !== null) return doc;
    }
    throw new NotFoundError('purchase request not found');
  }

  /**
   * What this reader may do with the request now (P2 plan §4.4), from the whole lifecycle table.
   * No request holds a pin before its submission (P2.3), so no reader stands on its chain yet; the
   * trail that says who does joins with the decisions (P2.4).
   */
  actionsFor(
    doc: AdministrationPurchaseRequestDoc,
    ctx: AuthContext,
  ): AdministrationAvailableActionDto[] {
    const branchId = String(doc.branchId);
    const departmentId = String(doc.departmentId);
    return purchaseRequestActions({
      status: doc.status,
      userId: ctx.userId,
      requesterUserId: doc.requesterUserId,
      createdBy: doc.createdBy,
      submittedBy: doc.submittedBy,
      approvalSteps: doc.approvalSteps,
      holds: (key) => hasPermission(ctx, key),
      covers: (key) => keyCoversUnit(ctx, key, branchId, departmentId),
      // The branches the key's own selector reads today: `keyCoversUnit` ignores the top bar, the
      // write's scoped load does not (ADR-028), and a button must not promise what then 404s.
      loads: (key) => {
        const reach = selectorBranches(scopeSelector(ctx, key));
        return reach === 'all' || reach.includes(branchId);
      },
      trail: null,
    });
  }

  async create(
    input: CreateAdministrationPurchaseRequest,
    ctx: AuthContext,
  ): Promise<AdministrationPurchaseRequestDoc> {
    // The requester is the caller's own employee, and the request is filed on their copy.
    const employee = await administrationPeopleService.self(ctx.userId);
    const departmentId = employee === null ? null : placed(employee.departmentId);
    const department =
      departmentId === null ? null : await departmentRepository.findById(departmentId);
    const refusal = requesterRefusal({
      employee:
        employee === null ? null : { status: employee.status, branchId: placed(employee.branchId) },
      department: department === null ? null : { branchId: String(department.branchId) },
    });
    // `requesterRefusal` answers both nulls; the second half only tells the type system so.
    if (refusal !== null || employee === null || department === null) {
      throw refusal ?? new NotFoundError('requester not found');
    }
    const branchId = String(department.branchId);
    const copyId = String(department._id);
    // The scope that hides another department's requests from the caller must not let them file
    // one there — and a key that covers the Unit still files under the top bar's choice (ADR-028):
    // another branch is 400 OUT_OF_REACH, so a narrowed holder never makes a draft their own
    // register then hides (P2 plan §1.2 item 9).
    if (!keyCoversUnit(ctx, CREATE, branchId, copyId)) {
      throw new ForbiddenError(`${CREATE} does not cover this department`);
    }
    narrowToBranch(scopeSelector(ctx, CREATE), branchId, 'branchId');
    const lines = await this.linesFor(input.lines, []);
    const [requester, branch] = await Promise.all([
      this.requesterOn(employee, copyId),
      branchSnap(branchId),
    ]);

    await repository.ensureCollection();
    const doc = await repository.create(
      {
        number: null,
        status: 'draft',
        orderStatus: 'notOrdered',
        branchId: new Types.ObjectId(branchId),
        departmentId: new Types.ObjectId(copyId),
        requesterUserId: new Types.ObjectId(ctx.userId),
        requesterEmployeeId: new Types.ObjectId(employee.employeeId),
        ...requester,
        branch,
        neededBy: input.neededBy === undefined ? null : ymdToUtcDate(input.neededBy),
        justification: input.justification ?? null,
        notes: input.notes ?? null,
        lines,
      },
      { by: ctx.userId },
    );
    await auditPurchaseRequestCreated(doc);
    return doc;
  }

  /** A draft's edit: the requester's own, in draft, at its version (P2 plan §4.2). */
  async update(
    id: string,
    input: UpdateAdministrationPurchaseRequest,
    ctx: AuthContext,
  ): Promise<AdministrationPurchaseRequestDoc> {
    const scope = scopeSelector(ctx, EDIT);
    const before = await repository.findById(id, scope);
    if (before === null) throw new NotFoundError('purchase request not found');
    if (!keyCoversUnit(ctx, EDIT, String(before.branchId), String(before.departmentId))) {
      throw new ForbiddenError(`${EDIT} does not cover this purchase request's department`);
    }
    if (!isRequester(before, ctx.userId)) {
      throw new ForbiddenError('a draft is edited by its requester alone');
    }
    if (!CONTENT_EDITABLE[before.status]) throw invalidTransition(before.status);
    assertCurrentVersion(before, input.version);
    const lines = await this.linesFor(input.lines ?? null, before.lines);
    const [requester, branch] = await Promise.all([
      this.requesterNow(before),
      branchSnap(String(before.branchId)),
    ]);

    // Never the branch, the department or the requester: a request stays filed where it was made.
    const set: Partial<AdministrationPurchaseRequestDoc> = { lines, branch, ...requester };
    if (input.neededBy !== undefined) {
      set.neededBy = input.neededBy === null ? null : ymdToUtcDate(input.neededBy);
    }
    if (input.justification !== undefined) set.justification = input.justification;
    if (input.notes !== undefined) set.notes = input.notes;

    await repository.ensureCollection();
    const updated = await repository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditPurchaseRequestEdited(before, updated);
    return updated;
  }

  /**
   * The lines a write leaves the request with, every snapshot read again from its item (design
   * §2.1, Snapshots), and the unit always the item's (OD-07). `sent` null keeps the stored lines;
   * a list replaces them — a line with a `lineId` the request has keeps that line's id and
   * counters, one without is new, and one with an id the request does not have is refused. An item
   * that does not exist is a 404; a retired one is refused to a new reference — a new line, or a
   * kept line whose item changed — and kept by a kept line that still names it (OD-70 A).
   */
  private async linesFor(
    sent: readonly SentLine[] | null,
    stored: readonly AdministrationPurchaseRequestLineSub[],
  ): Promise<AdministrationPurchaseRequestLineSub[]> {
    const storedById = new Map(stored.map((line) => [String(line._id), line]));
    const wanted: { sent: SentLine | null; kept: AdministrationPurchaseRequestLineSub | null }[] =
      sent === null
        ? stored.map((line) => ({ sent: null, kept: line }))
        : sent.map((line) => ({
            sent: line,
            kept:
              line.lineId === undefined ? null : (storedById.get(canonicalId(line.lineId)) ?? null),
          }));
    refuseIf(
      unknownLinesRefusal(
        wanted.flatMap((line, i) =>
          line.sent?.lineId !== undefined && line.kept === null ? [i] : [],
        ),
      ),
    );

    const itemIdOf = (line: (typeof wanted)[number]): string =>
      line.sent === null ? String(line.kept?.itemId) : canonicalId(line.sent.itemId);
    const items = await itemSnapsOf(wanted.map(itemIdOf));
    const inactive: number[] = [];
    const lines = wanted.map((line, i) => {
      const itemId = itemIdOf(line);
      const named = items.get(itemId);
      const isNewReference = line.kept === null || String(line.kept.itemId) !== itemId;
      if (named === undefined) {
        // A kept line naming the same item keeps what it copied, and still takes the edit's
        // quantity and notes; any other is a 404.
        if (!isNewReference && line.kept !== null) {
          return {
            ...line.kept,
            qty: line.sent?.qty ?? line.kept.qty,
            notes: line.sent === null ? line.kept.notes : (line.sent.notes ?? null),
          };
        }
        throw new NotFoundError(`lines[${String(i)}]: item not found`);
      }
      if (!itemActiveFor(named.item, isNewReference ? 'newReference' : 'existingReference')) {
        inactive.push(i);
      }
      return {
        _id: line.kept?._id ?? new Types.ObjectId(),
        itemId: new Types.ObjectId(itemId),
        ...named.snap,
        unitId: named.item.unitId,
        qty: line.sent?.qty ?? line.kept?.qty ?? 0,
        orderedQty: line.kept?.orderedQty ?? 0,
        cancelledQty: line.kept?.cancelledQty ?? 0,
        notes: line.sent === null ? (line.kept?.notes ?? null) : (line.sent.notes ?? null),
      };
    });
    refuseIf(inactiveItemsRefusal(inactive));
    return lines;
  }

  /**
   * The requester as the request stores them (design §2.1, D-22): the directory's name, code and
   * job title, beside the department the request is FILED on. At the create the two departments
   * are one; once HR moves the person they part, and the request stays filed where it was made
   * (P2 plan §4.2), so its snapshot keeps naming that copy — never a copy the request does not lie
   * in, and never HR's 'null' for a department lost since — and the register's department and the
   * record's agree (§6.5).
   */
  private async requesterOn(
    employee: DirectoryPerson,
    copyId: string,
  ): Promise<Pick<AdministrationPurchaseRequestDoc, 'requesterName' | 'requester'>> {
    const person = await administrationPeopleService.resolvePerson({
      ...employee,
      departmentId: copyId,
    });
    return {
      requesterName: person.name,
      requester: { ...person.snap, departmentId: new Types.ObjectId(copyId) },
    };
  }

  /**
   * The requester as the directory answers now, for the snapshot a draft's save rewrites — or
   * null when it cannot say (no HR source, a person it no longer knows), and the stored copy stays.
   */
  private async requesterNow(
    doc: AdministrationPurchaseRequestDoc,
  ): Promise<Pick<AdministrationPurchaseRequestDoc, 'requesterName' | 'requester'> | null> {
    const employee = await administrationPeopleService.find(String(doc.requesterEmployeeId));
    return employee === null ? null : this.requesterOn(employee, String(doc.departmentId));
  }
}

export const administrationPurchaseRequestService = new AdministrationPurchaseRequestService();
