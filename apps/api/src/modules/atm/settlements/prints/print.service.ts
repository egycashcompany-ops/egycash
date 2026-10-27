// The papers and the export (DS-10, DS-21; docs/12-planning/atm-settlements-phase1.md §6.7, §6.9
// C7, §8).
//
// A PRINT IS A WRITE OF RECORD: it reads the plan through the VIEW key's match (404 outside), then
// asks the print key — or the export key — to REACH the plan's branch (403); `hasPermission` only
// tests that a key exists and is never the check. Each one is audited (`atmSettlementPrint`, or
// `export` for the `.xlsx`) with `[{ lineId, serial, version }]` of every line it printed, so the
// printed state can be identified later.
//
// NOTES are counted per line (`notePrintCount`, no `__v` bump: print tracking is not an edit) by
// ONE guarded `updateMany` inside a transaction whose filter carries the serials being printed: a
// reopen that voided one of them between the read and the print makes it match short, and the
// print answers 409 with nothing counted — a Note is never printed with a voided serial.
//
// «بيان التغذية» and «سيلزات» record on the plan which serials they covered, so the plan page can
// say when the paper and the plan no longer agree (`receiptStale`, `handoverStale`, SEC-21).
import {
  ATM_BANK_NAMES,
  ErrorCodes,
  byDenomination,
  isPlanned,
  repTapeComment,
  repTapeSlots,
  type AtmControlPrint,
  type AtmHandoverPrintDto,
  type AtmHandoverPrintRowDto,
  type AtmNotePrintDto,
  type AtmPlanRun,
  type AtmReceiptPrintDto,
  type AtmRepTapeExportDto,
  type AtmRoutesPrintDto,
  type AtmSettlementPrint,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import {
  AppError,
  ForbiddenError,
  StaleDocumentError,
  ValidationError,
} from '../../../../shared/errors';
import { keyReachesBranch, scopeSelector, type AuthContext } from '../../../../shared/types';
import { actorName } from '../../shared/atm-context';
import { branchScopeMatch, narrowToBranch } from '../../shared/branch-scope';
import { AtmDispatchRouteModel, type AtmDispatchRouteDoc } from '../control/dispatch-route.model';
import {
  AtmRouteAssignmentModel,
  type AtmRouteAssignmentDoc,
} from '../control/route-assignment.model';
import { type AtmLinePreparationDoc } from '../preparation/line-preparation.model';
import { plainPlanSlots, preparationsByLine, receiptFigures, bySerial } from '../plans/plan-dto';
import { AtmPlanLineModel, type AtmPlanLineDoc } from '../plans/plan-line.model';
import { atmSettlementPlanService } from '../plans/plan.service';
import { AtmReplenishmentPlanModel, type AtmReplenishmentPlanDoc } from '../plans/plan.model';
import { branchMismatch, branchNameOf, requireWorkBranch } from '../shared/settlement-context';
import { runSettlementHook } from '../shared/test-hooks';

const PLAN_VIEW = 'atmSettlementPlan.view';
const PLAN_PRINT = 'atmSettlementPlan.print';
const PLAN_EXPORT = 'atmSettlementPlan.export';
const CONTROL_VIEW = 'atmControl.view';
const CONTROL_PRINT = 'atmControl.print';
const CONTROL_MANAGE = 'atmControl.manage';

const asId = (id: Types.ObjectId | string): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

const planRef = (id: string) => ({ moduleId: 'atm', entityType: 'settlementPlan', entityId: id });
const routeRef = (id: string) => ({ moduleId: 'atm', entityType: 'dispatchRoute', entityId: id });

const isIssued = (line: Pick<AtmPlanLineDoc, 'status'>): boolean =>
  line.status === 'issued' || line.status === 'prepared';

const requireReach = (ctx: AuthContext, key: string, branchId: Types.ObjectId | string): void => {
  if (!keyReachesBranch(ctx, key, String(branchId))) {
    throw new ForbiddenError('the print key does not reach this branch');
  }
};

/** The issued and prepared lines of a plan, in serial order. */
const issuedLinesOf = async (planId: Types.ObjectId): Promise<AtmPlanLineDoc[]> =>
  (
    await AtmPlanLineModel.find({
      planId,
      status: { $in: ['issued', 'prepared'] },
      isDeleted: false,
    })
      .lean<AtmPlanLineDoc[]>()
      .exec()
  ).sort(bySerial);

/** What a print audit records of each printed line. */
const printedLines = (
  lines: readonly AtmPlanLineDoc[],
  preparations?: ReadonlyMap<string, AtmLinePreparationDoc>,
) =>
  lines.map((l) => ({
    lineId: String(l._id),
    serial: l.serial,
    version: l.__v,
    ...(preparations === undefined
      ? {}
      : { preparationVersion: preparations.get(String(l._id))?.__v ?? null }),
  }));

/** One «سيلزات» row (§8.4); `qrs` only with `withQr` and only for a prepared line (SEC-27). */
const handoverRow = (
  line: AtmPlanLineDoc,
  preparation: AtmLinePreparationDoc | undefined,
  withQr: boolean,
): AtmHandoverPrintRowDto => {
  const prepared = line.status === 'prepared';
  return {
    serial: line.serial ?? 0,
    bankCode: line.bankCode,
    machineCode: line.machineCode,
    machineName: line.machineName,
    spareCode: line.spareCode,
    run: line.run as AtmPlanRun,
    scheduleTime: line.scheduleTime,
    egpTotalMinor: line.egpTotalMinor,
    qrs:
      withQr && prepared && preparation !== undefined
        ? [...preparation.bags].sort((a, b) => a.bag - b.bag).map((b) => b.qr)
        : [],
    typeLabel: line.typeLabel,
    // The paper prints «hubLabel ?? area» (§8.4); the row carries no area of its own.
    hubLabel: line.hubLabel ?? line.area,
    prepared,
  };
};

class AtmSettlementPrintService {
  /** S22 — Settlements' four papers. */
  async print(
    planId: string,
    input: AtmSettlementPrint,
    ctx: AuthContext,
  ): Promise<AtmNotePrintDto | AtmReceiptPrintDto | AtmHandoverPrintDto | AtmRepTapeExportDto> {
    const plan = await atmSettlementPlanService.loadPlan(planId, ctx, PLAN_VIEW);
    switch (input.kind) {
      case 'notes':
        requireReach(ctx, PLAN_PRINT, plan.branchId);
        return this.notes(plan, input);
      case 'receipt':
        requireReach(ctx, PLAN_PRINT, plan.branchId);
        return this.receipt(plan, ctx);
      case 'handover':
        requireReach(ctx, PLAN_PRINT, plan.branchId);
        return this.handover(plan, false, ctx);
      case 'repTape':
        requireReach(ctx, PLAN_EXPORT, plan.branchId);
        return this.repTape(plan);
    }
  }

  private async notes(
    plan: AtmReplenishmentPlanDoc,
    input: Extract<AtmSettlementPrint, { kind: 'notes' }>,
  ): Promise<AtmNotePrintDto> {
    let lines: AtmPlanLineDoc[];
    if (input.lineIds !== undefined) {
      const found = await AtmPlanLineModel.find({
        _id: { $in: input.lineIds.map(asId) },
        planId: plan._id,
        isDeleted: false,
      })
        .lean<AtmPlanLineDoc[]>()
        .exec();
      const byId = new Map(found.map((l) => [String(l._id), l]));
      lines = input.lineIds.map((id, i) => {
        const line = byId.get(id);
        if (line === undefined || !isIssued(line)) {
          throw new AppError(ErrorCodes.ATM_PLAN_LINE_STATE, 422, 'only issued lines print', {
            details: [
              {
                field: `lineIds[${String(i)}]`,
                code: line?.status ?? 'missing',
                message: line?.status ?? 'missing',
              },
            ],
          });
        }
        return line;
      });
      lines = [...new Map(lines.map((l) => [String(l._id), l])).values()].sort(bySerial);
    } else {
      const issued = await issuedLinesOf(plan._id);
      lines = input.unprintedOnly === true ? issued.filter((l) => l.notePrintCount === 0) : issued;
    }

    await runSettlementHook('print.notes.beforeWrite');
    const printedAt = new Date();
    if (lines.length > 0) {
      await unitOfWork(async (session) => {
        const counted = await AtmPlanLineModel.updateMany(
          {
            _id: { $in: lines.map((l) => l._id) },
            planId: plan._id,
            status: { $in: ['issued', 'prepared'] },
            serial: { $in: lines.map((l) => l.serial) },
            isDeleted: false,
          },
          { $inc: { notePrintCount: 1 }, $set: { notePrintedAt: printedAt } },
          { session },
        ).exec();
        if (counted.matchedCount < lines.length) throw new StaleDocumentError();
      });
    }
    await auditService.record({
      entityRef: planRef(String(plan._id)),
      action: 'atmSettlementPrint',
      changes: [
        { field: 'kind', old: null, new: 'notes' },
        { field: 'lines', old: null, new: printedLines(lines) },
      ],
    });
    return {
      branchName: await branchNameOf(String(plan.branchId)),
      bankCode: plan.bankCode,
      bankNameAr: ATM_BANK_NAMES[plan.bankCode].ar,
      replenishDate: plan.replenishDate,
      printedAt: printedAt.toISOString(),
      notes: lines.map((l) => {
        const slots = plainPlanSlots(l.slots).filter(isPlanned);
        return {
          lineId: String(l._id),
          version: l.__v,
          serial: l.serial ?? 0,
          kind: l.kind,
          machineCode: l.machineCode,
          machineName: l.machineName,
          // The Note prints «hubLabel ?? area» in «المنطقة» (§8.2); the DTO carries no area.
          hubLabel: l.hubLabel ?? l.area,
          typeLabel: l.typeLabel,
          featuresLabel: l.featuresLabel,
          spareCode: l.spareCode,
          run: l.run as AtmPlanRun,
          scheduleTime: l.scheduleTime,
          slots,
          bagCount: Math.max(0, ...slots.map((s) => s.bag ?? 0)),
          egpTotalMinor: l.egpTotalMinor,
        };
      }),
    };
  }

  private async receipt(
    plan: AtmReplenishmentPlanDoc,
    ctx: AuthContext,
  ): Promise<AtmReceiptPrintDto> {
    const [lines, drafts] = await Promise.all([
      issuedLinesOf(plan._id),
      AtmPlanLineModel.countDocuments({
        planId: plan._id,
        status: 'draft',
        isDeleted: false,
      }).exec(),
    ]);
    const figures = receiptFigures(lines);
    const serials = lines.flatMap((l) => (l.serial === null ? [] : [l.serial]));
    const printedAt = new Date();
    const byName = actorName(ctx);
    await AtmReplenishmentPlanModel.updateOne(
      { _id: plan._id, isDeleted: false },
      { $set: { receiptPrint: { at: printedAt, byName, serials } } },
    ).exec();
    await auditService.record({
      entityRef: planRef(String(plan._id)),
      action: 'atmSettlementPrint',
      changes: [
        { field: 'kind', old: null, new: 'receipt' },
        { field: 'rows', old: null, new: figures.rows },
        { field: 'egpTotalMinor', old: null, new: figures.egpTotalMinor },
        { field: 'machineCount', old: null, new: figures.machineCount },
        { field: 'lines', old: null, new: printedLines(lines) },
      ],
    });
    return {
      bankCode: plan.bankCode,
      bankNameAr: ATM_BANK_NAMES[plan.bankCode].ar,
      replenishDate: plan.replenishDate,
      printedAt: printedAt.toISOString(),
      rows: figures.rows,
      egpTotalMinor: figures.egpTotalMinor,
      machineCount: figures.machineCount,
      serials,
      excludedDraftLines: drafts,
      previous:
        plan.receiptPrint === null
          ? null
          : {
              at: new Date(plan.receiptPrint.at).toISOString(),
              byName: plan.receiptPrint.byName,
              serials: [...plan.receiptPrint.serials],
            },
    };
  }

  /** «سيلزات»: blank QR boxes from Settlements, the prepared lines' QRs from Control (S-8 a). */
  private async handover(
    plan: AtmReplenishmentPlanDoc,
    withQr: boolean,
    ctx: AuthContext,
  ): Promise<AtmHandoverPrintDto> {
    const lines = await issuedLinesOf(plan._id);
    const preparations = await preparationsByLine(lines.map((l) => l._id));
    const rows = lines.map((l) => handoverRow(l, preparations.get(String(l._id)), withQr));
    const printedAt = new Date();
    await AtmReplenishmentPlanModel.updateOne(
      { _id: plan._id, isDeleted: false },
      {
        $set: {
          handoverPrint: {
            at: printedAt,
            byName: actorName(ctx),
            serials: lines.flatMap((l) => (l.serial === null ? [] : [l.serial])),
          },
        },
      },
    ).exec();
    await auditService.record({
      entityRef: planRef(String(plan._id)),
      action: 'atmSettlementPrint',
      changes: [
        { field: 'kind', old: null, new: 'handover' },
        { field: 'withQr', old: null, new: withQr },
        { field: 'lines', old: null, new: printedLines(lines, preparations) },
      ],
    });
    return {
      bankCode: plan.bankCode,
      replenishDate: plan.replenishDate,
      withQr,
      printedAt: printedAt.toISOString(),
      rows,
      notPrepared: rows.filter((r) => !r.prepared).length,
    };
  }

  /** The `.xlsx` in today's REP. TAPE / ATM_2 shape (S-10, §8.5). */
  private async repTape(plan: AtmReplenishmentPlanDoc): Promise<AtmRepTapeExportDto> {
    const lines = await issuedLinesOf(plan._id);
    await auditService.record({
      entityRef: planRef(String(plan._id)),
      action: 'export',
      changes: [
        { field: 'kind', old: null, new: 'repTape' },
        { field: 'rowCount', old: null, new: lines.length },
        { field: 'serials', old: null, new: lines.map((l) => l.serial) },
      ],
    });
    return {
      bankCode: plan.bankCode,
      replenishDate: plan.replenishDate,
      rows: lines.map((l) => ({
        serial: l.serial ?? 0,
        reference: l.kind === 'spare' ? l.spareCode : l.machineCode,
        location: l.machineName,
        slots: repTapeSlots(l.slots),
        byDenomination: byDenomination(l.slots),
        egpTotalMinor: l.egpTotalMinor,
        comment: repTapeComment(l.scheduleTime),
        dep: l.area,
        typeLabel: l.typeLabel,
        hubLabel: l.hubLabel,
      })),
    };
  }

  /** C7 — Control's «سيلزات» with QRs, and the route sheets. */
  async controlPrint(
    input: AtmControlPrint,
    ctx: AuthContext,
  ): Promise<AtmHandoverPrintDto | AtmRoutesPrintDto> {
    if (input.kind === 'handover') {
      const plan = await atmSettlementPlanService.loadPlan(input.planId, ctx, CONTROL_VIEW);
      requireReach(ctx, CONTROL_PRINT, plan.branchId);
      return this.handover(plan, true, ctx);
    }
    narrowToBranch(scopeSelector(ctx, CONTROL_VIEW), input.branchId, 'body.branchId');
    // §6.2: a body branch must also be the branch the Control page works in.
    const work = await requireWorkBranch(ctx, CONTROL_VIEW, CONTROL_MANAGE);
    if (work.branchId !== input.branchId) throw branchMismatch();
    requireReach(ctx, CONTROL_PRINT, input.branchId);
    return this.routes(input, ctx);
  }

  private async routes(
    input: Extract<AtmControlPrint, { kind: 'routes' }>,
    ctx: AuthContext,
  ): Promise<AtmRoutesPrintDto> {
    const branchId = asId(input.branchId);
    const view = scopeSelector(ctx, CONTROL_VIEW);
    const routes = await AtmDispatchRouteModel.find({
      $and: [
        { isDeleted: false },
        branchScopeMatch(view),
        { branchId, replenishDate: input.replenishDate },
        input.routeIds === undefined ? {} : { _id: { $in: input.routeIds.map(asId) } },
      ],
    } as FilterQuery<AtmDispatchRouteDoc>)
      .sort({ order: 1, _id: 1 })
      .lean<AtmDispatchRouteDoc[]>()
      .exec();
    if (input.routeIds !== undefined) {
      const found = new Set(routes.map((r) => String(r._id)));
      const gone = input.routeIds.findIndex((id) => !found.has(id));
      if (gone !== -1) {
        throw new ValidationError([
          { field: `body.routeIds.${String(gone)}`, code: 'ROUTE_GONE', message: 'no such route' },
        ]);
      }
    }
    const [lines, assignments] = await Promise.all([
      AtmPlanLineModel.find({
        $and: [
          { isDeleted: false },
          branchScopeMatch(view),
          { branchId, replenishDate: input.replenishDate },
          { status: { $in: ['issued', 'prepared'] } },
        ],
      } as FilterQuery<AtmPlanLineDoc>)
        .lean<AtmPlanLineDoc[]>()
        .exec(),
      AtmRouteAssignmentModel.find({
        branchId,
        replenishDate: input.replenishDate,
        isDeleted: false,
      })
        .lean<AtmRouteAssignmentDoc[]>()
        .exec(),
    ]);
    const preparations = await preparationsByLine(lines.map((l) => l._id));
    const routeOf = new Map(assignments.map((a) => [String(a.lineId), String(a.routeId)]));
    const printedAt = new Date();
    const result: AtmRoutesPrintDto = {
      replenishDate: input.replenishDate,
      printedAt: printedAt.toISOString(),
      unassigned: lines.filter((l) => !routeOf.has(String(l._id))).length,
      routes: routes.map((route) => {
        const own = lines
          .filter((l) => routeOf.get(String(l._id)) === String(route._id))
          .sort(bySerial);
        const rows = own.map((l) => handoverRow(l, preparations.get(String(l._id)), true));
        return {
          id: String(route._id),
          name: route.name,
          leaderName: route.leaderName,
          rows,
          machines: new Set(own.flatMap((l) => (l.machineId === null ? [] : [String(l.machineId)])))
            .size,
          bags: own.reduce((sum, l) => sum + Math.max(0, ...l.slots.map((s) => s.bag ?? 0)), 0),
          notPrepared: rows.filter((r) => !r.prepared).length,
        };
      }),
    };
    for (const route of result.routes) {
      const own = lines.filter((l) => routeOf.get(String(l._id)) === route.id);
      await auditService.record({
        entityRef: routeRef(route.id),
        action: 'atmSettlementPrint',
        changes: [
          { field: 'kind', old: null, new: 'routes' },
          { field: 'lines', old: null, new: printedLines(own.sort(bySerial), preparations) },
        ],
      });
    }
    return result;
  }
}

export const atmSettlementPrintService = new AtmSettlementPrintService();
