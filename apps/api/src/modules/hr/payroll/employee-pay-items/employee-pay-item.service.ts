// Employee pay-item service (PY-2) — assignment only. Nothing here calculates anything.
//
// FIVE RULES, AND WHY EACH ONE IS HERE:
//
//   1. the catalog item must exist. An amount attached to nothing is a payslip line that cannot
//      be named.
//   2. an ARCHIVED item cannot start a new assignment. Archiving is how this organization says
//      "we no longer pay this"; letting a new row cite it would make the archive advisory. Rows
//      that already cite it are untouched — that is exactly what archiving protects.
//   3. no two intervals for the same employee × item may overlap. On any given day exactly one
//      amount is in force, or none, so PY-3 never has to choose between two rows.
//   4. history is never removed. An assignment that has already started is CLOSED, not deleted:
//      payroll will have to explain what it paid, and a row that vanished cannot. Only a future
//      assignment — one nothing was ever priced with — leaves outright.
//   5. it must sit inside ONE employment span (added by PY-3 / D3). Compensation outside
//      employment is compensation for a stretch nobody worked, and a span is singular here on
//      purpose: a rehire leaves a gap, and an interval must not step over it.
//
// Authorization is the caller's compensation scope, not a key of this feature's own: the employee
// is resolved through `employeeRepository.getById(id, scope)` first, so a caller who cannot reach
// that employee's compensation gets the same 404 they would get from the employee itself.
import { Types } from 'mongoose';
import {
  type CreateEmployeePayItem,
  type EmployeePayItemDto,
  type EmployeePayItemRefDto,
  type EmployeePayItemRemoval,
  type ListEmployeePayItemsQuery,
  type Paginated,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../../shared/errors';
import { type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { cairoToday, dateOnlyIso, toDateOnly } from '../../shared/business-date';
import { employeeRepository } from '../../employee-management/employees';
// Direct file imports rather than the feature barrel: the catalog's own service asks this
// feature whether an item is still in use, and going through both barrels would make that a cycle.
import { payItemRepository } from '../pay-items/pay-item.repository';
import { type PayItemDoc } from '../pay-items/pay-item.model';
import { employmentSpansOf, spanContaining } from '../compensation/employment-spans';
import { employeePayItemRepository } from './employee-pay-item.repository';
import { type EmployeePayItemDoc } from './employee-pay-item.model';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'employeePayItem',
  entityId: id,
});

const payItemRef = (doc: PayItemDoc): EmployeePayItemRefDto => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  kind: doc.kind,
  calcBasis: doc.calcBasis,
  quantitySource: doc.quantitySource,
  status: doc.status,
});

class EmployeePayItemService {
  /**
   * One employee's assignments, newest interval first — the compensation history as it reads.
   *
   * `scope` is the caller's compensation scope and it is spent on the EMPLOYEE: an employee
   * outside it is not found, so there is no listing to reach.
   */
  async list(
    employeeId: string,
    query: ListEmployeePayItemsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<EmployeePayItemDoc>> {
    await employeeRepository.getById(employeeId, scope);
    const activeOn = query.activeOn === undefined ? null : toDateOnly(query.activeOn);
    return employeePayItemRepository.list({
      filter: {
        employeeId: new Types.ObjectId(employeeId),
        ...(query.payItemId === undefined
          ? {}
          : { payItemId: new Types.ObjectId(query.payItemId) }),
        ...(activeOn === null
          ? {}
          : {
              effectiveFrom: { $lte: activeOn },
              $or: [{ effectiveTo: null }, { effectiveTo: { $gte: activeOn } }],
            }),
      },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'effectiveFrom',
      sortDir: query.sortDir,
      sortableFields: ['effectiveFrom', 'effectiveTo', 'amount', 'createdAt'],
    });
  }

  async create(
    employeeId: string,
    input: CreateEmployeePayItem,
    by: string,
    scope: ScopeSelector,
  ): Promise<EmployeePayItemDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);

    const payItem = await payItemRepository.findById(input.payItemId);
    if (payItem === null) throw new NotFoundError('pay item not found');
    if (payItem.status === 'archived') {
      throw new BusinessRuleError(
        `pay item ${payItem.code} is archived and cannot start a new assignment`,
      );
    }

    const effectiveFrom = toDateOnly(input.effectiveFrom);
    const effectiveTo = input.effectiveTo == null ? null : toDateOnly(input.effectiveTo);

    // PY-3 / D3 — an assignment must sit inside ONE employment span. Both ends in the same span is
    // what stops it stepping over the gap between an exit and a rehire, which would pay someone
    // for a stretch they did not work here; and an open-ended assignment needs an open span,
    // because compensation that never ends on employment that already has would be a contradiction
    // the calculation would then be left to quietly clip away.
    const spans = employmentSpansOf(employee);
    if (spanContaining(spans, effectiveFrom, effectiveTo) === null) {
      throw new BusinessRuleError(
        effectiveTo === null
          ? 'an open-ended pay item needs an open employment period — this employee has left, or the date falls outside their employment'
          : 'a pay item must fall inside a single employment period of this employee',
      );
    }

    const clash = await employeePayItemRepository.findOverlapping(
      employeeId,
      input.payItemId,
      effectiveFrom,
      effectiveTo,
    );
    if (clash !== null) {
      throw new ConflictError(
        `${payItem.code} is already assigned to this employee from ${dateOnlyIso(clash.effectiveFrom)}` +
          `${clash.effectiveTo === null ? ' onwards' : ` to ${dateOnlyIso(clash.effectiveTo)}`} — end that assignment first`,
      );
    }

    const doc = await employeePayItemRepository.create(
      {
        employeeId: new Types.ObjectId(employeeId),
        payItemId: new Types.ObjectId(input.payItemId),
        amount: input.amount,
        currency: input.currency,
        effectiveFrom,
        effectiveTo,
        note: input.note ?? null,
        branchId: employee.employment.branchId,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'employeeId', old: null, new: employeeId },
        { field: 'payItemId', old: null, new: input.payItemId },
        { field: 'amount', old: null, new: `${String(doc.amount)} ${doc.currency}` },
        { field: 'effectiveFrom', old: null, new: dateOnlyIso(doc.effectiveFrom) },
        {
          field: 'effectiveTo',
          old: null,
          new: doc.effectiveTo === null ? null : dateOnlyIso(doc.effectiveTo),
        },
      ],
    });
    return doc;
  }

  /**
   * Stop using an assignment. The DATES decide what that means, not the caller:
   *
   *   • it has not started  → nothing was ever priced with it, so the row leaves (soft delete).
   *   • it is in force      → the row STAYS and is closed as of today.
   *   • it already ended    → nothing to do; the row is history and stays exactly as it is.
   */
  async remove(
    employeeId: string,
    id: string,
    by: string,
    scope: ScopeSelector,
  ): Promise<{ outcome: EmployeePayItemRemoval; doc: EmployeePayItemDoc | null }> {
    await employeeRepository.getById(employeeId, scope);
    const doc = await employeePayItemRepository.getForEmployee(employeeId, id);
    const today = cairoToday();

    if (doc.effectiveFrom.getTime() > today.getTime()) {
      await employeePayItemRepository.softDeleteById(id, { by });
      await auditService.record({
        entityRef: entityRef(id),
        action: 'delete',
        changes: [{ field: 'effectiveFrom', old: dateOnlyIso(doc.effectiveFrom), new: null }],
      });
      return { outcome: 'removed', doc: null };
    }

    if (doc.effectiveTo !== null && doc.effectiveTo.getTime() < today.getTime()) {
      return { outcome: 'alreadyEnded', doc };
    }

    const ended = await employeePayItemRepository.updateById(
      id,
      { effectiveTo: today },
      { by, version: doc.__v },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'effectiveTo',
          old: doc.effectiveTo === null ? null : dateOnlyIso(doc.effectiveTo),
          new: dateOnlyIso(today),
        },
      ],
    });
    return { outcome: 'ended', doc: ended };
  }

  /** The catalog rows a page of assignments cites, by id — one query, not one per row. */
  async labelsFor(docs: readonly EmployeePayItemDoc[]): Promise<Map<string, EmployeePayItemRefDto>> {
    const ids = [...new Set(docs.map((d) => String(d.payItemId)))];
    if (ids.length === 0) return new Map();
    const items = await payItemRepository.list({
      filter: { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
      page: 1,
      pageSize: ids.length,
    });
    return new Map(items.items.map((item) => [String(item._id), payItemRef(item)]));
  }

  toDto(
    doc: EmployeePayItemDoc,
    labels: ReadonlyMap<string, EmployeePayItemRefDto>,
  ): EmployeePayItemDto {
    return {
      id: String(doc._id),
      employeeId: String(doc.employeeId),
      payItemId: String(doc.payItemId),
      payItem: labels.get(String(doc.payItemId)) ?? null,
      amount: doc.amount,
      currency: doc.currency,
      effectiveFrom: dateOnlyIso(doc.effectiveFrom),
      effectiveTo: doc.effectiveTo === null ? null : dateOnlyIso(doc.effectiveTo),
      note: doc.note,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const employeePayItemService = new EmployeePayItemService();
