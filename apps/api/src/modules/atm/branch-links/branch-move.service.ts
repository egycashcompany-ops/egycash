// GET/POST /atm/branch-links/:sourceBranchId/move — «نقل البيانات»: a linked source branch's ATM
// data re-filed under its target (contracts atm-settings.ts).
//
// The owner (2026-10-28): «أنا عايز كل ماكينه تظهر فى الفرع بتاعها طبقاً للفرع المتسجله فيه». A link
// answers the source's people as the target from the moment it is saved (link-context.ts), but it
// moves no row: what the workbook import, the register coupling and the mail reader filed under
// October before stays under October, readable only under «كل الشركة». This moves it — once, by an
// administrator, after a preview.
//
// WHO: `atmSettings.manage` at ORGANIZATION scope, at the route and here — the links save's rule
// (shared/settings-authority.ts). WHICH PAIR: the STORED link — the path names the source, the
// target is the stored one, and a branch that is no stored source is 404. Nothing comes from a body.
//
// PREVIEW (read-only): the rows filed under the source per collection, the merges the move would
// make, and the BLOCKERS that refuse it — each found from the rows themselves (aggregation), never
// left to an E11000: the unique indexes keyed by branch may be missing in production (a boot build
// that existing rows violate is skipped, atm-indexes.ts). The rules are pure: branch-move.planner.ts.
//
// MOVE: refused 409 `ATM_BRANCH_MOVE_BLOCKED` with the blockers while any stands; otherwise, under
// the run lock (branch-move-run.model.ts), in this order:
//   1. labels — merged into the target's live row of the same name, retired when the target renamed
//      the name away, moved (deleted rows too: they are the branch's memory, DEC-38);
//   2. machines — each twin that would meet the survivor in the target retired the legacy way
//      (`<code>-D`, deleted), handing its layout and map point to the survivor where it has none,
//      then every source master moved;
//   3. what follows the machines — register entries (a branch-less row has no branch to move),
//      mail tickets, both operation logs, map locations, layouts and their versions;
//   4. the map — zones renamed where the target uses the name and ordered after the target's, the
//      target's zone-set revision moved on (an open zone editor reloads instead of saving over the
//      merged set); dispatch lines likewise per day; then their assignments;
//   5. settlements — standard loads (the target's default stays the default); plans, lines and
//      preparations, the plan blockers re-checked first; Full list runs, a stale running one
//      abandoned first (the import's own takeover). The Note counters are left alone: the next Note
//      issued in the target raises its counter past every moved serial (note-counter.model.ts);
//   6. branch ids inside values — `atm.mail.branchCategories` and `atm.register.branchCodes`
//      re-pointed where the target has none, through the settings service (validated, cached reads
//      dropped, audited); the mailbox list re-pointed through its versioned write, audited;
//   7. what is still under the source, counted — all zero once the run completed.
// Every step reads what is STILL under the source, so a run cut off part-way is continued by running
// it again. A blocker a step's own re-check meets after earlier steps committed stops the run there:
// 409 `ATM_BRANCH_MOVE_STOPPED`, never the refusal's «nothing was moved». A plain move changes
// `branchId` only — no `__v`, no `updatedAt` (the mailbox `lastPoll` precedent), so an open editor
// of a moved row can still save it; a merge that changes what an editor holds moves its version
// (renamed zones and lines, the zone set, a default switched off, a filled label, the mailbox). At
// most 200 rows per transaction (`unitOfWork`, whose callback may run twice: nothing is audited
// inside one).
//
// AFTER: one `atmBranchMove` audit row for the run (not broadcast), then one signal per affected
// topic WITH the target's branch, so branch rooms refresh too (settlements/shared/day-signals.ts).
// A retired twin gets its own `delete` row the moment its batch commits, as the legacy delete
// audits each master: a run cut off later (a deploy ends the process mid-move) still leaves which
// masters it retired; and the run it was gets its `atmBranchMove` row when the next run takes its
// lock over.
import {
  ATM_BRANCH_MOVE_COLLECTIONS,
  AtmSettingKeys,
  ErrorCodes,
  atmBranchMoveTotal,
  emptyAtmBranchMoveCounts,
  emptyAtmBranchMoveMerges,
  type AtmBranchLinksSetting,
  type AtmBranchMoveBlockerDto,
  type AtmBranchMoveCollection,
  type AtmBranchMoveCountsDto,
  type AtmBranchMoveMergesDto,
  type AtmBranchMovePreviewDto,
  type AtmBranchMoveResultDto,
  type AtmBranchMoveRunState,
  type AtmRegisterBranchCodesSetting,
  type AuditChange,
  type LocalizedString,
} from '@ecms/contracts';
import { Types, type ClientSession, type Model } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { branchRepository } from '../../../platform/organization';
import { publishAuditedChange } from '../../../platform/realtime';
import { settingsService } from '../../../platform/settings';
import { AppError, BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { redactedErrorText } from '../atm-indexes';
import { AtmRefLabelModel, type AtmRefLabelDoc } from '../catalogs/ref-label.model';
import { AtmMachineModel, type AtmMachineDoc } from '../machines/machine.model';
import { AtmMailTicketModel } from '../mail-tickets/mail-ticket.model';
import { atmMailboxConfigRepository } from '../mail-tickets/mailbox-config.repository';
import { AtmMaintenanceModel } from '../maintenances/maintenance.model';
import { AtmMachineLocationModel } from '../map/machine-location.model';
import { AtmMapZoneSetModel } from '../map/zone-set.model';
import { AtmMapZoneModel } from '../map/zone.model';
import { STALE_RUN_MS } from '../register/import/plan-import';
import { machineSnapshot } from '../register/register-coupling';
import { AtmRegisterEntryModel } from '../register/register.model';
import { AtmReplenishmentModel } from '../replenishments/replenishment.model';
import {
  AtmDispatchRouteModel,
  type AtmDispatchRouteDoc,
} from '../settlements/control/dispatch-route.model';
import { AtmRouteAssignmentModel } from '../settlements/control/route-assignment.model';
import { AtmLayoutImportRunModel } from '../settlements/import/layout-import-run.model';
import { AtmCassetteLayoutVersionModel } from '../settlements/layouts/cassette-layout-version.model';
import { AtmCassetteLayoutModel } from '../settlements/layouts/cassette-layout.model';
import { AtmPlanLineModel } from '../settlements/plans/plan-line.model';
import { AtmReplenishmentPlanModel } from '../settlements/plans/plan.model';
import { AtmLinePreparationModel } from '../settlements/preparation/line-preparation.model';
import {
  AtmStandardLoadModel,
  type AtmStandardLoadDoc,
} from '../settlements/standard-loads/standard-load.model';
import { actorName } from '../shared/atm-context';
import { asSettingsEditor, assertAtmSettingsManager } from '../shared/settings-authority';
import { branchMoveAuditRef } from './branch-move-run.model';
import { atmBranchMoveRunRepository } from './branch-move-run.repository';
import {
  BRANCH_MOVE_BATCH_SIZE,
  blockerDetails,
  chunks,
  moveSuffixLabel,
  orderedBlockers,
  planLabelMoves,
  planMachineTwins,
  planRouteMoves,
  planStandardLoadMoves,
  planZoneMoves,
  repointBranchRows,
  repointMailboxBranches,
  twinBlockers,
  zoneCapsBlocker,
  type LabelFill,
  type MachineTwinPlan,
  type MoveLabelRow,
  type MoveMachineRow,
  type MoveRouteRow,
  type MoveStandardLoadRow,
  type MoveZoneRow,
} from './branch-move.planner';

/** Organization scope: every ATM setting is one fact about the company. */
const ORG_SUBJECT = { userId: null, branchId: null };

/** Every collection a move re-files, by its contract key. */
const COLLECTION_MODELS = {
  machines: AtmMachineModel,
  registerEntries: AtmRegisterEntryModel,
  mailTickets: AtmMailTicketModel,
  maintenances: AtmMaintenanceModel,
  replenishments: AtmReplenishmentModel,
  refLabels: AtmRefLabelModel,
  machineLocations: AtmMachineLocationModel,
  cassetteLayouts: AtmCassetteLayoutModel,
  cassetteLayoutVersions: AtmCassetteLayoutVersionModel,
  mapZones: AtmMapZoneModel,
  dispatchRoutes: AtmDispatchRouteModel,
  routeAssignments: AtmRouteAssignmentModel,
  standardLoads: AtmStandardLoadModel,
  replenishmentPlans: AtmReplenishmentPlanModel,
  planLines: AtmPlanLineModel,
  linePreparations: AtmLinePreparationModel,
  layoutImportRuns: AtmLayoutImportRunModel,
} as unknown as Record<AtmBranchMoveCollection, Model<never>>;

/**
 * The topic each collection's screens listen on — LITERAL pairs, so the realtime registry spec's
 * source scan sees them. The Full list runs have none: their run audit (`atm.layoutImport`) is
 * excluded from realtime, and the import screen refetches itself.
 */
const COLLECTION_TOPICS: Partial<
  Record<AtmBranchMoveCollection, { moduleId: string; entityType: string }>
> = {
  machines: { moduleId: 'atm', entityType: 'machine' },
  registerEntries: { moduleId: 'atm', entityType: 'registerEntry' },
  mailTickets: { moduleId: 'atm', entityType: 'mailTicket' },
  maintenances: { moduleId: 'atm', entityType: 'maintenance' },
  replenishments: { moduleId: 'atm', entityType: 'replenishment' },
  refLabels: { moduleId: 'atm', entityType: 'refLabel' },
  machineLocations: { moduleId: 'atm', entityType: 'machineLocation' },
  cassetteLayouts: { moduleId: 'atm', entityType: 'cassetteLayout' },
  cassetteLayoutVersions: { moduleId: 'atm', entityType: 'cassetteLayout' },
  mapZones: { moduleId: 'atm', entityType: 'mapZone' },
  dispatchRoutes: { moduleId: 'atm', entityType: 'dispatchRoute' },
  routeAssignments: { moduleId: 'atm', entityType: 'routeAssignment' },
  standardLoads: { moduleId: 'atm', entityType: 'standardLoad' },
  replenishmentPlans: { moduleId: 'atm', entityType: 'settlementPlan' },
  planLines: { moduleId: 'atm', entityType: 'planLine' },
  linePreparations: { moduleId: 'atm', entityType: 'linePreparation' },
};

/** What a retired twin touches beyond the rows the move counts: the machine, its layout and point. */
const TWIN_COLLECTIONS: ReadonlySet<AtmBranchMoveCollection> = new Set<AtmBranchMoveCollection>([
  'machines',
  'machineLocations',
  'cassetteLayouts',
]);

/** The stored link a move works on, with both branches' ECMS names (as the top bar shows them). */
interface MovePair {
  source: string;
  target: string;
  sourceId: Types.ObjectId;
  targetId: Types.ObjectId;
  sourceName: LocalizedString | null;
  targetName: LocalizedString | null;
  /** The target exists and is active — rows are never filed under a branch nobody can open. */
  targetActive: boolean;
}

/** A twin the move retired — named on the run's audit row, so the machine's fate can be traced. */
type RetiredTwin = MachineTwinPlan['retire'][number] & {
  /** Its cassette layout, with every version, went to the survivor, which had none. */
  layoutAdopted: boolean;
  /** Its map point went to the survivor, which had none. */
  locationAdopted: boolean;
};

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/**
 * The rows of a planned collection that move plainly after the plan — the deleted ones. A LIVE row
 * the plan did not write (filed there meanwhile) stays for the next run to plan: moved blind it
 * could bring a second zone, line or default of one name into the target.
 */
const NOT_LIVE = { isDeleted: { $ne: false } };

const blocked = (blockers: readonly AtmBranchMoveBlockerDto[]): AppError =>
  new AppError(
    ErrorCodes.ATM_BRANCH_MOVE_BLOCKED,
    409,
    'the move is refused until what blocks it is resolved',
    { details: blockerDetails(blockers) },
  );

/**
 * A blocker a step's own re-check met after earlier steps had committed: the run STOPPED part-way.
 * `ATM_BRANCH_MOVE_BLOCKED` promises nothing was moved, which is no longer true — the administrator
 * would be told the move did not run while half the source's data sits under the target. Same
 * details; anything else stays what it was.
 */
const stoppedPartWay = (error: unknown, wrote: boolean): unknown =>
  wrote && error instanceof AppError && error.code === ErrorCodes.ATM_BRANCH_MOVE_BLOCKED
    ? new AppError(
        ErrorCodes.ATM_BRANCH_MOVE_STOPPED,
        409,
        'the move stopped part-way; what it moved stays moved',
        error.details === undefined ? {} : { details: error.details },
      )
    : error;

/** The run's one `atmBranchMove` audit row: the stored pair, how it ended, and its counts. */
const runAuditChanges = (run: {
  source: string;
  target: string;
  state: AtmBranchMoveRunState;
  moved: AtmBranchMoveCountsDto;
  merges: AtmBranchMoveMergesDto;
  remaining: AtmBranchMoveCountsDto | null;
}): AuditChange[] => [
  { field: 'sourceBranchId', old: null, new: run.source },
  { field: 'targetBranchId', old: null, new: run.target },
  { field: 'state', old: null, new: run.state },
  { field: 'moved', old: null, new: run.moved },
  { field: 'merges', old: null, new: run.merges },
  { field: 'remaining', old: null, new: run.remaining },
];

/** Created before the last 30 minutes: a `running` row that old belongs to a dead request. */
const isStale = (startedAt: Date, now: Date): boolean =>
  startedAt.getTime() < now.getTime() - STALE_RUN_MS;

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────

/** Rows filed under the branch, per collection — every row, deleted ones included. */
const countsUnder = async (branchId: Types.ObjectId): Promise<AtmBranchMoveCountsDto> => {
  const counts = emptyAtmBranchMoveCounts();
  await Promise.all(
    ATM_BRANCH_MOVE_COLLECTIONS.map(async (collection) => {
      counts[collection] = await COLLECTION_MODELS[collection].collection.countDocuments({
        branchId,
      });
    }),
  );
  return counts;
};

/** The ids filed under the branch, oldest first — of every row, or of the rows `filter` keeps. */
const idsUnder = async (
  collection: AtmBranchMoveCollection,
  branchId: Types.ObjectId,
  filter: Record<string, unknown> = {},
): Promise<Types.ObjectId[]> => {
  const rows = await COLLECTION_MODELS[collection].collection
    .find({ ...filter, branchId }, { projection: { _id: 1 } })
    .sort({ _id: 1 })
    .toArray();
  return rows.map((row) => row._id as Types.ObjectId);
};

/**
 * Every label of the branch, deleted ones included. A field a row written before it existed lacks
 * reads as its default; a row with no `isDeleted: false` is outside the live unique index, and
 * every live read, so it counts as deleted.
 */
const labelRowsOf = async (branchId: Types.ObjectId): Promise<MoveLabelRow[]> => {
  const rows = await AtmRefLabelModel.find(
    { branchId },
    { kind: 1, name: 1, nameAr: 1, nameEn: 1, formerNames: 1, bankCode: 1, isDeleted: 1 },
  )
    .sort({ _id: 1 })
    .lean<Partial<AtmRefLabelDoc>[]>()
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    kind: String(row.kind),
    name: String(row.name),
    nameAr: row.nameAr ?? null,
    nameEn: row.nameEn ?? null,
    formerNames: row.formerNames ?? [],
    bankCode: row.bankCode ?? null,
    isDeleted: row.isDeleted !== false,
  }));
};

/**
 * The live masters of every code BOTH branches hold — found by grouping, not by a duplicate-key
 * error — with what each holds: an open register entry coupled to it, an open operation or a draft
 * or issued plan line naming it.
 */
const machineTwinRows = async (pair: MovePair): Promise<MoveMachineRow[]> => {
  const groups = await AtmMachineModel.aggregate<{
    _id: string;
    rows: { id: Types.ObjectId; branchId: Types.ObjectId; isActive: unknown }[];
  }>([
    { $match: { branchId: { $in: [pair.sourceId, pair.targetId] }, isDeleted: false } },
    {
      $group: {
        _id: '$machineCode',
        branches: { $addToSet: '$branchId' },
        rows: { $push: { id: '$_id', branchId: '$branchId', isActive: '$isActive' } },
      },
    },
    { $match: { 'branches.1': { $exists: true } } },
  ]).exec();
  const ids = groups.flatMap((group) => group.rows.map((row) => row.id));
  if (ids.length === 0) return [];
  const open = { machineId: { $in: ids }, closedAt: null, isDeleted: false };
  const [entries, replenishments, maintenances, planLines] = await Promise.all([
    AtmRegisterEntryModel.distinct('machineId', {
      machineId: { $in: ids },
      status: 'open',
      isDeleted: false,
    }).exec(),
    AtmReplenishmentModel.distinct('machineId', open).exec(),
    AtmMaintenanceModel.distinct('machineId', open).exec(),
    // A draft or issued line still has to be issued or prepared, and `machinePlannable` reads live
    // masters only; a prepared or cancelled one is history, kept as its snapshot (review finding).
    AtmPlanLineModel.distinct('machineId', {
      machineId: { $in: ids },
      kind: 'machine',
      status: { $in: ['draft', 'issued'] },
      isDeleted: false,
    }).exec(),
  ]);
  const holdsEntry = new Set(entries.map(String));
  const holdsOperation = new Set([...replenishments, ...maintenances, ...planLines].map(String));
  return groups.flatMap((group) =>
    group.rows.map((row) => ({
      id: String(row.id),
      side: String(row.branchId) === pair.target ? ('target' as const) : ('source' as const),
      machineCode: group._id,
      isActive: row.isActive === true,
      holdsOpenEntry: holdsEntry.has(String(row.id)),
      holdsOpenOperation: holdsOperation.has(String(row.id)),
    })),
  );
};

/** The branch's live zones in their order, each with its number of points. */
const liveZoneRows = async (
  branchId: Types.ObjectId,
  session: ClientSession | null = null,
): Promise<MoveZoneRow[]> => {
  const rows = await AtmMapZoneModel.aggregate<{
    _id: Types.ObjectId;
    name: string;
    order: number;
    points: number;
  }>([
    { $match: { branchId, isDeleted: false } },
    { $project: { name: 1, order: 1, points: { $size: { $ifNull: ['$points', []] } } } },
    { $sort: { order: 1, _id: 1 } },
  ])
    .session(session)
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    name: row.name,
    order: row.order,
    points: row.points,
  }));
};

/** The branch's live dispatch lines, of the given days or of every day. */
const liveRouteRows = async (
  branchId: Types.ObjectId,
  days: readonly string[] | null,
  session: ClientSession | null = null,
): Promise<MoveRouteRow[]> => {
  const rows = await AtmDispatchRouteModel.find(
    {
      branchId,
      isDeleted: false,
      ...(days === null ? {} : { replenishDate: { $in: [...days] } }),
    },
    { replenishDate: 1, name: 1, nameKey: 1, order: 1 },
  )
    .sort({ replenishDate: 1, order: 1, _id: 1 })
    .session(session)
    .lean<Pick<AtmDispatchRouteDoc, '_id' | 'replenishDate' | 'name' | 'nameKey' | 'order'>[]>()
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    replenishDate: row.replenishDate,
    name: row.name,
    nameKey: row.nameKey,
    order: row.order,
  }));
};

/** The branch's live standard loads, of the given banks or of every bank. */
const liveLoadRows = async (
  branchId: Types.ObjectId,
  bankCodes: readonly string[] | null,
  session: ClientSession | null = null,
): Promise<MoveStandardLoadRow[]> => {
  const rows = await AtmStandardLoadModel.find(
    {
      branchId,
      isDeleted: false,
      ...(bankCodes === null ? {} : { bankCode: { $in: [...bankCodes] } }),
    },
    { bankCode: 1, isDefault: 1, order: 1 },
  )
    .sort({ bankCode: 1, order: 1, _id: 1 })
    .session(session)
    .lean<Pick<AtmStandardLoadDoc, '_id' | 'bankCode' | 'isDefault' | 'order'>[]>()
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    bankCode: row.bankCode,
    isDefault: row.isDefault,
    order: row.order,
  }));
};

/**
 * Banks whose Notes collide: a serial — on a live line, or voided by a reopen — the other branch
 * also used for the same bank (`ux_branch_bank_serial`; the counter's floor reads both kinds,
 * plan.service.ts `serialFloor`). Each branch's sequence starts at 1, and a serial printed on a
 * «محضر جرد» Note is never renumbered.
 */
const serialCollisionBanks = async (pair: MovePair): Promise<string[]> => {
  const rows = await AtmPlanLineModel.aggregate<{ _id: string }>([
    { $match: { branchId: { $in: [pair.sourceId, pair.targetId] } } },
    {
      $project: {
        branchId: 1,
        bankCode: 1,
        serials: {
          $concatArrays: [
            {
              $cond: [
                { $and: [{ $eq: ['$isDeleted', false] }, { $gt: ['$serial', 0] }] },
                ['$serial'],
                [],
              ],
            },
            { $map: { input: { $ifNull: ['$voidedSerials', []] }, as: 'v', in: '$$v.serial' } },
          ],
        },
      },
    },
    { $unwind: '$serials' },
    { $match: { serials: { $gt: 0 } } },
    {
      $group: {
        _id: { bankCode: '$bankCode', serial: '$serials' },
        branches: { $addToSet: '$branchId' },
      },
    },
    { $match: { 'branches.1': { $exists: true } } },
    { $group: { _id: '$_id.bankCode' } },
    { $sort: { _id: 1 } },
  ]).exec();
  return rows.map((row) => row._id);
};

/** (bank, day) pairs with a live plan in both branches (`ux_branch_bank_date`). */
const sameDayPlans = async (
  pair: MovePair,
): Promise<{ bankCode: string; replenishDate: string }[]> => {
  const rows = await AtmReplenishmentPlanModel.aggregate<{
    _id: { bankCode: string; replenishDate: string };
  }>([
    { $match: { branchId: { $in: [pair.sourceId, pair.targetId] }, isDeleted: false } },
    {
      $group: {
        _id: { bankCode: '$bankCode', replenishDate: '$replenishDate' },
        branches: { $addToSet: '$branchId' },
      },
    },
    { $match: { 'branches.1': { $exists: true } } },
    { $sort: { '_id.replenishDate': 1, '_id.bankCode': 1 } },
  ]).exec();
  return rows.map((row) => ({ bankCode: row._id.bankCode, replenishDate: row._id.replenishDate }));
};

/** The plan blockers, as they stand now. */
const planBlockers = async (pair: MovePair): Promise<AtmBranchMoveBlockerDto[]> => {
  const [banks, items] = await Promise.all([serialCollisionBanks(pair), sameDayPlans(pair)]);
  return [
    ...(banks.length > 0 ? [{ kind: 'planSerialCollision' as const, bankCodes: banks }] : []),
    ...(items.length > 0 ? [{ kind: 'planSameDay' as const, items }] : []),
  ];
};

/** The source's Full list imports left `running`: stale ones are taken over, fresh ones block. */
const runningLayoutImports = async (
  pair: MovePair,
  now: Date,
): Promise<{ stale: number; freshBanks: string[] }> => {
  const runs = await AtmLayoutImportRunModel.find(
    { branchId: pair.sourceId, state: 'running' },
    { bankCode: 1, startedAt: 1 },
  )
    .lean<{ bankCode: string; startedAt: Date }[]>()
    .exec();
  const fresh = runs.filter((run) => !isStale(run.startedAt, now));
  return {
    stale: runs.length - fresh.length,
    freshBanks: [...new Set(fresh.map((run) => run.bankCode))].sort(),
  };
};

/** The mailbox document and its switched-on list as it would be saved — null: nothing to change. */
const mailboxRepoint = async (pair: MovePair) => {
  const doc = await atmMailboxConfigRepository.findSingleton();
  if (doc === null) return null;
  const rows = doc.branches.map((row) => ({
    branchId: String(row.branchId),
    category: row.category,
  }));
  const next = repointMailboxBranches(rows, pair.source, pair.target);
  return next === null ? null : { doc, rows, next };
};

/**
 * The two settings whose values name branches, re-pointed where the target has none of its own. A
 * value read as its default — none stored, or a stored one the schema no longer accepts — names no
 * branch and is never written back.
 */
const settingsRepoint = async (pair: MovePair) => {
  const [categories, codes] = await Promise.all([
    settingsService.resolve<{ branchId: string; category: string }[]>(
      AtmSettingKeys.MailBranchCategories,
      ORG_SUBJECT,
    ),
    settingsService.resolve<AtmRegisterBranchCodesSetting>(
      AtmSettingKeys.RegisterBranchCodes,
      ORG_SUBJECT,
    ),
  ]);
  return {
    categories: repointBranchRows(categories, pair.source, pair.target),
    codes: repointBranchRows(codes, pair.source, pair.target),
  };
};

// ── Writes ────────────────────────────────────────────────────────────────────────────────────

/** A plain move of the given rows: `branchId` and nothing else — no version, no timestamp. */
const moveIds = async (
  collection: AtmBranchMoveCollection,
  ids: readonly Types.ObjectId[],
  pair: MovePair,
): Promise<number> => {
  let moved = 0;
  for (const batch of chunks(ids)) {
    moved += await unitOfWork(async (session) => {
      const result = await COLLECTION_MODELS[collection].collection.updateMany(
        { _id: { $in: batch }, branchId: pair.sourceId },
        { $set: { branchId: pair.targetId } },
        { session },
      );
      return result.modifiedCount;
    });
  }
  return moved;
};

/**
 * Inside a retire's transaction: the twin as it is NOW, against the plan. Gone (retired or deleted
 * meanwhile) is fine — the write then matches nothing. Reactivated or archived since, or holding
 * open work it did not hold when planned (an open entry, operation or draft/issued plan line), and
 * the run stops on it: `machineTwinOpen`, which a step turns into `ATM_BRANCH_MOVE_STOPPED`.
 */
const refuseChangedTwin = async (
  twin: MachineTwinPlan['retire'][number],
  plannedActive: boolean,
  session: ClientSession,
): Promise<void> => {
  const id = oid(twin.id);
  const now = await AtmMachineModel.findOne({
    _id: id,
    isDeleted: false,
    machineCode: twin.machineCode,
  })
    .session(session)
    .lean<Pick<AtmMachineDoc, 'isActive'>>()
    .exec();
  if (now === null) return;
  const open = { machineId: id, closedAt: null, isDeleted: false };
  const holdsWork =
    (await AtmRegisterEntryModel.exists({ machineId: id, status: 'open', isDeleted: false })
      .session(session)
      .exec()) !== null ||
    (await AtmReplenishmentModel.exists(open).session(session).exec()) !== null ||
    (await AtmMaintenanceModel.exists(open).session(session).exec()) !== null ||
    (await AtmPlanLineModel.exists({
      machineId: id,
      kind: 'machine',
      status: { $in: ['draft', 'issued'] },
      isDeleted: false,
    })
      .session(session)
      .exec()) !== null;
  if (now.isActive !== plannedActive || holdsWork) {
    throw blocked([{ kind: 'machineTwinOpen', codes: [twin.machineCode] }]);
  }
};

/**
 * What a retired twin hands to the master that stays (review finding: the survivor could not be
 * planned until the Full list was imported again): its cassette layout with every version, and its
 * map point — each only where the survivor has none, so nothing the survivor holds is replaced and
 * `ux_machine` / `ux_machine_revision` are never met; otherwise they stay with the retired master,
 * as the legacy delete leaves them. `machineId` only, through the driver: no revision, version or
 * timestamp moves, since the layout itself did not change. A row still under the source moves to
 * the target in step 3 with the rest. Inside the retire's own transaction, after its write.
 */
const adoptTwinConfig = async (
  twin: MachineTwinPlan['retire'][number],
  session: ClientSession,
): Promise<{ layoutAdopted: boolean; locationAdopted: boolean }> => {
  const from = oid(twin.id);
  const to = oid(twin.survivorId);
  let layoutAdopted = false;
  const survivorLayouts = await AtmCassetteLayoutModel.collection.countDocuments(
    { machineId: to },
    { session },
  );
  const survivorVersions = await AtmCassetteLayoutVersionModel.collection.countDocuments(
    { machineId: to },
    { session },
  );
  if (survivorLayouts === 0 && survivorVersions === 0) {
    const layouts = await AtmCassetteLayoutModel.collection.updateMany(
      { machineId: from },
      { $set: { machineId: to } },
      { session },
    );
    await AtmCassetteLayoutVersionModel.collection.updateMany(
      { machineId: from },
      { $set: { machineId: to } },
      { session },
    );
    layoutAdopted = layouts.modifiedCount > 0;
  }
  let locationAdopted = false;
  const survivorPoints = await AtmMachineLocationModel.collection.countDocuments(
    { machineId: to, isDeleted: false },
    { session },
  );
  if (survivorPoints === 0) {
    const points = await AtmMachineLocationModel.collection.updateMany(
      { machineId: from, isDeleted: false },
      { $set: { machineId: to } },
      { session },
    );
    locationAdopted = points.modifiedCount > 0;
  }
  return { layoutAdopted, locationAdopted };
};

/**
 * A plain move of every row still under the source (or every row `filter` keeps) — again while a
 * pass finds rows, so a row filed there during the pass goes too; a pass that moves nothing ends it
 * (the final count reports what could not be moved).
 */
const moveAll = async (
  collection: AtmBranchMoveCollection,
  pair: MovePair,
  filter: Record<string, unknown> = {},
): Promise<number> => {
  let moved = 0;
  for (;;) {
    const ids = await idsUnder(collection, pair.sourceId, filter);
    if (ids.length === 0) return moved;
    const pass = await moveIds(collection, ids, pair);
    moved += pass;
    if (pass === 0) return moved;
  }
};

/**
 * What a label merge fills on the row that stays — written as a condition on the row itself, so a
 * value set since the plan was read is never overwritten, and a former name never added twice.
 * Literals are wrapped: a label's text is data, never a field path.
 */
const fillLabel = async (
  targetId: string,
  fill: LabelFill,
  by: Types.ObjectId,
  session: ClientSession,
): Promise<void> => {
  const formerNames = { $ifNull: ['$formerNames', []] };
  await AtmRefLabelModel.collection.updateOne(
    { _id: oid(targetId) },
    [
      {
        $set: {
          bankCode: { $ifNull: ['$bankCode', { $literal: fill.bankCode }] },
          nameAr: { $ifNull: ['$nameAr', { $literal: fill.nameAr }] },
          nameEn: { $ifNull: ['$nameEn', { $literal: fill.nameEn }] },
          formerNames: {
            $concatArrays: [
              formerNames,
              {
                $filter: {
                  input: { $literal: fill.formerNames },
                  as: 'former',
                  cond: {
                    $and: [
                      { $not: [{ $in: ['$$former', formerNames] }] },
                      { $ne: ['$$former', '$name'] },
                    ],
                  },
                },
              },
            ],
          },
          __v: { $add: [{ $ifNull: ['$__v', 0] }, 1] },
          updatedBy: { $literal: by },
          updatedAt: '$$NOW',
        },
      },
    ],
    { session },
  );
};

let beforeSettlements: (() => Promise<void>) | null = null;

/**
 * Runs ONCE between the map steps and the settlements' re-check, so a test can commit a change in
 * between and see a run cut off part-way (the map's `setSyncBeforeWriteForTests` precedent). In
 * production nothing is set and the point is a no-op.
 */
export const setBeforeSettlementsForTests = (fn: (() => Promise<void>) | null): void => {
  beforeSettlements = fn;
};

let beforeTwinRetire: (() => Promise<void>) | null = null;

/**
 * Runs ONCE between the twin plan and its first retire, so a test can change a planned twin in
 * between and see the retire's own re-check stop the run. A no-op in production.
 */
export const setBeforeTwinRetireForTests = (fn: (() => Promise<void>) | null): void => {
  beforeTwinRetire = fn;
};

/** T's zone-set revision moved on — or its set created at revision 1 (a branch never saved). */
const bumpZoneSet = async (
  targetId: Types.ObjectId,
  by: Types.ObjectId,
  session: ClientSession,
): Promise<void> => {
  const bumped = await AtmMapZoneSetModel.updateOne(
    { branchId: targetId },
    { $inc: { revision: 1, __v: 1 }, $set: { updatedBy: by } },
    { session },
  ).exec();
  if (bumped.matchedCount === 0) {
    await AtmMapZoneSetModel.create(
      [{ branchId: targetId, revision: 1, createdBy: by, updatedBy: by }],
      { session },
    );
  }
};

class AtmBranchMoveService {
  /** GET — what a move would do now. Read-only. */
  async preview(sourceBranchId: string, ctx: AuthContext): Promise<AtmBranchMovePreviewDto> {
    assertAtmSettingsManager(ctx);
    return this.previewOf(await this.pairOf(sourceBranchId), null);
  }

  /** POST — the move, under the run lock. 409 with the blockers while any stands. */
  async move(
    sourceBranchId: string,
    ctx: AuthContext,
    expectedTargetBranchId?: string,
  ): Promise<AtmBranchMoveResultDto> {
    assertAtmSettingsManager(ctx);
    const pair = await this.pairOf(sourceBranchId);
    // The target the reader confirmed, from the preview they read — a precondition, never an
    // authority: re-pointed since (another administrator), nothing moves (review finding).
    if (expectedTargetBranchId !== undefined && expectedTargetBranchId !== pair.target) {
      throw new AppError(
        ErrorCodes.ATM_BRANCH_MOVE_TARGET_CHANGED,
        409,
        'the link was re-pointed since the preview — read the preview again',
      );
    }
    if (!pair.targetActive) {
      throw new BusinessRuleError(
        'the branch the source works as does not exist or is not active — fix the link first',
      );
    }

    // The lock: a run that died 30 minutes ago is taken over, then this run's row is the lock. The
    // run taken over died before its end, so before its audit row: it gets that row now, as it
    // ended — `failed`, with the counts its last finished step recorded, in its own actor's name.
    const startedAt = new Date();
    for (const dead of await atmBranchMoveRunRepository.failStale(startedAt)) {
      await auditService.record({
        entityRef: branchMoveAuditRef(String(dead._id)),
        action: 'atmBranchMove',
        changes: [
          ...runAuditChanges({
            source: String(dead.sourceBranchId),
            target: String(dead.targetBranchId),
            state: dead.state,
            moved: dead.moved,
            merges: dead.merges,
            remaining: dead.remaining,
          }),
          { field: 'error', old: null, new: dead.error },
        ],
        actor: {
          userId: dead.actorUserId === null ? null : String(dead.actorUserId),
          ip: null,
          userAgent: null,
        },
      });
    }
    const runId = await atmBranchMoveRunRepository.start({
      sourceBranchId: pair.source,
      targetBranchId: pair.target,
      actorUserId: ctx.userId,
      actorName: actorName(ctx),
      startedAt,
    });
    if (runId === null) {
      const { blockers } = await this.previewOf(pair, null);
      throw blocked(
        blockers.some((blocker) => blocker.kind === 'moveRunning')
          ? blockers
          : [...blockers, { kind: 'moveRunning' }],
      );
    }

    // Judged under the lock, so nothing another run does can slip in between. Refused here, the run
    // never wrote: its row goes, and the lock with it.
    let locked: AtmBranchMovePreviewDto;
    try {
      locked = await this.previewOf(pair, runId);
    } catch (error) {
      await atmBranchMoveRunRepository.release(runId);
      throw error;
    }
    if (locked.blockers.length > 0) {
      await atmBranchMoveRunRepository.release(runId);
      throw blocked(locked.blockers);
    }

    const by = oid(ctx.userId);
    const moved = emptyAtmBranchMoveCounts();
    const merges = emptyAtmBranchMoveMerges();
    const retired: RetiredTwin[] = [];
    const step = async (work: () => Promise<void>): Promise<void> => {
      await work();
      await atmBranchMoveRunRepository.progress(runId, moved, merges);
    };
    let failure: unknown;
    let remaining: AtmBranchMoveCountsDto | null = null;
    try {
      await step(async () => {
        const labels = await this.moveLabels(pair, by);
        moved.refLabels = labels.moved;
        merges.labelsMerged = labels.merged;
        merges.labelsRetired = labels.retired;
      });
      await step(async () => {
        try {
          moved.machines = await this.moveMachines(pair, by, retired);
        } finally {
          // The twins retired by batches that committed count even when a later batch stopped the
          // run: the error is then STOPPED, never «nothing was moved», and the run's record and
          // audit row name them (review finding).
          merges.machineTwinsRetired = retired.length;
        }
      });
      for (const collection of [
        'registerEntries',
        'mailTickets',
        'maintenances',
        'replenishments',
        'machineLocations',
        'cassetteLayouts',
        'cassetteLayoutVersions',
      ] as const) {
        await step(async () => {
          moved[collection] = await moveAll(collection, pair);
        });
      }
      const label = moveSuffixLabel(pair.sourceName);
      await step(async () => {
        const zones = await this.moveZones(pair, by, label);
        moved.mapZones = zones.moved;
        merges.zonesRenamed = zones.renamed;
      });
      await step(async () => {
        const routes = await this.moveRoutes(pair, by, label);
        moved.dispatchRoutes = routes.moved;
        merges.routesRenamed = routes.renamed;
        moved.routeAssignments = await moveAll('routeAssignments', pair);
      });
      await step(async () => {
        const loads = await this.moveStandardLoads(pair, by);
        moved.standardLoads = loads.moved;
        merges.standardLoadDefaultsUnset = loads.defaultsUnset;
      });
      if (beforeSettlements !== null) {
        const hook = beforeSettlements;
        beforeSettlements = null;
        await hook();
      }
      await step(async () => {
        const standing = await planBlockers(pair);
        if (standing.length > 0) throw blocked(standing);
        moved.replenishmentPlans = await moveAll('replenishmentPlans', pair);
        moved.planLines = await moveAll('planLines', pair);
        moved.linePreparations = await moveAll('linePreparations', pair);
      });
      await step(async () => {
        const runs = await this.moveLayoutImportRuns(pair);
        moved.layoutImportRuns = runs.moved;
        merges.layoutImportRunsAbandoned = runs.abandoned;
      });
      await step(async () => {
        merges.settingsRepointed = await this.repointSettings(pair, ctx);
        merges.mailboxRepointed = await this.repointMailbox(pair, ctx);
      });
      // 7. What is left under the source — all zero once every step ran.
      remaining = await countsUnder(pair.sourceId);
    } catch (error) {
      // A failed run keeps what it moved; running it again carries on from the rows still there.
      // The step it failed in counted nothing yet, so its record says what left the source since
      // the lock was taken — the run's own work, short of rows filed there meanwhile.
      remaining = await countsUnder(pair.sourceId).catch(() => null);
      for (const collection of ATM_BRANCH_MOVE_COLLECTIONS) {
        const left =
          locked.counts[collection] - (remaining?.[collection] ?? locked.counts[collection]);
        moved[collection] = Math.max(moved[collection], left);
      }
      // Judged on what is known to have left the source (or been retired in the target), so the
      // run's record, its audit row and the 409 all say the same.
      failure = stoppedPartWay(error, atmBranchMoveTotal(moved) > 0 || retired.length > 0);
    }

    const state = failure === undefined ? 'done' : 'failed';
    await atmBranchMoveRunRepository.finish(runId, {
      state,
      moved,
      merges,
      remaining,
      error: failure === undefined ? null : redactedErrorText(failure),
    });

    // After the run, once: its audit row, then one signal per affected topic on the target.
    const changes = runAuditChanges({
      source: pair.source,
      target: pair.target,
      state,
      moved,
      merges,
      remaining,
    });
    if (retired.length > 0) {
      changes.push({
        field: 'retiredMachines',
        old: null,
        new: retired.map((twin) => ({
          machineId: twin.id,
          machineCode: twin.machineCode,
          branchId: twin.side === 'source' ? pair.source : pair.target,
          survivorId: twin.survivorId,
          layoutAdopted: twin.layoutAdopted,
          locationAdopted: twin.locationAdopted,
        })),
      });
    }
    await auditService.record({
      entityRef: branchMoveAuditRef(String(runId)),
      action: 'atmBranchMove',
      changes,
    });
    this.signal(String(runId), pair.target, moved, merges);

    if (failure !== undefined) throw failure;
    return {
      runId: String(runId),
      sourceBranchId: pair.source,
      sourceBranchName: pair.sourceName,
      targetBranchId: pair.target,
      targetBranchName: pair.targetName,
      moved,
      total: atmBranchMoveTotal(moved),
      merges,
      remaining: remaining ?? emptyAtmBranchMoveCounts(),
    };
  }

  /** The STORED link whose source the path names — 404 for any other branch. */
  private async pairOf(sourceBranchId: string): Promise<MovePair> {
    const links = await settingsService.resolve<AtmBranchLinksSetting>(
      AtmSettingKeys.BranchLinks,
      ORG_SUBJECT,
    );
    const link = links.find((row) => row.branchId === sourceBranchId);
    if (link === undefined) throw new NotFoundError('no stored branch link has this source');
    const branches = await branchRepository.findByIdsSystem([link.branchId, link.actsAsBranchId]);
    const live = branches.filter((branch) => !branch.isDeleted);
    const nameOf = (id: string): LocalizedString | null => {
      const branch = live.find((row) => String(row._id) === id);
      return branch === undefined ? null : { ar: branch.name.ar, en: branch.name.en };
    };
    return {
      source: link.branchId,
      target: link.actsAsBranchId,
      sourceId: oid(link.branchId),
      targetId: oid(link.actsAsBranchId),
      sourceName: nameOf(link.branchId),
      targetName: nameOf(link.actsAsBranchId),
      targetActive: live.some(
        (branch) => String(branch._id) === link.actsAsBranchId && branch.status === 'active',
      ),
    };
  }

  /** The preview — `ownRunId` is the caller's own lock, which blocks nothing. */
  private async previewOf(
    pair: MovePair,
    ownRunId: Types.ObjectId | null,
  ): Promise<AtmBranchMovePreviewDto> {
    const now = new Date();
    const label = moveSuffixLabel(pair.sourceName);
    const merges = emptyAtmBranchMoveMerges();
    const blockers: AtmBranchMoveBlockerDto[] = [];

    const counts = await countsUnder(pair.sourceId);

    const labels = planLabelMoves(
      await labelRowsOf(pair.sourceId),
      await labelRowsOf(pair.targetId),
    );
    merges.labelsMerged = labels.merged;
    merges.labelsRetired = labels.retired;

    const twins = planMachineTwins(await machineTwinRows(pair));
    merges.machineTwinsRetired = twins.retire.length;
    blockers.push(...twinBlockers(twins));

    const sourceZones = await liveZoneRows(pair.sourceId);
    const targetZones = await liveZoneRows(pair.targetId);
    merges.zonesRenamed = planZoneMoves(sourceZones, targetZones, label).renamed;
    const caps = zoneCapsBlocker(sourceZones, targetZones);
    if (caps !== null) blockers.push(caps);

    const sourceRoutes = await liveRouteRows(pair.sourceId, null);
    const targetRoutes = await liveRouteRows(pair.targetId, [
      ...new Set(sourceRoutes.map((route) => route.replenishDate)),
    ]);
    merges.routesRenamed = planRouteMoves(sourceRoutes, targetRoutes, label).renamed;

    const sourceLoads = await liveLoadRows(pair.sourceId, null);
    const targetLoads = await liveLoadRows(pair.targetId, [
      ...new Set(sourceLoads.map((load) => load.bankCode)),
    ]);
    merges.standardLoadDefaultsUnset = planStandardLoadMoves(
      sourceLoads,
      targetLoads,
    ).defaultsUnset;

    blockers.push(...(await planBlockers(pair)));

    const layoutRuns = await runningLayoutImports(pair, now);
    merges.layoutImportRunsAbandoned = layoutRuns.stale;
    if (layoutRuns.freshBanks.length > 0) {
      blockers.push({ kind: 'layoutImportRunning', bankCodes: layoutRuns.freshBanks });
    }

    merges.mailboxRepointed = (await mailboxRepoint(pair)) === null ? 0 : 1;
    const settings = await settingsRepoint(pair);
    merges.settingsRepointed =
      (settings.categories?.repointed ?? 0) + (settings.codes?.repointed ?? 0);

    if (await atmBranchMoveRunRepository.lockHeld(now, ownRunId)) {
      blockers.push({ kind: 'moveRunning' });
    }

    const ordered = orderedBlockers(blockers);
    return {
      sourceBranchId: pair.source,
      sourceBranchName: pair.sourceName,
      targetBranchId: pair.target,
      targetBranchName: pair.targetName,
      counts,
      total: atmBranchMoveTotal(counts),
      merges,
      blockers: ordered,
      canMove: ordered.length === 0,
    };
  }

  /**
   * Step 1. Planned from every label of both branches as they are now; exactly the planned source
   * rows move — one filed there afterwards stays for the next run to plan, never re-filed blind.
   * The fills go first, so the row that stays holds what it takes before its twin is retired.
   */
  private async moveLabels(
    pair: MovePair,
    by: Types.ObjectId,
  ): Promise<{ moved: number; merged: number; retired: number }> {
    const plan = planLabelMoves(await labelRowsOf(pair.sourceId), await labelRowsOf(pair.targetId));
    for (const batch of chunks([...plan.fills])) {
      await unitOfWork(async (session) => {
        for (const [targetId, fill] of batch) await fillLabel(targetId, fill, by, session);
      });
    }
    let moved = 0;
    for (const batch of chunks([...plan.moves])) {
      moved += await unitOfWork(async (session) => {
        const retire = batch.filter(([, move]) => move.action !== 'move').map(([id]) => oid(id));
        const plain = batch.filter(([, move]) => move.action === 'move').map(([id]) => oid(id));
        let written = 0;
        // Deleted and re-filed in one write each: never a moment with two live rows of one name.
        if (retire.length > 0) {
          const now = new Date();
          const result = await AtmRefLabelModel.updateMany(
            { _id: { $in: retire }, branchId: pair.sourceId },
            {
              $set: {
                branchId: pair.targetId,
                isDeleted: true,
                deletedAt: now,
                deletedBy: by,
                updatedBy: by,
              },
              $inc: { __v: 1 },
            },
            { session },
          ).exec();
          written += result.modifiedCount;
        }
        if (plain.length > 0) {
          const result = await AtmRefLabelModel.collection.updateMany(
            { _id: { $in: plain }, branchId: pair.sourceId },
            { $set: { branchId: pair.targetId } },
            { session },
          );
          written += result.modifiedCount;
        }
        return written;
      });
    }
    return { moved, merged: plan.merged, retired: plan.retired };
  }

  /**
   * Step 2. The source's ids are read BEFORE the twins are planned: a master filed there in between
   * stays for the next run, instead of arriving unplanned beside its twin. Each retired twin is
   * pushed onto the run's own `retired` the moment its batch commits, so a later batch that stops
   * the run still leaves them counted. Returns the masters moved.
   */
  private async moveMachines(
    pair: MovePair,
    by: Types.ObjectId,
    retired: RetiredTwin[],
  ): Promise<number> {
    const sourceIds = await idsUnder('machines', pair.sourceId);
    const rows = await machineTwinRows(pair);
    const planned = new Map(rows.map((row) => [row.id, row.isActive]));
    const plan = planMachineTwins(rows);
    const refused = twinBlockers(plan);
    if (refused.length > 0) throw blocked(refused);
    if (beforeTwinRetire !== null) {
      const hook = beforeTwinRetire;
      beforeTwinRetire = null;
      await hook();
    }
    for (const batch of chunks(plan.retire)) {
      const done = await unitOfWork(async (session) => {
        const now = new Date();
        const written: { twin: RetiredTwin; before: AtmMachineDoc }[] = [];
        for (const twin of batch) {
          // Re-read inside the transaction (review finding): a twin reactivated, or given open work,
          // since the plan was read is never retired — the run stops on it instead, and the next
          // run plans it again. The planned `isActive` is also the write's own condition.
          await refuseChangedTwin(twin, planned.get(twin.id) ?? false, session);
          // The legacy delete (machine.service.ts bulkDelete): the code renamed `<code>-D` and the
          // row deleted in one write, so the code is free in the target the moment it commits.
          const before = await AtmMachineModel.findOneAndUpdate(
            {
              _id: oid(twin.id),
              isDeleted: false,
              machineCode: twin.machineCode,
              isActive: planned.get(twin.id) ?? false,
            },
            {
              $set: {
                machineCode: `${twin.machineCode}-D`,
                isDeleted: true,
                deletedAt: now,
                deletedBy: by,
                updatedBy: by,
              },
              $inc: { __v: 1 },
            },
            { session, new: false },
          )
            .lean<AtmMachineDoc>()
            .exec();
          // Retired by this write (never one retired meanwhile): its layout and point may follow.
          if (before !== null) {
            written.push({ twin: { ...twin, ...(await adoptTwinConfig(twin, session)) }, before });
          }
        }
        return written;
      });
      // After commit, once (the callback may run twice): each retired master's own `delete` row,
      // the legacy delete's trail — so a run cut off after this batch, whose own audit row would
      // never be written, still leaves which masters it retired and what they were.
      for (const { twin, before } of done) {
        await auditService.record({
          entityRef: { moduleId: 'atm', entityType: 'machine', entityId: twin.id },
          action: 'delete',
          changes: diffChanges(machineSnapshot(before), {}),
        });
      }
      retired.push(...done.map(({ twin }) => twin));
    }
    return moveIds('machines', sourceIds, pair);
  }

  /**
   * Step 4, zones. Planned and written inside one transaction per 200 live zones, reading both
   * branches there: a zone save of the target racing the move write-conflicts on its zone set and
   * one of the two runs again on what the other committed. Deleted zones are plain rows after.
   */
  private async moveZones(
    pair: MovePair,
    by: Types.ObjectId,
    label: string,
  ): Promise<{ moved: number; renamed: number }> {
    let moved = 0;
    let renamed = 0;
    for (;;) {
      const batch = await unitOfWork(async (session) => {
        const source = await liveZoneRows(pair.sourceId, session);
        if (source.length === 0) return null;
        const target = await liveZoneRows(pair.targetId, session);
        const caps = zoneCapsBlocker(source, target);
        if (caps !== null) throw blocked([caps]);
        const planned = planZoneMoves(source, target, label).zones.slice(0, BRANCH_MOVE_BATCH_SIZE);
        let written = 0;
        for (const zone of planned) {
          const result = await AtmMapZoneModel.updateOne(
            { _id: oid(zone.id), branchId: pair.sourceId, isDeleted: false },
            {
              $set: {
                branchId: pair.targetId,
                order: zone.order,
                ...(zone.renamed ? { name: zone.name } : {}),
                updatedBy: by,
              },
              $inc: { __v: 1 },
            },
            { session },
          ).exec();
          written += result.modifiedCount;
        }
        await bumpZoneSet(pair.targetId, by, session);
        return { written, renamed: planned.filter((zone) => zone.renamed).length };
      });
      if (batch === null) break;
      moved += batch.written;
      renamed += batch.renamed;
      if (batch.written === 0) break;
    }
    return { moved: moved + (await moveAll('mapZones', pair, NOT_LIVE)), renamed };
  }

  /**
   * Step 4, dispatch lines — per day, planned and written in one transaction (at most 100 lines a
   * day, `ATM_ROUTES_PER_DAY_MAX`). A line whose name and order stay is a plain move.
   */
  private async moveRoutes(
    pair: MovePair,
    by: Types.ObjectId,
    label: string,
  ): Promise<{ moved: number; renamed: number }> {
    const days = (
      await AtmDispatchRouteModel.distinct('replenishDate', {
        branchId: pair.sourceId,
        isDeleted: false,
      }).exec()
    )
      .map(String)
      .sort();
    let moved = 0;
    let renamed = 0;
    for (const day of days) {
      const result = await unitOfWork(async (session) => {
        const source = await liveRouteRows(pair.sourceId, [day], session);
        const target = await liveRouteRows(pair.targetId, [day], session);
        const before = new Map(source.map((route) => [route.id, route]));
        const plan = planRouteMoves(source, target, label);
        let written = 0;
        for (const route of plan.routes) {
          const changed = route.renamed || before.get(route.id)?.order !== route.order;
          const update = changed
            ? {
                $set: {
                  branchId: pair.targetId,
                  name: route.name,
                  nameKey: route.nameKey,
                  order: route.order,
                  updatedBy: by,
                },
                $inc: { __v: 1 },
              }
            : { $set: { branchId: pair.targetId } };
          const write = await AtmDispatchRouteModel.updateOne(
            { _id: oid(route.id), branchId: pair.sourceId, isDeleted: false },
            update,
            { session, timestamps: changed },
          ).exec();
          written += write.modifiedCount;
        }
        return { written, renamed: plan.renamed };
      });
      moved += result.written;
      renamed += result.renamed;
    }
    return { moved: moved + (await moveAll('dispatchRoutes', pair, NOT_LIVE)), renamed };
  }

  /** Step 5, standard loads — per bank, planned and written in one transaction. */
  private async moveStandardLoads(
    pair: MovePair,
    by: Types.ObjectId,
  ): Promise<{ moved: number; defaultsUnset: number }> {
    const banks = (
      await AtmStandardLoadModel.distinct('bankCode', {
        branchId: pair.sourceId,
        isDeleted: false,
      }).exec()
    )
      .map(String)
      .sort();
    let moved = 0;
    let defaultsUnset = 0;
    for (const bankCode of banks) {
      const result = await unitOfWork(async (session) => {
        const source = await liveLoadRows(pair.sourceId, [bankCode], session);
        const target = await liveLoadRows(pair.targetId, [bankCode], session);
        const before = new Map(source.map((load) => [load.id, load]));
        const plan = planStandardLoadMoves(source, target);
        let written = 0;
        for (const load of plan.loads) {
          const changed = load.unsetDefault || before.get(load.id)?.order !== load.order;
          // One write each, the default switched off in the same one: `ux_default` never sees two.
          const update = changed
            ? {
                $set: {
                  branchId: pair.targetId,
                  order: load.order,
                  ...(load.unsetDefault ? { isDefault: false } : {}),
                  updatedBy: by,
                },
                $inc: { __v: 1 },
              }
            : { $set: { branchId: pair.targetId } };
          const write = await AtmStandardLoadModel.updateOne(
            { _id: oid(load.id), branchId: pair.sourceId, isDeleted: false },
            update,
            { session, timestamps: changed },
          ).exec();
          written += write.modifiedCount;
        }
        return { written, defaultsUnset: plan.defaultsUnset };
      });
      moved += result.written;
      defaultsUnset += result.defaultsUnset;
    }
    return { moved: moved + (await moveAll('standardLoads', pair, NOT_LIVE)), defaultsUnset };
  }

  /**
   * Step 5, Full list runs: one the source left `running` for 30 minutes is abandoned first (the
   * import's own takeover, settlements/import/apply-layout-import.ts); a fresh one refuses the move
   * — the import is still writing the source's layouts.
   */
  private async moveLayoutImportRuns(
    pair: MovePair,
  ): Promise<{ moved: number; abandoned: number }> {
    const now = new Date();
    const abandoned = await AtmLayoutImportRunModel.updateMany(
      {
        branchId: pair.sourceId,
        state: 'running',
        startedAt: { $lt: new Date(now.getTime() - STALE_RUN_MS) },
      },
      { $set: { state: 'abandoned', finishedAt: now } },
    ).exec();
    const fresh = await runningLayoutImports(pair, now);
    if (fresh.freshBanks.length > 0) {
      throw blocked([{ kind: 'layoutImportRunning', bankCodes: fresh.freshBanks }]);
    }
    return {
      moved: await moveAll('layoutImportRuns', pair),
      abandoned: abandoned.modifiedCount,
    };
  }

  /** Step 6, the settings — through the platform settings service, as the links save writes. */
  private async repointSettings(pair: MovePair, ctx: AuthContext): Promise<number> {
    const { categories, codes } = await settingsRepoint(pair);
    const editor = asSettingsEditor(ctx);
    if (categories !== null) {
      await settingsService.set(editor, {
        key: AtmSettingKeys.MailBranchCategories,
        scope: 'organization',
        value: categories.rows,
      });
    }
    if (codes !== null) {
      await settingsService.set(editor, {
        key: AtmSettingKeys.RegisterBranchCodes,
        scope: 'organization',
        value: codes.rows,
      });
    }
    return (categories?.repointed ?? 0) + (codes?.repointed ?? 0);
  }

  /**
   * Step 6, the mailbox list — its versioned write (a save racing the move is a stale 409 for one
   * of the two) and its audit row, as the card's own save makes them (mailbox.service.ts).
   */
  private async repointMailbox(pair: MovePair, ctx: AuthContext): Promise<number> {
    const repoint = await mailboxRepoint(pair);
    if (repoint === null) return 0;
    const saved = await atmMailboxConfigRepository.updateById(
      String(repoint.doc._id),
      {
        branches: repoint.next.map((row) => ({
          branchId: oid(row.branchId),
          category: row.category,
        })),
      },
      { by: ctx.userId, version: repoint.doc.__v },
    );
    await auditService.record({
      entityRef: { moduleId: 'atm', entityType: 'mailboxConfig', entityId: String(saved._id) },
      action: 'update',
      changes: diffChanges({ branches: repoint.rows }, { branches: repoint.next }),
    });
    return 1;
  }

  /** One signal per affected topic, on the target's rooms too. Best-effort, as every signal is. */
  private signal(
    runId: string,
    target: string,
    moved: AtmBranchMoveCountsDto,
    merges: AtmBranchMoveMergesDto,
  ): void {
    const at = new Date().toISOString();
    const topics = new Map<string, { moduleId: string; entityType: string }>();
    for (const collection of ATM_BRANCH_MOVE_COLLECTIONS) {
      const topic = COLLECTION_TOPICS[collection];
      // A retired twin changes the machines, and may have handed its layout and point over.
      const touched =
        moved[collection] > 0 ||
        (TWIN_COLLECTIONS.has(collection) && merges.machineTwinsRetired > 0);
      if (topic !== undefined && touched) topics.set(topic.entityType, topic);
    }
    for (const topic of topics.values()) {
      publishAuditedChange({
        entityRef: { ...topic, entityId: runId },
        action: 'update',
        at,
        branchId: target,
      });
    }
  }
}

export const atmBranchMoveService = new AtmBranchMoveService();
