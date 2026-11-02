// Replenishment behaviour — the legacy /atm_replenishment(+_done) handlers ported by parity
// (contad_app.js:206-1036). Timing starts at open and the row stays open until closed; every
// deviation is a numbered decision in docs/12-planning/atm-operations-port.md.
import {
  normalizeAtmMachineCode,
  type BulkUpdateAtmReplenishments,
  type ListAtmDoneOperationsQuery,
  type ListAtmOpenOperationsQuery,
  type OpenAtmReplenishments,
  type Paginated,
  type UpdateAtmReplenishment,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { type AuthContext, scopeSelector } from '../../../shared/types';
import { BusinessRuleError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { assertNoBranchMoveRunning } from '../branch-links/move-fence';
import { actorName, resolveAtmBranchId } from '../shared/atm-context';
import { openDayOf } from '../shared/open-operation';
import { cairoDateString, cairoWallClockUtc } from '../shared/cairo-time';
import { atmMachineRepository } from '../machines/machine.repository';
import { atmReplenishmentRepository } from './replenishment.repository';
import { type AtmReplenishmentDoc } from './replenishment.model';

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'replenishment', entityId: id });

/**
 * The legacy force-date rule (contad_app.js:653-655, 726): the form's date equal to today opens
 * NOW; any other date opens at 06:00 of that day. 06:00 is the day-shift start the cascade also
 * uses — Cairo wall clock, per the T1 normalization.
 */
export const resolveReplenishmentOpenTime = (forceDate: string | null, now: Date): Date => {
  if (forceDate === null || forceDate === cairoDateString(now)) return now;
  return cairoWallClockUtc(forceDate, 6);
};

const editSnapshot = (doc: AtmReplenishmentDoc) => ({
  scheduleTime: doc.scheduleTime,
  openedAt: doc.openedAt.toISOString(),
  leaderName: doc.leaderName,
  closedAt: doc.closedAt === null ? null : doc.closedAt.toISOString(),
});

class AtmReplenishmentService {
  async listOpen(
    query: ListAtmOpenOperationsQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AtmReplenishmentDoc>> {
    return atmReplenishmentRepository.listOpen({
      banks: query.banks,
      areas: query.areas,
      page: query.page,
      pageSize: query.pageSize,
      scope: scopeSelector(ctx, 'atmReplenishment.view'),
    });
  }

  async facets(
    ctx: AuthContext,
    banks: readonly string[],
  ): Promise<{ banks: string[]; areas: string[] }> {
    return atmReplenishmentRepository.facets(scopeSelector(ctx, 'atmReplenishment.view'), banks);
  }

  async listDone(
    query: ListAtmDoneOperationsQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AtmReplenishmentDoc>> {
    // Absent dates default to today; one bound supplied serves as both — the legacy's exact
    // fallback ladder (contad_app.js:942-964).
    const today = cairoDateString(new Date());
    const from = query.from ?? query.to ?? today;
    const to = query.to ?? query.from ?? today;
    return atmReplenishmentRepository.listDone({
      from,
      to,
      page: query.page,
      pageSize: query.pageSize,
      scope: scopeSelector(ctx, 'atmReplenishment.view'),
    });
  }

  /**
   * The multi-row open (contad_app.js:637-768): validate every code against the ACTIVE master
   * (decision T7), open one operation per known code with the machine snapshot, report unknown
   * codes back in the response — the per-request replacement for the legacy's shared
   * `mach_arr_not_found` global (quirk G-race).
   *
   * MORE THAN ONE OPEN REPLENISHMENT PER MACHINE IS ALLOWED (the owner, 2026-11-01 — port doc
   * OD-1b: «عايزك تسمح فى التغذيات بإنى افتح تغذيه أكتر من واحده لنفس الماكينة عادى»). The
   * one-open-per-day rule (OD-1, OD-1a) is lifted for replenishments and kept for maintenance: every
   * line of a known code opens its own row — a code pasted twice opens twice, and a machine already
   * open today opens again — exactly as the legacy did. `alreadyOpenCodes` stays in the answer, and
   * is always empty here.
   */
  async open(
    input: OpenAtmReplenishments,
    ctx: AuthContext,
  ): Promise<{
    opened: AtmReplenishmentDoc[];
    unknownCodes: string[];
    alreadyOpenCodes: string[];
  }> {
    // An open operation is work the move's twin plan reads (`machineTwinOpen`): one opened on a
    // twin between that plan and its retire would be orphaned (review finding).
    await assertNoBranchMoveRunning();
    const branchId = await resolveAtmBranchId(ctx, 'atmReplenishment.create');
    const openedAt = resolveReplenishmentOpenTime(input.forceDate, new Date());
    const openDay = openDayOf(openedAt);
    const codes = input.rows.map((row) => normalizeAtmMachineCode(row.machineCode));
    const machines = await atmMachineRepository.findActiveByCodes(branchId, codes);

    const opened: AtmReplenishmentDoc[] = [];
    const unknownCodes: string[] = [];
    for (const [index, row] of input.rows.entries()) {
      const code = codes[index] as string;
      if (code === '') continue;
      const machine = machines.get(code);
      if (machine === undefined) {
        unknownCodes.push(code);
        continue;
      }
      const doc = await atmReplenishmentRepository.create(
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
          scheduleTime: row.scheduleTime,
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

  /** Close checked rows (contad_app.js:770-801): close time now, closer recorded, leader untouched. */
  async close(ids: readonly string[], ctx: AuthContext): Promise<AtmReplenishmentDoc[]> {
    const closedAt = new Date();
    const rows = await atmReplenishmentRepository.updateManyByIds(
      ids,
      {
        closedAt,
        closedById: new Types.ObjectId(ctx.userId),
        closedByName: actorName(ctx),
      },
      { by: ctx.userId, scope: scopeSelector(ctx, 'atmReplenishment.complete'), onlyOpen: true },
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
   * Reopen from the done page (contad_app.js:1031-1033): `closedAt` cleared, closer left as-is.
   * Never refused for another open replenishment of the machine (OD-1b, 2026-11-01). The row's
   * `openDay` is written with it, as on every open.
   */
  async reopen(id: string, version: number, ctx: AuthContext): Promise<AtmReplenishmentDoc> {
    // A reopened operation is open work again (`machineTwinOpen`): it waits for a running move.
    await assertNoBranchMoveRunning();
    const scope = scopeSelector(ctx, 'atmReplenishment.complete');
    const row = await atmReplenishmentRepository.getById(id, scope);
    const updated = await atmReplenishmentRepository.updateById(
      id,
      { closedAt: null, openDay: openDayOf(row.openedAt) },
      { by: ctx.userId, version, scope },
    );
    await auditService.record({ entityRef: entityRef(id), action: 'reopen', changes: [] });
    return updated;
  }

  /**
   * Single-row edit (contad_app.js:848-869): schedule and open time always apply; a CHANGED
   * leader cascades over the row's area+shift — but only when the open time is NOT being moved
   * in the same submit, the legacy's own precedence (:854-859), preserved. With the dialog's
   * «الوردية» box unticked (`cascadeLeader: false`, 2026-10-27) there is no cascade: the leader
   * is written on this row alone.
   *
   * Moving an open row's time onto a day its machine is already open on is allowed (OD-1b).
   */
  async update(
    id: string,
    input: UpdateAtmReplenishment,
    ctx: AuthContext,
  ): Promise<AtmReplenishmentDoc> {
    const scope = scopeSelector(ctx, 'atmReplenishment.edit');
    const before = await atmReplenishmentRepository.getById(id, scope);
    const set: Record<string, unknown> = {};
    if (input.scheduleTime !== undefined) set.scheduleTime = input.scheduleTime;
    if (input.openedAt !== undefined) {
      set.openedAt = input.openedAt;
      set.openDay = openDayOf(input.openedAt);
    }
    const movingTime =
      input.openedAt !== undefined && input.openedAt.getTime() !== before.openedAt.getTime();
    const changingLeader = input.leaderName !== undefined && input.leaderName !== before.leaderName;
    const shiftWide = input.cascadeLeader !== false;
    if (changingLeader && !shiftWide) set.leaderName = input.leaderName ?? null;
    const cascading = changingLeader && shiftWide && !movingTime;

    const updated = await atmReplenishmentRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    if (cascading) {
      await atmReplenishmentRepository.cascadeLeader({
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
      changes: diffChanges(
        editSnapshot(before),
        editSnapshot({
          ...updated,
          leaderName: cascading ? (input.leaderName ?? null) : updated.leaderName,
        }),
      ),
    });
    return atmReplenishmentRepository.getById(id, scope);
  }

  /**
   * Checked-rows edit (contad_app.js:870-889): schedule/open time on all checked; a changed
   * leader applies to the CHECKED rows — and, with the dialog's «الوردية» box ticked
   * (`cascadeLeader: true`, 2026-10-27), over the shift of every checked row too, under the single
   * edit's own rule: not when the open time is moved in the same submit.
   *
   * Moving the open time sets ONE instant on every checked row — two of one machine included
   * (OD-1b: several open replenishments of a machine are allowed).
   */
  async bulkUpdate(
    input: BulkUpdateAtmReplenishments,
    ctx: AuthContext,
  ): Promise<AtmReplenishmentDoc[]> {
    const scope = scopeSelector(ctx, 'atmReplenishment.edit');
    const set: Record<string, unknown> = {};
    if (input.scheduleTime !== undefined) set.scheduleTime = input.scheduleTime;
    if (input.openedAt !== undefined) {
      set.openedAt = input.openedAt;
      set.openDay = openDayOf(input.openedAt);
    }
    if (input.leaderName !== undefined) set.leaderName = input.leaderName;
    if (Object.keys(set).length === 0) {
      throw new BusinessRuleError('لا يوجد تعديل مطلوب.');
    }
    let rows = await atmReplenishmentRepository.updateManyByIds(input.ids, set, {
      by: ctx.userId,
      scope,
    });
    // A leader on the checked rows only — never a cascade of «no leader» over a whole shift.
    if (
      input.cascadeLeader === true &&
      typeof input.leaderName === 'string' &&
      input.openedAt === undefined
    ) {
      await atmReplenishmentRepository.cascadeLeaderOverRows(rows, input.leaderName, ctx.userId);
      // The cascade wrote these rows again: answer with them as stored now (their version moved).
      rows = await atmReplenishmentRepository.findByIds(input.ids, scope);
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

  /** Soft delete, single or checked (contad_app.js:892-906). */
  async remove(ids: readonly string[], ctx: AuthContext): Promise<number> {
    const scope = scopeSelector(ctx, 'atmReplenishment.delete');
    let removed = 0;
    for (const id of ids) {
      await atmReplenishmentRepository.softDeleteById(id, { by: ctx.userId, scope });
      await auditService.record({ entityRef: entityRef(id), action: 'delete', changes: [] });
      removed += 1;
    }
    return removed;
  }
}

export const atmReplenishmentService = new AtmReplenishmentService();
