// Control & Supplies («بيانات التغذية والخطوط») — the day's lines with their bags and seals, the
// crew lines («خطوط», routes in code) and the distribution of lines over them (S-8; docs/12-planning/
// atm-settlements-phase1.md §6.9 C1–C6; the prints, C7, are `prints/print.service.ts`).
//
// SCOPE. One work branch (`atmControl.view` / `.manage`, DS-22); a body branch must equal it (400
// `BRANCH_MISMATCH`); writes need `.manage` reaching it. «إنشاء الخطوط من القطاعات» also needs the
// map's reach on that branch: `authorize('atmMap.view')` only tests that the key is held.
//
// CONCURRENCY. Route names are unique per branch-day by an index (E11000 → 400 `DUPLICATE_NAME`,
// answered outside the transaction). An assignment move carries the `from` the user saw; a line
// whose assignment moved meanwhile is a 409 `MOVED`, so two users never silently overwrite each
// other. Each target route's `__v` is bumped inside the move's transaction, so a concurrent route
// delete conflicts with it instead of leaving a line on a deleted route. Zones are only READ (D-M8).
import {
  ATM_ROUTES_PER_DAY_MAX,
  ErrorCodes,
  membershipZones,
  zoneMembership,
  type AssignAtmRoutes,
  type AtmControlDayDto,
  type AtmControlRouteDto,
  type AtmPlanRun,
  type AtmRoutesFromZones,
  type AtmRoutesFromZonesResultDto,
  type AtmSettlementDayQuery,
  type CreateAtmRoute,
  type UpdateAtmRoute,
} from '@ecms/contracts';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import {
  AppError,
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  StaleDocumentError,
  ValidationError,
} from '../../../../shared/errors';
import { keyReachesBranch, scopeSelector, type AuthContext } from '../../../../shared/types';
import { diffChanges } from '../../../../shared/utils/diff';
import { AtmMachineLocationModel } from '../../map/machine-location.model';
import { AtmMapZoneModel, type AtmMapZoneDoc } from '../../map/zone.model';
import { zoneNameKey } from '../../map/zone.service';
import { type PendingAudit } from '../../register/register-coupling';
import { branchScopeBranches, branchScopeMatch } from '../../shared/branch-scope';
import { bySerial, plainPlanSlots } from '../plans/plan-dto';
import { AtmPlanLineModel, type AtmPlanLineDoc } from '../plans/plan-line.model';
import { AtmReplenishmentPlanModel, type AtmReplenishmentPlanDoc } from '../plans/plan.model';
import {
  AtmLinePreparationModel,
  type AtmLinePreparationDoc,
} from '../preparation/line-preparation.model';
import { suggestedDay, duplicatesOfLine, sealFieldsOf } from '../preparation/preparation.service';
import { findSealDuplicates } from '../preparation/seal-duplicates';
import { signalControlDay } from '../shared/day-signals';
import { preparationProgress, preparationStatusOf } from '../shared/preparation-state';
import {
  branchMismatch,
  branchNameOf,
  enabledSettlementBanks,
  isDuplicateKey,
  readBranch,
  requireWorkBranch,
} from '../shared/settlement-context';
import { runSettlementHook } from '../shared/test-hooks';
import { AtmDispatchRouteModel, type AtmDispatchRouteDoc } from './dispatch-route.model';
import { AtmRouteAssignmentModel, type AtmRouteAssignmentDoc } from './route-assignment.model';

const VIEW = 'atmControl.view';
const MANAGE = 'atmControl.manage';
const PRINT = 'atmControl.print';
const MAP_VIEW = 'atmMap.view';

const asId = (id: Types.ObjectId | string): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

const routeRef = (id: string) => ({ moduleId: 'atm', entityType: 'dispatchRoute', entityId: id });
const assignmentRef = (lineId: string) => ({
  moduleId: 'atm',
  entityType: 'routeAssignment',
  entityId: lineId,
});

const recordAll = async (audits: readonly PendingAudit[]): Promise<void> => {
  for (const audit of audits) await auditService.record(audit);
};

const routeSnapshot = (
  r: Pick<AtmDispatchRouteDoc, 'name' | 'leaderName' | 'order' | 'zoneId'>,
) => ({
  name: r.name,
  leaderName: r.leaderName,
  order: r.order,
  zoneId: r.zoneId === null ? null : String(r.zoneId),
});

const duplicateName = (): ValidationError =>
  new ValidationError([
    {
      field: 'body.name',
      code: 'DUPLICATE_NAME',
      message: 'another line of this day has this name',
    },
  ]);

const routeGone = (field: string): ValidationError =>
  new ValidationError([{ field, code: 'ROUTE_GONE', message: 'the route no longer exists' }]);

const bagCount = (line: Pick<AtmPlanLineDoc, 'slots'>): number =>
  Math.max(0, ...line.slots.map((s) => s.bag ?? 0));

/** A route's counts over its non-cancelled lines. */
const toRouteDto = (
  route: AtmDispatchRouteDoc,
  lines: readonly AtmPlanLineDoc[],
): AtmControlRouteDto => ({
  id: String(route._id),
  version: route.__v,
  name: route.name,
  leaderName: route.leaderName,
  order: route.order,
  zoneId: route.zoneId === null ? null : String(route.zoneId),
  lines: lines.length,
  machines: new Set(lines.flatMap((l) => (l.machineId === null ? [] : [String(l.machineId)]))).size,
  bags: lines.reduce((sum, l) => sum + bagCount(l), 0),
  notPrepared: lines.filter((l) => l.status !== 'prepared').length,
});

class AtmControlService {
  /** The work branch for a write, checked against the body's (DS-22). */
  private async writeBranch(ctx: AuthContext, bodyBranchId: string): Promise<string> {
    const work = await requireWorkBranch(ctx, VIEW, MANAGE);
    if (bodyBranchId !== work.branchId) throw branchMismatch();
    if (!work.canWrite) throw new ForbiddenError('the control key does not reach this branch');
    return work.branchId;
  }

  /** The day's routes (live, in order) and their non-cancelled lines. */
  private async routesOfDay(branchId: string, date: string): Promise<AtmControlRouteDto[]> {
    const [routes, assignments] = await Promise.all([
      AtmDispatchRouteModel.find({
        branchId: asId(branchId),
        replenishDate: date,
        isDeleted: false,
      })
        .sort({ order: 1, _id: 1 })
        .lean<AtmDispatchRouteDoc[]>()
        .exec(),
      AtmRouteAssignmentModel.find({
        branchId: asId(branchId),
        replenishDate: date,
        isDeleted: false,
      })
        .lean<AtmRouteAssignmentDoc[]>()
        .exec(),
    ]);
    const lines = await AtmPlanLineModel.find({
      _id: { $in: assignments.map((a) => a.lineId) },
      status: { $in: ['issued', 'prepared'] },
      isDeleted: false,
    })
      .lean<AtmPlanLineDoc[]>()
      .exec();
    const lineOf = new Map(lines.map((l) => [String(l._id), l]));
    return routes.map((route) =>
      toRouteDto(
        route,
        assignments
          .filter((a) => String(a.routeId) === String(route._id))
          .flatMap((a) => {
            const line = lineOf.get(String(a.lineId));
            return line === undefined ? [] : [line];
          }),
      ),
    );
  }

  /** C1 — the day: plans, lines with bags and seals, routes and the unassigned count. */
  async day(query: AtmSettlementDayQuery, ctx: AuthContext): Promise<AtmControlDayDto> {
    const branchId = await readBranch(ctx, VIEW, MANAGE, query.branchId);
    const date = query.date ?? (await suggestedDay(branchId));
    const banks = await enabledSettlementBanks();
    const view = scopeSelector(ctx, VIEW);
    const mapReach = branchScopeBranches(scopeSelector(ctx, MAP_VIEW));
    const zonesAllowed = mapReach === 'all' || mapReach.includes(branchId);

    const plans = await AtmReplenishmentPlanModel.find({
      $and: [
        { isDeleted: false },
        branchScopeMatch(view),
        { branchId: asId(branchId), replenishDate: date, bankCode: { $in: banks } },
      ],
    } as FilterQuery<AtmReplenishmentPlanDoc>)
      .sort({ bankCode: 1 })
      .lean<AtmReplenishmentPlanDoc[]>()
      .exec();
    const lines = (
      await AtmPlanLineModel.find({
        planId: { $in: plans.map((p) => p._id) },
        status: { $in: ['issued', 'prepared', 'cancelled'] },
        isDeleted: false,
      })
        .lean<AtmPlanLineDoc[]>()
        .exec()
    ).sort(bySerial);
    const [preps, assignments] = await Promise.all([
      AtmLinePreparationModel.find({ lineId: { $in: lines.map((l) => l._id) }, isDeleted: false })
        .lean<AtmLinePreparationDoc[]>()
        .exec(),
      AtmRouteAssignmentModel.find({ lineId: { $in: lines.map((l) => l._id) }, isDeleted: false })
        .lean<AtmRouteAssignmentDoc[]>()
        .exec(),
    ]);
    const prepOf = new Map(preps.map((p) => [String(p.lineId), p]));
    const routeOf = new Map(assignments.map((a) => [String(a.lineId), String(a.routeId)]));
    const duplicates = await findSealDuplicates(preps.flatMap(sealFieldsOf), ctx, VIEW);
    const zoneNames = zonesAllowed ? await this.primaryZoneNames(branchId, lines, ctx) : new Map();

    const dayLines = lines.flatMap((line) => {
      const prep = prepOf.get(String(line._id));
      if (prep === undefined) return [];
      const cancelled = line.status === 'cancelled';
      return [
        {
          lineId: String(line._id),
          planId: String(line.planId),
          bankCode: line.bankCode,
          serial: line.serial,
          lineStatus: line.status,
          kind: line.kind,
          machineCode: line.machineCode,
          machineName: line.machineName,
          area: line.area,
          hubLabel: line.hubLabel,
          zoneName:
            line.machineId === null ? null : (zoneNames.get(String(line.machineId)) ?? null),
          typeLabel: line.typeLabel,
          spareCode: line.spareCode,
          run: line.run as AtmPlanRun,
          scheduleTime: line.scheduleTime,
          egpTotalMinor: line.egpTotalMinor,
          bags: prep.bags.map((b) => ({ bag: b.bag, slots: [...b.slots], qr: b.qr })),
          seals: prep.seals.map((s) => {
            const slot = plainPlanSlots(line.slots).find((p) => p.slot === s.slot);
            return {
              slot: s.slot,
              denomination: slot?.denomination ?? null,
              notes: slot?.notes ?? 0,
              value: s.value,
            };
          }),
          progress: preparationProgress(prep, line.slots),
          preparationStatus: preparationStatusOf(prep, line.slots),
          // Live assignments of NON-cancelled lines only (a cancel removes its own).
          routeId: cancelled ? null : (routeOf.get(String(line._id)) ?? null),
          duplicates: duplicatesOfLine(prep, duplicates),
        },
      ];
    });

    const live = lines.filter((l) => l.status !== 'cancelled');
    return {
      branch: { id: branchId, name: await branchNameOf(branchId) },
      date,
      can: {
        manage: keyReachesBranch(ctx, MANAGE, branchId),
        print: keyReachesBranch(ctx, PRINT, branchId),
        zones: zonesAllowed,
      },
      plans: plans.map((plan) => {
        const own = live.filter((l) => String(l.planId) === String(plan._id));
        return {
          planId: String(plan._id),
          bankCode: plan.bankCode,
          lines: own.length,
          prepared: own.filter((l) => l.status === 'prepared').length,
        };
      }),
      lines: dayLines,
      routes: await this.routesOfDay(branchId, date),
      unassigned: live.filter((l) => !routeOf.has(String(l._id))).length,
    };
  }

  /** The zones of a branch in order, read through the map's own match. */
  private async zonesOf(branchId: string, ctx: AuthContext): Promise<AtmMapZoneDoc[]> {
    return AtmMapZoneModel.find({
      $and: [
        branchScopeMatch(scopeSelector(ctx, MAP_VIEW)),
        { branchId: asId(branchId) },
        { isDeleted: false },
      ],
    } as FilterQuery<AtmMapZoneDoc>)
      .sort({ order: 1, _id: 1 })
      .lean<AtmMapZoneDoc[]>()
      .exec();
  }

  /** Machine id → its located point (a pin under review counts, as on the map). */
  private async pointsOf(
    branchId: string,
    machineIds: readonly Types.ObjectId[],
    ctx: AuthContext,
  ): Promise<Map<string, { lat: number; lng: number }>> {
    if (machineIds.length === 0) return new Map();
    const docs = await AtmMachineLocationModel.find(
      {
        $and: [
          branchScopeMatch(scopeSelector(ctx, MAP_VIEW)),
          { branchId: asId(branchId) },
          { isDeleted: false, status: 'located', machineId: { $in: machineIds } },
        ],
      },
      { machineId: 1, lat: 1, lng: 1 },
    )
      .lean<{ machineId: Types.ObjectId; lat: number | null; lng: number | null }[]>()
      .exec();
    return new Map(
      docs.flatMap((d) =>
        d.lat === null || d.lng === null ? [] : [[String(d.machineId), { lat: d.lat, lng: d.lng }]],
      ),
    );
  }

  /** Machine id → its primary zone's id (DS-17: `zoneMembership`, the map's rule). */
  private primaryZones(
    branchId: string,
    zones: readonly AtmMapZoneDoc[],
    points: ReadonlyMap<string, { lat: number; lng: number }>,
  ): Map<string, string> {
    const membership = membershipZones(
      zones.map((z) => ({ id: String(z._id), branchId, points: z.points })),
    );
    const primary = new Map<string, string>();
    for (const [machineId, point] of points) {
      const zone = zoneMembership({ ...point, branchId }, membership).primary;
      if (zone !== null) primary.set(machineId, zone);
    }
    return primary;
  }

  private async primaryZoneNames(
    branchId: string,
    lines: readonly AtmPlanLineDoc[],
    ctx: AuthContext,
  ): Promise<Map<string, string>> {
    const machineIds = lines.flatMap((l) => (l.machineId === null ? [] : [l.machineId]));
    const [zones, points] = await Promise.all([
      this.zonesOf(branchId, ctx),
      this.pointsOf(branchId, machineIds, ctx),
    ]);
    const nameOf = new Map(zones.map((z) => [String(z._id), z.name]));
    const names = new Map<string, string>();
    for (const [machineId, zoneId] of this.primaryZones(branchId, zones, points)) {
      const name = nameOf.get(zoneId);
      if (name !== undefined) names.set(machineId, name);
    }
    return names;
  }

  /** C2. */
  async createRoute(input: CreateAtmRoute, ctx: AuthContext): Promise<AtmControlRouteDto> {
    const branchId = asId(await this.writeBranch(ctx, input.branchId));
    const by = asId(ctx.userId);
    let route: AtmDispatchRouteDoc;
    try {
      route = await unitOfWork(async (session) => {
        const existing = await AtmDispatchRouteModel.find(
          { branchId, replenishDate: input.replenishDate, isDeleted: false },
          { order: 1 },
        )
          .session(session)
          .lean<Pick<AtmDispatchRouteDoc, 'order'>[]>()
          .exec();
        if (existing.length >= ATM_ROUTES_PER_DAY_MAX) {
          throw new BusinessRuleError(
            `at most ${String(ATM_ROUTES_PER_DAY_MAX)} lines a day in one branch`,
          );
        }
        const [created] = await AtmDispatchRouteModel.create(
          [
            {
              branchId,
              replenishDate: input.replenishDate,
              name: input.name,
              nameKey: zoneNameKey(input.name),
              leaderName: input.leaderName === '' ? null : input.leaderName,
              order: Math.max(-1, ...existing.map((r) => r.order)) + 1,
              zoneId: null,
              createdBy: by,
              updatedBy: by,
            },
          ],
          { session },
        );
        return created?.toObject() as AtmDispatchRouteDoc;
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw duplicateName();
      throw error;
    }
    await auditService.record({
      entityRef: routeRef(String(route._id)),
      action: 'create',
      changes: diffChanges({}, { ...routeSnapshot(route), replenishDate: route.replenishDate }),
    });
    return toRouteDto(route, []);
  }

  /** A route through the view key's match (404), and manage reaching its branch (403). */
  private async loadRoute(routeId: string, ctx: AuthContext): Promise<AtmDispatchRouteDoc> {
    const route = await AtmDispatchRouteModel.findOne({
      $and: [{ _id: asId(routeId), isDeleted: false }, branchScopeMatch(scopeSelector(ctx, VIEW))],
    } as FilterQuery<AtmDispatchRouteDoc>)
      .lean<AtmDispatchRouteDoc>()
      .exec();
    if (route === null) throw new NotFoundError('no such line');
    if (!keyReachesBranch(ctx, MANAGE, String(route.branchId))) {
      throw new ForbiddenError('the control key does not reach this branch');
    }
    return route;
  }

  /** C4. */
  async updateRoute(
    routeId: string,
    input: UpdateAtmRoute,
    ctx: AuthContext,
  ): Promise<AtmControlRouteDto> {
    const route = await this.loadRoute(routeId, ctx);
    const by = asId(ctx.userId);
    const $set: Record<string, unknown> = { updatedBy: by };
    if (input.name !== undefined) {
      $set.name = input.name;
      $set.nameKey = zoneNameKey(input.name);
    }
    if (input.leaderName !== undefined) {
      $set.leaderName = input.leaderName === '' ? null : input.leaderName;
    }
    if (input.order !== undefined) $set.order = input.order;
    let updated: AtmDispatchRouteDoc | null;
    try {
      updated = await AtmDispatchRouteModel.findOneAndUpdate(
        { _id: route._id, __v: input.version, isDeleted: false },
        { $set, $inc: { __v: 1 } },
        { new: true },
      )
        .lean<AtmDispatchRouteDoc>()
        .exec();
    } catch (error) {
      if (isDuplicateKey(error)) throw duplicateName();
      throw error;
    }
    if (updated === null) throw new StaleDocumentError();
    const changes = diffChanges(routeSnapshot(route), routeSnapshot(updated));
    if (changes.length > 0) {
      await auditService.record({ entityRef: routeRef(routeId), action: 'update', changes });
    }
    const dto = (await this.routesOfDay(String(updated.branchId), updated.replenishDate)).find(
      (r) => r.id === routeId,
    );
    return dto ?? toRouteDto(updated, []);
  }

  /** C5 — the route and its live assignments; their lines return to «لم يُوزّع بعد». */
  async deleteRoute(routeId: string, version: number, ctx: AuthContext): Promise<void> {
    const route = await this.loadRoute(routeId, ctx);
    const by = asId(ctx.userId);
    const removed = await unitOfWork(async (session) => {
      const now = new Date();
      const deleted = await AtmDispatchRouteModel.updateOne(
        { _id: route._id, __v: version, isDeleted: false },
        {
          $set: { isDeleted: true, deletedAt: now, deletedBy: by, updatedBy: by },
          $inc: { __v: 1 },
        },
        { session },
      ).exec();
      if (deleted.matchedCount !== 1) throw new StaleDocumentError();
      const assignments = await AtmRouteAssignmentModel.find({
        routeId: route._id,
        isDeleted: false,
      })
        .session(session)
        .lean<AtmRouteAssignmentDoc[]>()
        .exec();
      if (assignments.length > 0) {
        await AtmRouteAssignmentModel.updateMany(
          { _id: { $in: assignments.map((a) => a._id) }, isDeleted: false },
          {
            $set: { isDeleted: true, deletedAt: now, deletedBy: by, updatedBy: by },
            $inc: { __v: 1 },
          },
          { session },
        ).exec();
      }
      return assignments.map((a) => String(a.lineId));
    });
    await recordAll([
      {
        entityRef: routeRef(routeId),
        action: 'delete',
        changes: diffChanges(routeSnapshot(route), {}),
      },
      ...removed.map((lineId): PendingAudit => ({
        entityRef: assignmentRef(lineId),
        action: 'delete',
        changes: [{ field: 'routeId', old: routeId, new: null }],
      })),
    ]);
  }

  /** C6 — move lines between routes; each move carries the `from` its user saw. */
  async assign(input: AssignAtmRoutes, ctx: AuthContext): Promise<AtmControlRouteDto[]> {
    const branchId = asId(await this.writeBranch(ctx, input.branchId));
    const date = input.replenishDate;

    // 1. Issued or prepared lines of this branch and day.
    const lines = await AtmPlanLineModel.find(
      { _id: { $in: input.moves.map((m) => asId(m.lineId)) }, isDeleted: false },
      { branchId: 1, replenishDate: 1, status: 1, planId: 1 },
    )
      .lean<Pick<AtmPlanLineDoc, '_id' | 'branchId' | 'replenishDate' | 'status' | 'planId'>[]>()
      .exec();
    const lineOf = new Map(lines.map((l) => [String(l._id), l]));
    const badLines = input.moves.flatMap((m, i) => {
      const line = lineOf.get(m.lineId);
      const ok =
        line !== undefined &&
        String(line.branchId) === String(branchId) &&
        line.replenishDate === date &&
        (line.status === 'issued' || line.status === 'prepared');
      return ok
        ? []
        : [{ field: `moves[${String(i)}]`, code: 'LINE_STATE', message: 'not a line of this day' }];
    });
    if (badLines.length > 0) throw new ValidationError(badLines);

    // 2. Every target a live route of this branch-day.
    const targets = [...new Set(input.moves.flatMap((m) => (m.to === null ? [] : [m.to])))];
    const liveRoutes = await AtmDispatchRouteModel.find(
      { _id: { $in: targets.map(asId) }, branchId, replenishDate: date, isDeleted: false },
      { _id: 1 },
    )
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    const live = new Set(liveRoutes.map((r) => String(r._id)));
    const gone = input.moves.findIndex((m) => m.to !== null && !live.has(m.to));
    if (gone !== -1) throw routeGone(`moves[${String(gone)}]`);

    // 3. One transaction.
    await runSettlementHook('control.assign.beforeWrite');
    const by = asId(ctx.userId);
    let audits: PendingAudit[];
    try {
      audits = await unitOfWork(async (session) => {
        const pending: PendingAudit[] = [];
        for (const target of targets) {
          const touched = await AtmDispatchRouteModel.updateOne(
            { _id: asId(target), branchId, replenishDate: date, isDeleted: false },
            { $inc: { __v: 1 } },
            { session },
          ).exec();
          if (touched.matchedCount !== 1) {
            throw routeGone(`moves[${String(input.moves.findIndex((m) => m.to === target))}]`);
          }
        }
        for (const [i, move] of input.moves.entries()) {
          pending.push(...(await this.applyMove(move, i, branchId, date, by, session)));
        }
        return pending;
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new StaleDocumentError();
      throw error;
    }
    await recordAll(audits);
    for (const planId of new Set(lines.map((l) => String(l.planId)))) {
      signalControlDay(planId, String(branchId));
    }
    return this.routesOfDay(String(branchId), date);
  }

  /** One move inside C6's transaction: `from` must still hold; upsert, or remove when `to` is null. */
  private async applyMove(
    move: AssignAtmRoutes['moves'][number],
    i: number,
    branchId: Types.ObjectId,
    date: string,
    by: Types.ObjectId,
    session: ClientSession,
  ): Promise<PendingAudit[]> {
    const lineId = asId(move.lineId);
    const current = await AtmRouteAssignmentModel.findOne({ lineId, isDeleted: false })
      .session(session)
      .lean<AtmRouteAssignmentDoc>()
      .exec();
    const currentRoute = current === null ? null : String(current.routeId);
    if (currentRoute !== move.from) {
      throw new AppError(ErrorCodes.STALE_DOCUMENT, 409, 'the line was moved meanwhile', {
        details: [{ field: `moves[${String(i)}]`, code: 'MOVED', message: 'MOVED' }],
      });
    }
    if (move.to === currentRoute) return [];
    const now = new Date();
    if (move.to === null) {
      if (current === null) return [];
      await AtmRouteAssignmentModel.updateOne(
        { _id: current._id, isDeleted: false },
        {
          $set: { isDeleted: true, deletedAt: now, deletedBy: by, updatedBy: by },
          $inc: { __v: 1 },
        },
        { session },
      ).exec();
      return [
        {
          entityRef: assignmentRef(move.lineId),
          action: 'delete',
          changes: [{ field: 'routeId', old: currentRoute, new: null }],
        },
      ];
    }
    if (current === null) {
      await AtmRouteAssignmentModel.create(
        [
          {
            lineId,
            routeId: asId(move.to),
            branchId,
            replenishDate: date,
            createdBy: by,
            updatedBy: by,
          },
        ],
        { session },
      );
      return [
        {
          entityRef: assignmentRef(move.lineId),
          action: 'create',
          changes: [{ field: 'routeId', old: null, new: move.to }],
        },
      ];
    }
    await AtmRouteAssignmentModel.updateOne(
      { _id: current._id, isDeleted: false },
      { $set: { routeId: asId(move.to), updatedBy: by }, $inc: { __v: 1 } },
      { session },
    ).exec();
    return [
      {
        entityRef: assignmentRef(move.lineId),
        action: 'update',
        changes: [{ field: 'routeId', old: currentRoute, new: move.to }],
      },
    ];
  }

  /** C3 — one route per map zone that holds the day's unassigned machine lines (DS-17). */
  async fromZones(
    input: AtmRoutesFromZones,
    ctx: AuthContext,
  ): Promise<AtmRoutesFromZonesResultDto> {
    // 1. The work branch, and the map's reach on it.
    const branchText = await this.writeBranch(ctx, input.branchId);
    const mapReach = branchScopeBranches(scopeSelector(ctx, MAP_VIEW));
    if (mapReach !== 'all' && !mapReach.includes(branchText)) {
      throw new ForbiddenError('the map key does not reach this branch');
    }
    const branchId = asId(branchText);
    const date = input.replenishDate;

    // 2–3. The zones, the unassigned issued or prepared lines, and their machines' pins.
    const lines = await AtmPlanLineModel.find({
      branchId,
      replenishDate: date,
      status: { $in: ['issued', 'prepared'] },
      isDeleted: false,
    })
      .lean<AtmPlanLineDoc[]>()
      .exec();
    const assigned = new Set(
      (
        await AtmRouteAssignmentModel.find(
          { lineId: { $in: lines.map((l) => l._id) }, isDeleted: false },
          { lineId: 1 },
        )
          .lean<{ lineId: Types.ObjectId }[]>()
          .exec()
      ).map((a) => String(a.lineId)),
    );
    const open = lines.filter((l) => !assigned.has(String(l._id))).sort(bySerial);
    const machineLines = open.filter((l) => l.kind === 'machine' && l.machineId !== null);
    const [zones, points] = await Promise.all([
      this.zonesOf(branchText, ctx),
      this.pointsOf(
        branchText,
        machineLines.map((l) => l.machineId as Types.ObjectId),
        ctx,
      ),
    ]);

    // 4. Each line's primary zone; spares, unlocated and outside lines stay unassigned.
    const primary = this.primaryZones(branchText, zones, points);
    const byZone = new Map<string, AtmPlanLineDoc[]>();
    let unlocated = open.length - machineLines.length;
    let outsideZones = 0;
    for (const line of machineLines) {
      const machineId = String(line.machineId);
      if (!points.has(machineId)) {
        unlocated += 1;
        continue;
      }
      const zone = primary.get(machineId);
      if (zone === undefined) {
        outsideZones += 1;
        continue;
      }
      byZone.set(zone, [...(byZone.get(zone) ?? []), line]);
    }

    // 5. One transaction: reuse or create each zone's route, then assign with `from: null`.
    const by = asId(ctx.userId);
    let outcome: { audits: PendingAudit[]; routesCreated: number; assignedCount: number };
    try {
      outcome = await unitOfWork(async (session) => {
        const audits: PendingAudit[] = [];
        let routesCreated = 0;
        let assignedCount = 0;
        const existing = await AtmDispatchRouteModel.find({
          branchId,
          replenishDate: date,
          isDeleted: false,
        })
          .session(session)
          .lean<AtmDispatchRouteDoc[]>()
          .exec();
        let count = existing.length;
        let order = Math.max(-1, ...existing.map((r) => r.order)) + 1;
        for (const zone of zones) {
          const zoneLines = byZone.get(String(zone._id));
          if (zoneLines === undefined) continue;
          let routeId = existing.find((r) => String(r.zoneId) === String(zone._id))?._id;
          if (routeId === undefined) {
            if (count >= ATM_ROUTES_PER_DAY_MAX) {
              throw new BusinessRuleError(
                `at most ${String(ATM_ROUTES_PER_DAY_MAX)} lines a day in one branch`,
              );
            }
            const [created] = await AtmDispatchRouteModel.create(
              [
                {
                  branchId,
                  replenishDate: date,
                  name: zone.name,
                  nameKey: zoneNameKey(zone.name),
                  leaderName: null,
                  order,
                  zoneId: zone._id,
                  createdBy: by,
                  updatedBy: by,
                },
              ],
              { session },
            );
            const route = created?.toObject() as AtmDispatchRouteDoc;
            routeId = route._id;
            count += 1;
            order += 1;
            routesCreated += 1;
            audits.push({
              entityRef: routeRef(String(route._id)),
              action: 'create',
              changes: diffChanges({}, { ...routeSnapshot(route), replenishDate: date }),
            });
          }
          for (const line of zoneLines) {
            // `from: null`: a line assigned meanwhile is skipped.
            const taken = await AtmRouteAssignmentModel.exists({
              lineId: line._id,
              isDeleted: false,
            })
              .session(session)
              .exec();
            if (taken !== null) continue;
            await AtmRouteAssignmentModel.create(
              [
                {
                  lineId: line._id,
                  routeId,
                  branchId,
                  replenishDate: date,
                  createdBy: by,
                  updatedBy: by,
                },
              ],
              { session },
            );
            assignedCount += 1;
            audits.push({
              entityRef: assignmentRef(String(line._id)),
              action: 'create',
              changes: [{ field: 'routeId', old: null, new: String(routeId) }],
            });
          }
        }
        return { audits, routesCreated, assignedCount };
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new StaleDocumentError();
      throw error;
    }

    // 7. Audits.
    await recordAll(outcome.audits);
    return {
      routesCreated: outcome.routesCreated,
      assigned: outcome.assignedCount,
      unlocated,
      outsideZones,
    };
  }
}

export const atmControlService = new AtmControlService();
