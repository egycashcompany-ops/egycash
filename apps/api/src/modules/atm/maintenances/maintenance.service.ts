// Maintenance behaviour — the legacy /atm_maintenance(+_done) handlers ported by parity
// (contad_app.js:1045-2200), plus the create-from-mail path the mail-ticket service calls.
// The differences from replenishment are the legacy's own, not a redesign — port doc §2.3.
import {
  normalizeAtmMachineCode,
  AtmSettingKeys,
  type AtmLeaderOptionDto,
  type BulkUpdateAtmMaintenances,
  type CloseAtmMaintenances,
  type ListAtmDoneOperationsQuery,
  type ListAtmOpenOperationsQuery,
  type OpenAtmMaintenances,
  type Paginated,
  type UpdateAtmMaintenance,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import {
  getDirectoryEmployee,
  listDirectoryEmployeesByDepartment,
} from '../../../platform/directory';
import { settingsService } from '../../../platform/settings';
import { type AuthContext, scopeSelector } from '../../../shared/types';
import { BusinessRuleError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { actorName, resolveAtmBranchId } from '../shared/atm-context';
import { cairoDateString } from '../shared/cairo-time';
import { atmMachineRepository } from '../machines/machine.repository';
import { atmMaintenanceRepository } from './maintenance.repository';
import { type AtmMaintenanceDoc } from './maintenance.model';

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'maintenance', entityId: id });

/** Who the close modal offers is an organization fact, like the operations crew departments. */
const ORG_SUBJECT = { userId: null, branchId: null };

const editSnapshot = (doc: AtmMaintenanceDoc) => ({
  serviceType: doc.serviceType,
  notes: doc.notes,
  openedAt: doc.openedAt.toISOString(),
  leaderName: doc.leaderName,
  closedAt: doc.closedAt === null ? null : doc.closedAt.toISOString(),
});

/** What the mail-ticket accept path hands over — one accepted ticket, one maintenance row. */
export interface MaintenanceFromMail {
  branchId: Types.ObjectId;
  machineId: Types.ObjectId | null;
  machineCode: string;
  bankName: string;
  machineName: string;
  area: string;
  openedAt: Date;
  serviceType: string | null;
  mailTicketId: Types.ObjectId;
}

class AtmMaintenanceService {
  async listOpen(
    query: ListAtmOpenOperationsQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AtmMaintenanceDoc>> {
    return atmMaintenanceRepository.listOpen({
      banks: query.banks,
      areas: query.areas,
      page: query.page,
      pageSize: query.pageSize,
      scope: scopeSelector(ctx, 'atmMaintenance.view'),
    });
  }

  async facets(
    ctx: AuthContext,
    banks: readonly string[],
  ): Promise<{ banks: string[]; areas: string[] }> {
    return atmMaintenanceRepository.facets(scopeSelector(ctx, 'atmMaintenance.view'), banks);
  }

  async listDone(
    query: ListAtmDoneOperationsQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AtmMaintenanceDoc>> {
    const today = cairoDateString(new Date());
    const from = query.from ?? query.to ?? today;
    const to = query.to ?? query.from ?? today;
    return atmMaintenanceRepository.listDone({
      from,
      to,
      page: query.page,
      pageSize: query.pageSize,
      scope: scopeSelector(ctx, 'atmMaintenance.view'),
    });
  }

  /**
   * The close modal's employee list — legacy hardcoded `department: "الصراف الالى"`,
   * work_status 1, not deleted (contad_app.js:1110-1112). The department set is the
   * `atm.maintenanceLeaderDepartmentIds` setting (the port of that constant); employed-only is
   * the directory seam's own rule, and exited employees are excluded the same way operations
   * excludes them.
   */
  async leaderOptions(): Promise<AtmLeaderOptionDto[]> {
    const departmentIds = await settingsService.resolve<string[]>(
      AtmSettingKeys.MaintenanceLeaderDepartmentIds,
      ORG_SUBJECT,
    );
    const employees = await listDirectoryEmployeesByDepartment(departmentIds);
    return employees
      .filter((employee) => employee.status !== 'exited')
      .map((employee) => ({ employeeId: employee.employeeId, name: employee.fullNameAr }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }

  /**
   * The multi-row open (contad_app.js:1896-1957): per-line service type + reference number; the
   * form's datetime applies to every line (null → now); unknown codes reported per request.
   */
  async open(
    input: OpenAtmMaintenances,
    ctx: AuthContext,
  ): Promise<{ opened: AtmMaintenanceDoc[]; unknownCodes: string[] }> {
    const branchId = await resolveAtmBranchId(ctx);
    const openedAt = input.openedAt ?? new Date();
    const codes = input.rows.map((row) => normalizeAtmMachineCode(row.machineCode));
    const machines = await atmMachineRepository.findActiveByCodes(branchId, codes);

    const opened: AtmMaintenanceDoc[] = [];
    const unknownCodes: string[] = [];
    for (const [index, row] of input.rows.entries()) {
      const code = codes[index] as string;
      if (code === '') continue;
      const machine = machines.get(code);
      if (machine === undefined) {
        unknownCodes.push(code);
        continue;
      }
      const doc = await atmMaintenanceRepository.create(
        {
          branchId: new Types.ObjectId(branchId),
          machineId: machine._id,
          machineCode: machine.machineCode,
          bankName: machine.bankName,
          machineName: machine.name,
          zone: machine.zone,
          area: machine.area,
          openedAt,
          closedAt: null,
          serviceType: row.serviceType,
          notes: null,
          referenceNumber: row.referenceNumber,
          source: 'manual',
          mailTicketId: null,
          leaderEmployeeId: null,
          leaderName: null,
          openedById: new Types.ObjectId(ctx.userId),
          openedByName: actorName(ctx),
          closedById: null,
          closedByName: null,
        },
        { by: ctx.userId },
      );
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'create',
        changes: diffChanges({}, { machineCode: code, openedAt: openedAt.toISOString() }),
      });
      opened.push(doc);
    }
    return { opened, unknownCodes };
  }

  /**
   * Acceptance of a mail ticket — the legacy insertMany rows (contad_app.js:2806-2823): zone '',
   * reference '', open time = the ticket's received time (decision D6), service = the issue text.
   * Called BY the mail-ticket service inside one accept; audited there as the accept.
   */
  async openFromMail(row: MaintenanceFromMail, ctx: AuthContext): Promise<AtmMaintenanceDoc> {
    if (row.machineId === null) {
      throw new BusinessRuleError('الماكينة المرتبطة بالرسالة لم تعد موجودة.');
    }
    return atmMaintenanceRepository.create(
      {
        branchId: row.branchId,
        machineId: row.machineId,
        machineCode: row.machineCode,
        bankName: row.bankName,
        machineName: row.machineName,
        zone: '',
        area: row.area,
        openedAt: row.openedAt,
        closedAt: null,
        serviceType: row.serviceType,
        notes: null,
        referenceNumber: null,
        source: 'mail',
        mailTicketId: row.mailTicketId,
        leaderEmployeeId: null,
        leaderName: null,
        openedById: new Types.ObjectId(ctx.userId),
        openedByName: actorName(ctx),
        closedById: null,
        closedByName: null,
      },
      { by: ctx.userId },
    );
  }

  /**
   * Close, single or checked set (contad_app.js:1963-1983): close time now, closer recorded, AND
   * the assigned employee written as the row's leader — the required datalist of the close modal.
   * The employee must be a real, employed person the directory answers for (gold's rule).
   */
  async close(input: CloseAtmMaintenances, ctx: AuthContext): Promise<AtmMaintenanceDoc[]> {
    const employee = await getDirectoryEmployee(input.leaderEmployeeId);
    if (employee === null || employee.status === 'exited') {
      throw new BusinessRuleError('الموظف المحدد غير متاح للتعيين.');
    }
    const closedAt = new Date();
    const rows = await atmMaintenanceRepository.updateManyByIds(
      input.ids,
      {
        closedAt,
        closedById: new Types.ObjectId(ctx.userId),
        closedByName: actorName(ctx),
        leaderEmployeeId: new Types.ObjectId(employee.employeeId),
        leaderName: employee.fullNameAr,
      },
      { by: ctx.userId, scope: scopeSelector(ctx, 'atmMaintenance.complete'), onlyOpen: true },
    );
    for (const row of rows) {
      if (row.closedAt?.getTime() === closedAt.getTime()) {
        await auditService.record({
          entityRef: entityRef(String(row._id)),
          action: 'complete',
          changes: [],
        });
      }
    }
    return rows;
  }

  /** Reopen from the done page (contad_app.js:2195-2197): `closedAt` cleared, the rest kept. */
  async reopen(id: string, version: number, ctx: AuthContext): Promise<AtmMaintenanceDoc> {
    const updated = await atmMaintenanceRepository.updateById(
      id,
      { closedAt: null },
      { by: ctx.userId, version, scope: scopeSelector(ctx, 'atmMaintenance.complete') },
    );
    await auditService.record({ entityRef: entityRef(id), action: 'reopen', changes: [] });
    return updated;
  }

  /**
   * Single-row edit (contad_app.js:1989-2036): notes, service type and open time apply; a
   * CHANGED leader cascades over the row's area+shift — unconditionally here, unlike
   * replenishment's time-unchanged guard. The legacy's own asymmetry, preserved.
   */
  async update(
    id: string,
    input: UpdateAtmMaintenance,
    ctx: AuthContext,
  ): Promise<AtmMaintenanceDoc> {
    const scope = scopeSelector(ctx, 'atmMaintenance.edit');
    const before = await atmMaintenanceRepository.getById(id, scope);
    const set: Record<string, unknown> = {};
    if (input.serviceType !== undefined) set.serviceType = input.serviceType;
    if (input.notes !== undefined) set.notes = input.notes;
    if (input.openedAt !== undefined) set.openedAt = input.openedAt;
    const changingLeader = input.leaderName !== undefined && input.leaderName !== before.leaderName;

    const updated = await atmMaintenanceRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    if (changingLeader) {
      await atmMaintenanceRepository.cascadeLeader({
        branchId: before.branchId,
        area: before.area,
        openedAt: updated.openedAt,
        leaderName: input.leaderName ?? null,
        by: ctx.userId,
      });
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(editSnapshot(before), editSnapshot(updated)),
    });
    return atmMaintenanceRepository.getById(id, scope);
  }

  /** Checked-rows edit (contad_app.js:2038-2055): the leader on the checked rows, nothing else. */
  async bulkUpdate(
    input: BulkUpdateAtmMaintenances,
    ctx: AuthContext,
  ): Promise<AtmMaintenanceDoc[]> {
    const rows = await atmMaintenanceRepository.updateManyByIds(
      input.ids,
      { leaderName: input.leaderName },
      { by: ctx.userId, scope: scopeSelector(ctx, 'atmMaintenance.edit') },
    );
    for (const row of rows) {
      await auditService.record({
        entityRef: entityRef(String(row._id)),
        action: 'update',
        changes: [],
      });
    }
    return rows;
  }

  /** Soft delete, single or checked (contad_app.js:2061-2074). */
  async remove(ids: readonly string[], ctx: AuthContext): Promise<number> {
    const scope = scopeSelector(ctx, 'atmMaintenance.delete');
    let removed = 0;
    for (const id of ids) {
      await atmMaintenanceRepository.softDeleteById(id, { by: ctx.userId, scope });
      await auditService.record({ entityRef: entityRef(id), action: 'delete', changes: [] });
      removed += 1;
    }
    return removed;
  }
}

export const atmMaintenanceService = new AtmMaintenanceService();
