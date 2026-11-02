// Maintenance behaviour — the legacy /atm_maintenance(+_done) handlers ported by parity
// (contad_app.js:1045-2200), plus the create-from-mail path the mail-ticket service calls.
// The differences from replenishment are the legacy's own, not a redesign — port doc §2.3.
import {
  ErrorCodes,
  normalizeAtmMachineCode,
  type AtmLeaderOptionDto,
  type BulkUpdateAtmMaintenances,
  type CloseAtmMaintenances,
  type ListAtmDoneOperationsQuery,
  type ListAtmOpenOperationsQuery,
  type OpenAtmMaintenances,
  type Paginated,
  type UpdateAtmMaintenance,
} from '@ecms/contracts';
import { Types, type ClientSession } from 'mongoose';
import { auditService, type AuditEntry } from '../../../platform/audit';
import { getDirectoryEmployee } from '../../../platform/directory';
import { type AuthContext, scopeSelector } from '../../../shared/types';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { assertNoBranchMoveRunning } from '../branch-links/move-fence';
import { atmLeadersService } from '../leaders/leaders.service';
import { actorName, resolveAtmBranchId } from '../shared/atm-context';
import { openDayOf } from '../shared/open-operation';
import { cairoDateString } from '../shared/cairo-time';
import { atmMachineRepository } from '../machines/machine.repository';
import { atmMaintenanceRepository } from './maintenance.repository';
import { type AtmMaintenanceDoc } from './maintenance.model';

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'maintenance', entityId: id });

const editSnapshot = (doc: AtmMaintenanceDoc) => ({
  serviceType: doc.serviceType,
  notes: doc.notes,
  openedAt: doc.openedAt.toISOString(),
  leaderName: doc.leaderName,
  closedAt: doc.closedAt === null ? null : doc.closedAt.toISOString(),
});

/**
 * Did `create` lose to `ux_maintenance_per_mail_ticket` — a live maintenance already carries this
 * ticket? `create` reports E11000 as a DUPLICATE `ConflictError` (base.repository.ts), and that
 * index is the maintenance log's only unique index besides `_id`, which a fresh ObjectId cannot
 * collide on — so a DUPLICATE here IS that index. Exported for its spec.
 */
export const isMailTicketTaken = (error: unknown): boolean =>
  error instanceof ConflictError && error.code === ErrorCodes.DUPLICATE;

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
   * work_status 1, not deleted (contad_app.js:1110-1112). Kept for the route that always served
   * it; the list itself is `atm/leaders` (the departments ticked on /atm/settings, or the ATM
   * department found by name while none is).
   */
  async leaderOptions(): Promise<AtmLeaderOptionDto[]> {
    return atmLeadersService.options();
  }

  /**
   * The multi-row open (contad_app.js:1896-1957): per-line service type + reference number; the
   * form's datetime applies to every line (null → now); unknown codes reported per request.
   *
   * MORE THAN ONE OPEN MAINTENANCE PER MACHINE IS ALLOWED (the owner, 2026-11-02 — port doc
   * OD-1c: «في الصيانة عايزك تسمح إنه يضيف أكتر من صيانة عادي»). The one-open-per-day rule (OD-1,
   * OD-1a) is lifted for maintenance as it was for replenishments (OD-1b): every line of a known
   * code opens its own row — a code pasted twice opens twice, and a machine already in maintenance
   * opens again — exactly as the legacy did. `alreadyOpenCodes` stays in the answer, and is always
   * empty.
   */
  async open(
    input: OpenAtmMaintenances,
    ctx: AuthContext,
  ): Promise<{ opened: AtmMaintenanceDoc[]; unknownCodes: string[]; alreadyOpenCodes: string[] }> {
    // An open operation is work the move's twin plan reads (`machineTwinOpen`).
    await assertNoBranchMoveRunning();
    const branchId = await resolveAtmBranchId(ctx, 'atmMaintenance.create');
    const openedAt = input.openedAt ?? new Date();
    const openDay = openDayOf(openedAt);
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
          openDay,
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
    return { opened, unknownCodes, alreadyOpenCodes: [] };
  }

  /**
   * Acceptance of a mail ticket — the legacy insertMany rows (contad_app.js:2806-2823): zone '',
   * reference '', open time = the ticket's received time (decision D6), service = the issue text.
   * Called BY the mail-ticket service inside one accept; audited there as the accept.
   *
   * Opens even when the machine already has an open maintenance on the ticket's day — the row the
   * pending screen flags `duplication` (OD-1c, 2026-11-02; the legacy's own behaviour). Answers
   * `null`, writing nothing, when a LIVE maintenance already carries this ticket: a concurrent
   * accept of the same ticket opened it first, and `ux_maintenance_per_mail_ticket` refused this
   * one — the caller skips the ticket as already decided.
   */
  async openFromMail(
    row: MaintenanceFromMail,
    ctx: AuthContext,
  ): Promise<AtmMaintenanceDoc | null> {
    if (row.machineId === null) {
      throw new BusinessRuleError('الماكينة المرتبطة بالرسالة لم تعد موجودة.');
    }
    try {
      return await atmMaintenanceRepository.create(
        {
          branchId: row.branchId,
          machineId: row.machineId,
          machineCode: row.machineCode,
          bankName: row.bankName,
          machineName: row.machineName,
          zone: '',
          area: row.area,
          openedAt: row.openedAt,
          openDay: openDayOf(row.openedAt),
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
    } catch (error) {
      if (isMailTicketTaken(error)) return null;
      throw error;
    }
  }

  /**
   * The undo of `openFromMail` — the mail log's «إسترجاع» of an accepted ticket («ويقدر يرجعه
   * مفتوح لو قبل أو رفض غلط», 2026-10-28): the maintenance the ticket opened is soft-deleted inside
   * the CALLER's transaction, beside the ticket's own return to pending, under the mail grant that
   * opened it. The caller has already refused a closed one. Returns the audit row it owes — the
   * `delete` row `remove` writes — for the caller to record once, after commit: `withTransaction`
   * may run the callback twice.
   */
  async removeFromMail(id: string, ctx: AuthContext, session: ClientSession): Promise<AuditEntry> {
    await atmMaintenanceRepository.softDeleteById(id, { by: ctx.userId, session });
    return { entityRef: entityRef(id), action: 'delete', changes: [] };
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

  /**
   * Reopen from the done page (contad_app.js:2195-2197): `closedAt` cleared, the rest kept.
   * Never refused for another open maintenance of the machine (OD-1c, 2026-11-02). The row's
   * `openDay` is written with it, as on every open.
   */
  async reopen(id: string, version: number, ctx: AuthContext): Promise<AtmMaintenanceDoc> {
    // A reopened operation is open work again (`machineTwinOpen`): it waits for a running move.
    await assertNoBranchMoveRunning();
    const scope = scopeSelector(ctx, 'atmMaintenance.complete');
    const row = await atmMaintenanceRepository.getById(id, scope);
    const updated = await atmMaintenanceRepository.updateById(
      id,
      { closedAt: null, openDay: openDayOf(row.openedAt) },
      { by: ctx.userId, version, scope },
    );
    await auditService.record({ entityRef: entityRef(id), action: 'reopen', changes: [] });
    return updated;
  }

  /**
   * Single-row edit (contad_app.js:1989-2036): notes, service type and open time apply; a
   * CHANGED leader cascades over the row's area+shift — unconditionally here, unlike
   * replenishment's time-unchanged guard. The legacy's own asymmetry, preserved. With the dialog's
   * «الوردية» box unticked (`cascadeLeader: false`, 2026-10-27) the leader is written on this row
   * alone.
   *
   * Moving an open row's time onto a day its machine is already in maintenance on is allowed
   * (OD-1c, 2026-11-02).
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
    if (input.openedAt !== undefined) {
      set.openedAt = input.openedAt;
      set.openDay = openDayOf(input.openedAt);
    }
    const changingLeader = input.leaderName !== undefined && input.leaderName !== before.leaderName;
    const cascading = changingLeader && input.cascadeLeader !== false;
    if (changingLeader && !cascading) set.leaderName = input.leaderName ?? null;

    const updated = await atmMaintenanceRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    if (cascading) {
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

  /**
   * Checked-rows edit (contad_app.js:2038-2055): the leader on the checked rows, nothing else —
   * and, with the dialog's «الوردية» box ticked (`cascadeLeader: true`, 2026-10-27), over the
   * area and shift of every checked row too, as the single edit cascades.
   */
  async bulkUpdate(
    input: BulkUpdateAtmMaintenances,
    ctx: AuthContext,
  ): Promise<AtmMaintenanceDoc[]> {
    const scope = scopeSelector(ctx, 'atmMaintenance.edit');
    let rows = await atmMaintenanceRepository.updateManyByIds(
      input.ids,
      { leaderName: input.leaderName },
      { by: ctx.userId, scope },
    );
    // A leader goes over the shift; «no leader» stays on the checked rows — an empty field must
    // never clear the leader of every open maintenance in those areas and shifts.
    if (input.cascadeLeader === true && input.leaderName !== null) {
      await atmMaintenanceRepository.cascadeLeaderOverRows(rows, input.leaderName, ctx.userId);
      // The cascade wrote these rows again: answer with them as stored now (their version moved).
      rows = await atmMaintenanceRepository.findByIds(input.ids, scope);
    }
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
