// Employee ↔ cost-centre membership (P-HR-23, D-CC-1). Explicit, dated, audited.
//
// THE RULES, and why each is here:
//
//   1. no two intervals for one employee may overlap. On any given day a person is in exactly one
//      cost centre or in none, so nothing downstream ever has to choose between two rows.
//   2. an INACTIVE centre cannot start a new membership. Deactivating is how the organization says
//      "we no longer use this"; letting a new row cite it would make that advisory. Rows that
//      already cite it are untouched — which is exactly what deactivating is supposed to protect.
//   3. history is never removed. A membership that has already started is CLOSED, not deleted:
//      payslips carry the centre they were issued against and a row that vanished cannot explain
//      them. Only a future membership — one nothing was ever issued under — leaves outright.
//   4. NO frozen-period guard, deliberately. A pay item is refused inside a frozen period because
//      it would change what that month comes to; a cost centre changes no figure at all, and the
//      payslip's stamp is written once under `$setOnInsert`. So a correction to an old membership
//      is safe by construction: it cannot reach a payslip that was already issued.
//
// Authorization is `costCenter.assign` — the authority to place a person, kept separate from
// `costCenter.edit`, which is catalog maintenance. The employee is resolved through
// `employeeRepository.getById(id, scope)` first, so a caller who cannot reach that employee gets
// the same 404 the employee itself would give them.
import { Types } from 'mongoose';
import {
  type CostCenterAssignmentDto,
  type CreateCostCenterAssignment,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { costCenterRepository } from '../../../../platform/organization';
import { toDateOnly } from '../../shared/business-date';
import { employeeRepository } from '../employees';
import { costCenterAssignmentRepository } from './cost-center-assignment.repository';
import { type CostCenterAssignmentDoc } from './cost-center-assignment.model';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'costCenterAssignment',
  entityId: id,
});

const iso = (d: Date): string => d.toISOString().slice(0, 10);

class CostCenterAssignmentService {
  /** One employee's history, newest labels resolved so a screen never renders a bare id. */
  async listForEmployee(
    employeeId: string,
    scope: ScopeSelector,
  ): Promise<CostCenterAssignmentDto[]> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const rows = await costCenterAssignmentRepository.listForEmployee(String(employee._id));
    const centres = await costCenterRepository.byIdsSystem(
      rows.map((row) => String(row.costCenterId)),
    );
    return rows.map((row) => {
      const centre = centres.get(String(row.costCenterId));
      return {
        id: String(row._id),
        employeeId: String(row.employeeId),
        costCenterId: String(row.costCenterId),
        costCenter:
          centre === undefined
            ? null
            : { id: String(centre._id), code: centre.code, name: centre.name },
        effectiveFrom: iso(row.effectiveFrom),
        effectiveTo: row.effectiveTo === null ? null : iso(row.effectiveTo),
        note: row.note,
        version: row.__v,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async create(
    ctx: AuthContext,
    employeeId: string,
    scope: ScopeSelector,
    input: CreateCostCenterAssignment,
  ): Promise<CostCenterAssignmentDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);

    const centre = await costCenterRepository.findById(String(input.costCenterId));
    if (centre === null) throw new NotFoundError('cost center not found');
    if (centre.status !== 'active') {
      throw new BusinessRuleError(`${centre.code} is inactive and cannot start a new assignment`);
    }

    const from = toDateOnly(input.effectiveFrom);
    const to = input.effectiveTo == null ? null : toDateOnly(input.effectiveTo);

    const clash = await costCenterAssignmentRepository.findOverlapping(
      String(employee._id),
      from,
      to,
    );
    if (clash !== null) {
      throw new ConflictError(
        `this employee already belongs to a cost center from ${iso(clash.effectiveFrom)}` +
          `${clash.effectiveTo === null ? ' onwards' : ` to ${iso(clash.effectiveTo)}`}` +
          ' — end that assignment first',
      );
    }

    const doc = await costCenterAssignmentRepository.create(
      {
        employeeId: employee._id,
        costCenterId: new Types.ObjectId(String(input.costCenterId)),
        effectiveFrom: from,
        effectiveTo: to,
        note: input.note ?? null,
        branchId: employee.employment.branchId,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'employeeId', old: null, new: String(doc.employeeId) },
        { field: 'costCenterId', old: null, new: String(doc.costCenterId) },
        { field: 'effectiveFrom', old: null, new: iso(doc.effectiveFrom) },
        { field: 'effectiveTo', old: null, new: doc.effectiveTo === null ? null : iso(doc.effectiveTo) },
      ],
    });
    return doc;
  }

  /**
   * End an open membership on a date, or remove one that never started.
   *
   * The split is rule 3: a membership payroll may already have issued against is closed and kept;
   * one that lies wholly in the future has explained nothing and may go.
   */
  async end(
    ctx: AuthContext,
    employeeId: string,
    scope: ScopeSelector,
    assignmentId: string,
    on: Date,
  ): Promise<void> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await costCenterAssignmentRepository.findById(assignmentId);
    if (doc === null || String(doc.employeeId) !== String(employee._id)) {
      throw new NotFoundError('cost center assignment not found');
    }
    const end = toDateOnly(on);
    if (end < doc.effectiveFrom) {
      // Nothing was ever issued under it — remove rather than store a backwards interval.
      await costCenterAssignmentRepository.softDeleteById(assignmentId, { by: ctx.userId });
      await auditService.record({
        entityRef: entityRef(assignmentId),
        action: 'delete',
        changes: [{ field: 'employeeId', old: String(doc.employeeId), new: null }],
      });
      return;
    }
    await costCenterAssignmentRepository.updateById(
      assignmentId,
      { effectiveTo: end },
      { by: ctx.userId, version: doc.__v },
    );
    await auditService.record({
      entityRef: entityRef(assignmentId),
      action: 'update',
      changes: [
        {
          field: 'effectiveTo',
          old: doc.effectiveTo === null ? null : iso(doc.effectiveTo),
          new: iso(end),
        },
      ],
    });
  }
}

export const costCenterAssignmentService = new CostCenterAssignmentService();
