// Compensation effects (PY-3) — gathering, not calculating.
//
// Every rule lives in `compensation-rules.ts`, which is pure. This file only assembles what that
// engine needs: the employee (resolved inside the caller's compensation scope), the assignments
// whose interval touches the period, the catalog rows they cite, and — when a quantity item is
// among them — the period's FROZEN attendance, read through the one narrow port (PY-4). It stores
// nothing: a calculation is a question asked of today's data, and archiving the answer starts with
// the payroll run in PY-6.
import { Types } from 'mongoose';
import { type CompensationEffectsDto } from '@ecms/contracts';
import { type ScopeSelector } from '../../../../shared/types';
import { employeeRepository } from '../../employee-management/employees';
import { payItemRepository } from '../pay-items/pay-item.repository';
import { EmployeePayItemModel } from '../employee-pay-items/employee-pay-item.model';
import {
  computeCompensation,
  periodRange,
  type AssignmentInput,
} from './compensation-rules';
import { employmentSpansOf } from './employment-spans';
import { attendanceQuantityPort } from './attendance-quantity.port';

class CompensationService {
  /**
   * What this employee's pay items come to over one period.
   *
   * The scope is spent on the EMPLOYEE, exactly as the pay-item assignments spend it, so an
   * employee outside the caller's compensation reach is not found rather than not permitted.
   */
  async effectsFor(
    employeeId: string,
    period: string,
    scope: ScopeSelector,
  ): Promise<CompensationEffectsDto> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const { from, to } = periodRange(period);

    // Every assignment whose interval touches the period — the same intersection test the overlap
    // guard uses, with the period as the window.
    const rows = await EmployeePayItemModel.find({
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
      effectiveFrom: { $lte: to },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
    })
      .lean()
      .exec();

    const assignments: AssignmentInput[] = [];
    if (rows.length > 0) {
      const itemIds = [...new Set(rows.map((row) => String(row.payItemId)))];
      const catalog = await payItemRepository.list({
        filter: { _id: { $in: itemIds.map((id) => new Types.ObjectId(id)) } },
        page: 1,
        pageSize: itemIds.length,
      });
      const byId = new Map(catalog.items.map((item) => [String(item._id), item]));

      for (const row of rows) {
        const item = byId.get(String(row.payItemId));
        // A row whose catalog entry is gone cannot be priced — its kind and basis ARE its meaning.
        // Archived items still price: archiving stops NEW assignments, it does not unpay old ones.
        if (item === undefined) continue;
        assignments.push({
          id: String(row._id),
          payItemId: String(row.payItemId),
          amount: row.amount,
          currency: row.currency,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          item: {
            code: item.code,
            name: item.name,
            kind: item.kind,
            calcBasis: item.calcBasis,
            quantitySource: item.quantitySource,
            sortOrder: item.sortOrder,
          },
        });
      }
    }

    // PY-4 — the frozen attendance for this period, or null when it is not frozen. Asked for
    // ONLY when something actually needs it: a month with no quantity item should not pay for a
    // feed read, and an unfrozen month should not look like a failure on a screen that has
    // nothing to do with attendance.
    const needsQuantities = assignments.some(
      (a) => a.item.calcBasis === 'perDay' || a.item.calcBasis === 'perMinute',
    );
    const attendance = needsQuantities
      ? await attendanceQuantityPort.frozenFor(period, employeeId)
      : null;

    return computeCompensation({
      employeeId,
      period,
      basicSalary: employee.employment.salary,
      attendance,
      employmentSpans: employmentSpansOf(employee),
      assignments,
      // D1 — the older list is not read. Saying so beats leaving the reader to wonder why a figure
      // they can see on the employment tab is missing from this one.
      hasLegacyAllowances: (employee.employment.allowances ?? []).length > 0,
    });
  }
}

export const compensationService = new CompensationService();
