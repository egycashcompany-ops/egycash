// The plan page's DTOs (docs/12-planning/atm-settlements-phase1.md §6.1, §6.5 "The DTO").
//
// Lines are sorted by serial (issued lines first), then run, time (nulls last) and position. Each
// line's issues (§3.7) are computed against the plan's other lines and the machines' CURRENT state —
// layouts, masters and register banks loaded in one read each. The summary counts non-cancelled
// lines; «بيان التغذية»'s figures cover issued + prepared, `all` every non-cancelled line, drafts too.
// Money is EGP minor units, summed with `sumMinorUnits` (DS-28).
import {
  bagAllocation,
  planLineIssues,
  receiptMachineCount,
  receiptRows,
  sumMinorUnits,
  ATM_PLAN_LINE_STATUSES,
  type AtmLayoutContent,
  type AtmPlanLineDto,
  type AtmPlanLineIssue,
  type AtmPlanLineStatus,
  type AtmPlanRun,
  type AtmPlanSlot,
  type AtmPreparationStatus,
  type AtmReceiptFiguresDto,
  type AtmSettlementPlanDto,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { keyReachesBranch, type AuthContext } from '../../../../shared/types';
import { AtmMachineModel, type AtmMachineDoc } from '../../machines/machine.model';
import { cairoDateString } from '../../shared/cairo-time';
import { liveLayoutsByMachine } from '../layouts/layout.repository';
import { liveStandardLoads, profileFor } from '../standard-loads/standard-load.service';
import {
  AtmLinePreparationModel,
  type AtmLinePreparationDoc,
} from '../preparation/line-preparation.model';
import { preparationStatusOf } from '../shared/preparation-state';
import { machineBanks, type MachineBank } from '../shared/register-bank';
import { type AtmPlanLineDoc } from './plan-line.model';
import { type AtmReplenishmentPlanDoc } from './plan.model';

export const plainPlanSlots = (slots: readonly AtmPlanSlot[]): AtmPlanSlot[] =>
  slots.map((s) => ({
    slot: s.slot,
    kind: s.kind,
    denomination: s.denomination ?? null,
    currency: s.currency ?? null,
    notes: s.notes,
    bag: s.bag ?? null,
  }));

const timeKey = (time: string | null): string => time ?? '99:99';

/** Issue order (DS-11): run, time (nulls last), position. */
export const byIssueOrder = (
  a: Pick<AtmPlanLineDoc, 'run' | 'scheduleTime' | 'position'>,
  b: Pick<AtmPlanLineDoc, 'run' | 'scheduleTime' | 'position'>,
): number =>
  a.run - b.run ||
  timeKey(a.scheduleTime).localeCompare(timeKey(b.scheduleTime)) ||
  a.position - b.position;

/** The plan page's order: serial (issued lines first), then the issue order. */
export const byPlanOrder = (
  a: Pick<AtmPlanLineDoc, 'serial' | 'run' | 'scheduleTime' | 'position'>,
  b: Pick<AtmPlanLineDoc, 'serial' | 'run' | 'scheduleTime' | 'position'>,
): number => {
  if (a.serial !== null && b.serial !== null && a.serial !== b.serial) return a.serial - b.serial;
  if (a.serial !== null && b.serial === null) return -1;
  if (a.serial === null && b.serial !== null) return 1;
  return byIssueOrder(a, b);
};

/** Serial order (prints, Preparation, Control): serial, then the issue order. */
export const bySerial = byPlanOrder;

/** The machines' current state the issue rules read (§3.7 ctx). */
export interface PlanWorld {
  today: string;
  machines: Map<string, Pick<AtmMachineDoc, '_id' | 'isActive'>>;
  /** Each machine's live layout: its revision and the content a line copies (§3.7). */
  layouts: Map<string, { revision: number } & AtmLayoutContent>;
  banks: Map<string, MachineBank>;
  /**
   * Per machine, the profile a refresh fills a line from when the line did not choose its own: the
   * layout's live standard load, else the bank's default (`profileFor`, §6.5 S16 step 1).
   */
  refreshLoads: Map<string, string | null>;
}

const scopeOf = (line: Pick<AtmPlanLineDoc, 'branchId' | 'bankCode'>): string =>
  `${String(line.branchId)}:${line.bankCode}`;

export const loadPlanWorld = async (lines: readonly AtmPlanLineDoc[]): Promise<PlanWorld> => {
  const ids = [
    ...new Set(
      lines.flatMap((l) =>
        l.kind === 'machine' && l.machineId !== null ? [String(l.machineId)] : [],
      ),
    ),
  ];
  const machineLines = lines.filter((l) => l.kind === 'machine' && l.machineId !== null);
  const scopes = [...new Map(machineLines.map((l) => [scopeOf(l), l])).values()];
  const [machines, layouts, banks, loads] = await Promise.all([
    AtmMachineModel.find(
      { _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, isDeleted: false },
      { isActive: 1 },
    )
      .lean<Pick<AtmMachineDoc, '_id' | 'isActive'>[]>()
      .exec(),
    liveLayoutsByMachine(ids),
    machineBanks(ids),
    Promise.all(
      scopes.map(
        async (l) => [scopeOf(l), await liveStandardLoads(l.branchId, l.bankCode)] as const,
      ),
    ).then((pairs) => new Map(pairs)),
  ]);
  const refreshLoads = new Map<string, string | null>();
  for (const line of machineLines) {
    const machineId = String(line.machineId);
    const profile = profileFor(loads.get(scopeOf(line)) ?? [], [
      layouts.get(machineId)?.standardLoadId,
    ]);
    refreshLoads.set(machineId, profile === null ? null : String(profile._id));
  }
  return {
    today: cairoDateString(new Date()),
    machines: new Map(machines.map((m) => [String(m._id), m])),
    layouts: new Map(
      [...layouts].map(([id, doc]) => [
        id,
        {
          revision: doc.revision,
          slots: doc.slots,
          typeLabel: doc.typeLabel,
          featuresLabel: doc.featuresLabel,
          hubLabel: doc.hubLabel,
        },
      ]),
    ),
    banks,
    refreshLoads,
  };
};

/** Machine live and active, and its register bank still the plan's (DS-3). */
export const machinePlannable = (
  line: Pick<AtmPlanLineDoc, 'machineId'>,
  plan: Pick<AtmReplenishmentPlanDoc, 'bankCode'>,
  world: PlanWorld,
): boolean => {
  if (line.machineId === null) return false;
  const id = String(line.machineId);
  const machine = world.machines.get(id);
  return machine !== undefined && machine.isActive && world.banks.get(id)?.bank === plan.bankCode;
};

/** §3.7 for one line of the plan; a cancelled line has none. */
export const issuesOf = (
  line: AtmPlanLineDoc,
  plan: Pick<AtmReplenishmentPlanDoc, 'bankCode' | 'replenishDate'>,
  lines: readonly AtmPlanLineDoc[],
  world: PlanWorld,
): AtmPlanLineIssue[] => {
  if (line.status === 'cancelled') return [];
  const machineId = line.machineId === null ? null : String(line.machineId);
  return planLineIssues(
    {
      kind: line.kind,
      machineId,
      run: line.run,
      scheduleTime: line.scheduleTime,
      status: line.status,
      slots: line.slots,
      typeLabel: line.typeLabel,
      featuresLabel: line.featuresLabel,
      hubLabel: line.hubLabel,
      layoutRevision: line.layoutRevision,
      standardNotes: line.standardNotes,
      standardLoadId: line.standardLoadId === null ? null : String(line.standardLoadId),
      standardLoadChosen: line.standardLoadChosen === true,
    },
    {
      otherLines: lines
        .filter((other) => String(other._id) !== String(line._id))
        .map((other) => ({
          kind: other.kind,
          machineId: other.machineId === null ? null : String(other.machineId),
          run: other.run,
          scheduleTime: other.scheduleTime,
          status: other.status,
        })),
      layout: machineId === null ? null : (world.layouts.get(machineId) ?? null),
      refreshStandardLoadId:
        machineId === null ? null : (world.refreshLoads.get(machineId) ?? null),
      machinePlannable: machinePlannable(line, plan, world),
      replenishDate: plan.replenishDate,
      today: world.today,
    },
  );
};

export const toPlanLineDto = (
  line: AtmPlanLineDoc,
  issues: AtmPlanLineIssue[],
  preparation: AtmLinePreparationDoc | null,
): AtmPlanLineDto => ({
  id: String(line._id),
  version: line.__v,
  kind: line.kind,
  machineId: line.machineId === null ? null : String(line.machineId),
  machineCode: line.machineCode,
  machineName: line.machineName,
  area: line.area,
  typeLabel: line.typeLabel,
  featuresLabel: line.featuresLabel,
  hubLabel: line.hubLabel,
  layoutRevision: line.layoutRevision,
  spareCode: line.spareCode,
  spareUse:
    line.spareUse === null
      ? null
      : {
          machineCode: line.spareUse.machineCode,
          machineName: line.spareUse.machineName,
          at: new Date(line.spareUse.at).toISOString(),
          byName: line.spareUse.byName,
        },
  run: line.run as AtmPlanRun,
  scheduleTime: line.scheduleTime,
  position: line.position,
  status: line.status,
  serial: line.serial,
  voidedSerials: line.voidedSerials.map((v) => ({
    serial: v.serial,
    printCount: v.printCount,
    at: new Date(v.at).toISOString(),
    byName: v.byName,
    reason: v.reason,
  })),
  slots: plainPlanSlots(line.slots),
  countsSource: line.countsSource,
  standardLoadId: line.standardLoadId === null ? null : String(line.standardLoadId),
  standardNotes:
    line.standardNotes === null
      ? null
      : line.standardNotes.map((n) => ({ denomination: n.denomination, notes: n.notes })),
  egpTotalMinor: line.egpTotalMinor,
  preparationStatus:
    line.status === 'draft' || preparation === null
      ? null
      : (preparationStatusOf(preparation, line.slots) satisfies AtmPreparationStatus),
  notePrintCount: line.notePrintCount,
  notePrintedAt: line.notePrintedAt === null ? null : new Date(line.notePrintedAt).toISOString(),
  issues,
});

/** «بيان التغذية»'s figures over the given lines (DS-28, the accepted improvements). */
export const receiptFigures = (lines: readonly AtmPlanLineDoc[]): AtmReceiptFiguresDto => ({
  rows: receiptRows(lines),
  egpTotalMinor: sumMinorUnits(lines.map((l) => l.egpTotalMinor)),
  machineCount: receiptMachineCount(
    lines.map((l) => ({
      kind: l.kind,
      machineId: l.machineId === null ? null : String(l.machineId),
    })),
  ),
});

const isIssued = (line: Pick<AtmPlanLineDoc, 'status'>): boolean =>
  line.status === 'issued' || line.status === 'prepared';

/** The serials a print covers, sorted. */
export const issuedSerials = (lines: readonly AtmPlanLineDoc[]): number[] =>
  lines
    .filter(isIssued)
    .flatMap((l) => (l.serial === null ? [] : [l.serial]))
    .sort((a, b) => a - b);

const sameSerials = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === b[i]);

/** Live preparations of the given lines, by line id. */
export const preparationsByLine = async (
  lineIds: readonly Types.ObjectId[],
): Promise<Map<string, AtmLinePreparationDoc>> => {
  if (lineIds.length === 0) return new Map();
  const docs = await AtmLinePreparationModel.find({ lineId: { $in: lineIds }, isDeleted: false })
    .lean<AtmLinePreparationDoc[]>()
    .exec();
  return new Map(docs.map((doc) => [String(doc.lineId), doc]));
};

export const toPlanDto = async (
  plan: AtmReplenishmentPlanDoc,
  lines: readonly AtmPlanLineDoc[],
  ctx: AuthContext,
): Promise<AtmSettlementPlanDto> => {
  const sorted = [...lines].sort(byPlanOrder);
  const [world, preparations] = await Promise.all([
    loadPlanWorld(sorted),
    preparationsByLine(sorted.map((l) => l._id)),
  ]);
  const live = sorted.filter((l) => l.status !== 'cancelled');
  const issued = sorted.filter(isIssued);
  const serials = issuedSerials(sorted);
  const byStatus = Object.fromEntries(ATM_PLAN_LINE_STATUSES.map((s) => [s, 0])) as Record<
    AtmPlanLineStatus,
    number
  >;
  for (const line of sorted) byStatus[line.status] += 1;
  const branchId = String(plan.branchId);
  return {
    id: String(plan._id),
    version: plan.__v,
    branchId,
    bankCode: plan.bankCode,
    replenishDate: plan.replenishDate,
    lines: sorted.map((line) =>
      toPlanLineDto(
        line,
        issuesOf(line, plan, sorted, world),
        preparations.get(String(line._id)) ?? null,
      ),
    ),
    summary: {
      lines: live.length,
      machines: new Set(live.flatMap((l) => (l.machineId === null ? [] : [String(l.machineId)])))
        .size,
      spares: live.filter((l) => l.kind === 'spare').length,
      bags: live.reduce((sum, l) => sum + bagAllocation(l.slots).length, 0),
      byStatus,
      notPrinted: issued.filter((l) => l.notePrintCount === 0).length,
      receipt: receiptFigures(issued),
      all: receiptFigures(live),
      receiptPrint:
        plan.receiptPrint === null
          ? null
          : { at: new Date(plan.receiptPrint.at).toISOString(), byName: plan.receiptPrint.byName },
      receiptStale: plan.receiptPrint !== null && !sameSerials(plan.receiptPrint.serials, serials),
      handoverPrint:
        plan.handoverPrint === null
          ? null
          : {
              at: new Date(plan.handoverPrint.at).toISOString(),
              byName: plan.handoverPrint.byName,
            },
      handoverStale:
        plan.handoverPrint !== null && !sameSerials(plan.handoverPrint.serials, serials),
    },
    can: {
      manage: keyReachesBranch(ctx, 'atmSettlementPlan.manage', branchId),
      print: keyReachesBranch(ctx, 'atmSettlementPlan.print', branchId),
      export: keyReachesBranch(ctx, 'atmSettlementPlan.export', branchId),
    },
  };
};
