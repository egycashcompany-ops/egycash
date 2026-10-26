// Cassette layouts («فئات الكاسيتات») — the page's context, the bank's machines with their layouts,
// one machine's history, and a manual save (S-1, S-2; docs/12-planning/atm-settlements-phase1.md
// §6.4 S1, S2, S3, S5, S6).
//
// SCOPE (§6.2). Every read is an `$and` of `{ isDeleted: false }`, the view key's branch match and
// the branch the page works in. A save reads the machine through that match (404 outside), then asks
// `atmCassetteLayout.manage` to reach the machine's branch (403) — `own`, `section` and home-only
// `department` grants read and never write.
//
// A SAVE is one transaction: the layout's compare-and-set on `__v` (or its insert, whose E11000 on
// `ux_machine` is answered OUTSIDE the transaction as 409), then the version row of the same
// revision. Its audit is recorded after the commit, with the reason.
import {
  ATM_SETTLEMENT_PAGES,
  cleanLabel,
  isPlanned,
  type AtmBankCode,
  type AtmCassetteLayoutDetailDto,
  type AtmCassetteLayoutRowDto,
  type AtmCassetteLayoutsDto,
  type AtmCassetteSlot,
  type AtmLayoutImportRunSummaryDto,
  type AtmLayoutRowFlag,
  type AtmPlanRun,
  type AtmSettlementBankQuery,
  type AtmSettlementContextDto,
  type AtmSettlementPage,
  type SaveAtmCassetteLayout,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  StaleDocumentError,
  ValidationError,
} from '../../../../shared/errors';
import { keyReachesBranch, scopeSelector, type AuthContext } from '../../../../shared/types';
import { diffChanges } from '../../../../shared/utils/diff';
import { AtmMachineModel, type AtmMachineDoc } from '../../machines/machine.model';
import { actorName } from '../../shared/atm-context';
import { branchScopeMatch, resolveWorkBranch } from '../../shared/branch-scope';
import { cairoDateString } from '../../shared/cairo-time';
import { AtmLayoutImportRunModel, type AtmLayoutImportRunDoc } from '../import/layout-import-run.model';
import { AtmPlanLineModel, type AtmPlanLineDoc } from '../plans/plan-line.model';
import { bankMachineIds, machineBanks } from '../shared/register-bank';
import {
  branchNameOf,
  enabledSettlementBanks,
  isDuplicateKey,
  readBranch,
  requireEnabledBank,
} from '../shared/settlement-context';
import { liveStandardLoads } from '../standard-loads/standard-load.service';
import { AtmCassetteLayoutModel, type AtmCassetteLayoutDoc } from './cassette-layout.model';
import { AtmCassetteLayoutVersionModel } from './cassette-layout-version.model';
import {
  liveLayoutOf,
  liveLayoutsByMachine,
  layoutVersionsOf,
  plainSlots,
  toLayoutStateDto,
  toLayoutVersionDto,
} from './layout.repository';

const VIEW = 'atmCassetteLayout.view';
const MANAGE = 'atmCassetteLayout.manage';
const IMPORT = 'atmCassetteLayout.import';

/** §6.2: each page's key pair. */
export const SETTLEMENT_PAGE_KEYS: Readonly<Record<AtmSettlementPage, [string, string]>> = {
  plans: ['atmSettlementPlan.view', 'atmSettlementPlan.manage'],
  layouts: [VIEW, MANAGE],
  import: [VIEW, IMPORT],
};

/** §6.4: the list is not paginated; BM's list has about 450 machines. */
export const ATM_LAYOUT_LIST_MAX = 2_000;

type LayoutMachine = Pick<
  AtmMachineDoc,
  '_id' | 'branchId' | 'machineCode' | 'name' | 'area' | 'isActive'
>;

const MACHINE_PROJECTION = {
  branchId: 1,
  machineCode: 1,
  name: 1,
  area: 1,
  isActive: 1,
} as const;

const asId = (id: Types.ObjectId | string): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

const layoutRef = (machineId: string) => ({
  moduleId: 'atm',
  entityType: 'cassetteLayout',
  entityId: machineId,
});

/** A label as a layout stores it (DS-5): cleaned, '' → null. */
const storedLabel = (raw: string | null): string | null => {
  if (raw === null) return null;
  const cleaned = cleanLabel(raw);
  return cleaned === '' ? null : cleaned;
};

const auditSnapshot = (
  doc: Pick<
    AtmCassetteLayoutDoc,
    'slots' | 'typeLabel' | 'featuresLabel' | 'hubLabel' | 'standardLoadId'
  >,
) => ({
  slots: plainSlots(doc.slots),
  typeLabel: doc.typeLabel,
  featuresLabel: doc.featuresLabel,
  hubLabel: doc.hubLabel,
  standardLoadId: doc.standardLoadId === null ? null : String(doc.standardLoadId),
});

const sameSlots = (a: readonly AtmCassetteSlot[], b: readonly AtmCassetteSlot[]): boolean =>
  JSON.stringify(plainSlots(a)) === JSON.stringify(plainSlots(b));

/** The row flags (§6.1): `loadIds` are the live profiles of the machine's branch and bank. */
const rowFlags = (
  layout: AtmCassetteLayoutDoc | null,
  loadIds: ReadonlySet<string>,
): AtmLayoutRowFlag[] => {
  if (layout === null) return ['noLayout'];
  const flags: AtmLayoutRowFlag[] = [];
  if (!layout.slots.some(isPlanned)) flags.push('noFillableSlot');
  if (layout.standardLoadId !== null && !loadIds.has(String(layout.standardLoadId))) {
    flags.push('standardLoadOtherBank');
  }
  return flags;
};

const toRowDto = (
  machine: LayoutMachine,
  layout: AtmCassetteLayoutDoc | null,
  loadIds: ReadonlySet<string>,
): AtmCassetteLayoutRowDto => ({
  machineId: String(machine._id),
  machineCode: machine.machineCode,
  machineName: machine.name,
  area: machine.area,
  active: machine.isActive,
  layout: layout === null ? null : toLayoutStateDto(layout),
  flags: rowFlags(layout, loadIds),
});

export const toRunSummaryDto = (doc: AtmLayoutImportRunDoc): AtmLayoutImportRunSummaryDto => ({
  at: new Date(doc.startedAt).toISOString(),
  actorName: doc.actorName,
  state: doc.state,
  counts: doc.counts,
});

/** The live profile ids of a machine's branch × its register bank (none without a bank). */
const profileIdsOf = async (
  branchId: Types.ObjectId,
  bank: AtmBankCode | null,
): Promise<Set<string>> =>
  bank === null
    ? new Set()
    : new Set((await liveStandardLoads(branchId, bank)).map((load) => String(load._id)));

class AtmCassetteLayoutService {
  /** S1 — the page's work branch for ITS key pair, and what the caller may do there. */
  async context(page: AtmSettlementPage, ctx: AuthContext): Promise<AtmSettlementContextDto> {
    if (!ATM_SETTLEMENT_PAGES.includes(page)) throw new NotFoundError();
    const [viewKey, writeKey] = SETTLEMENT_PAGE_KEYS[page];
    const [work, banks] = await Promise.all([
      resolveWorkBranch(ctx, viewKey, writeKey),
      enabledSettlementBanks(),
    ]);
    const id = work.branchId;
    const reaches = (key: string): boolean => id !== null && keyReachesBranch(ctx, key, id);
    return {
      page,
      banks,
      branch: id === null ? null : { id, name: await branchNameOf(id) },
      blocked: work.branchId === null ? work.blocked : null,
      can: {
        viewLayouts: reaches(VIEW),
        manageLayouts: reaches(MANAGE),
        importLayouts: reaches(IMPORT),
        viewPlans: reaches('atmSettlementPlan.view'),
        managePlans: reaches('atmSettlementPlan.manage'),
        printPlans: reaches('atmSettlementPlan.print'),
        exportPlans: reaches('atmSettlementPlan.export'),
      },
    };
  }

  /** S2 — the bank's active machines in the work branch, each with its layout. */
  async list(query: AtmSettlementBankQuery, ctx: AuthContext): Promise<AtmCassetteLayoutsDto> {
    await requireEnabledBank(query.bankCode);
    const branchId = await readBranch(ctx, VIEW, MANAGE, query.branchId);
    const view = scopeSelector(ctx, VIEW);
    const ids = await bankMachineIds(branchId, query.bankCode);
    if (ids.length > ATM_LAYOUT_LIST_MAX) {
      throw new BusinessRuleError('the bank has more machines in this branch than the page lists');
    }
    const machines = await AtmMachineModel.find(
      {
        $and: [
          { isDeleted: false, isActive: true },
          branchScopeMatch(view),
          { branchId: asId(branchId) },
          { _id: { $in: ids.map(asId) } },
        ],
      } as FilterQuery<AtmMachineDoc>,
      MACHINE_PROJECTION,
    )
      .sort({ machineCode: 1, _id: 1 })
      .lean<LayoutMachine[]>()
      .exec();
    const [layouts, loads, lastRun] = await Promise.all([
      liveLayoutsByMachine(machines.map((m) => m._id)),
      liveStandardLoads(branchId, query.bankCode),
      AtmLayoutImportRunModel.findOne({
        branchId: asId(branchId),
        bankCode: query.bankCode,
        isDeleted: false,
      })
        .sort({ createdAt: -1 })
        .lean<AtmLayoutImportRunDoc>()
        .exec(),
    ]);
    const loadIds = new Set(loads.map((load) => String(load._id)));
    const rows = machines.map((m) => toRowDto(m, layouts.get(String(m._id)) ?? null, loadIds));
    const withLayout = rows.filter((row) => row.layout !== null).length;
    return {
      bankCode: query.bankCode,
      branchId,
      rows,
      figures: { machines: rows.length, withLayout, withoutLayout: rows.length - withLayout },
      lastImport: lastRun === null ? null : toRunSummaryDto(lastRun),
      can: {
        manage: keyReachesBranch(ctx, MANAGE, branchId),
        import: keyReachesBranch(ctx, IMPORT, branchId),
      },
    };
  }

  /** S3 — the last 10 import runs of the caller's branch(es) for the bank, counts only. */
  async runs(query: AtmSettlementBankQuery, ctx: AuthContext): Promise<AtmLayoutImportRunSummaryDto[]> {
    const view = scopeSelector(ctx, VIEW);
    const branchId = await readBranch(ctx, VIEW, IMPORT, query.branchId);
    const docs = await AtmLayoutImportRunModel.find({
      $and: [
        { isDeleted: false },
        branchScopeMatch(view),
        { branchId: asId(branchId) },
        { bankCode: query.bankCode },
      ],
    } as FilterQuery<AtmLayoutImportRunDoc>)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean<AtmLayoutImportRunDoc[]>()
      .exec();
    return docs.map(toRunSummaryDto);
  }

  /** The machine through the view key's match, or 404. */
  private async machineInReach(machineId: string, ctx: AuthContext): Promise<LayoutMachine> {
    const machine = await AtmMachineModel.findOne(
      {
        $and: [
          { _id: asId(machineId), isDeleted: false },
          branchScopeMatch(scopeSelector(ctx, VIEW)),
        ],
      } as FilterQuery<AtmMachineDoc>,
      MACHINE_PROJECTION,
    )
      .lean<LayoutMachine>()
      .exec();
    if (machine === null) throw new NotFoundError('no such machine');
    return machine;
  }

  /** S5 — the row, every version (newest first), and the live lines dated today or later. */
  async detail(machineId: string, ctx: AuthContext): Promise<AtmCassetteLayoutDetailDto> {
    const machine = await this.machineInReach(machineId, ctx);
    return this.detailOf(machine);
  }

  private async detailOf(machine: LayoutMachine): Promise<AtmCassetteLayoutDetailDto> {
    const today = cairoDateString(new Date());
    const [layout, versions, banks, lines] = await Promise.all([
      liveLayoutOf(machine._id),
      layoutVersionsOf(machine._id),
      machineBanks([machine._id]),
      AtmPlanLineModel.find(
        {
          machineId: machine._id,
          replenishDate: { $gte: today },
          status: { $in: ['draft', 'issued', 'prepared'] },
          isDeleted: false,
        },
        { planId: 1, replenishDate: 1, serial: 1, status: 1, run: 1 },
      )
        .sort({ replenishDate: 1, run: 1 })
        .lean<Pick<AtmPlanLineDoc, '_id' | 'planId' | 'replenishDate' | 'serial' | 'status' | 'run'>[]>()
        .exec(),
    ]);
    const loadIds = await profileIdsOf(machine.branchId, banks.get(String(machine._id))?.bank ?? null);
    return {
      ...toRowDto(machine, layout, loadIds),
      versions: versions.map(toLayoutVersionDto),
      affectedLines: lines.map((line) => ({
        planId: String(line.planId),
        replenishDate: line.replenishDate,
        lineId: String(line._id),
        serial: line.serial,
        status: line.status,
        run: line.run as AtmPlanRun,
      })),
    };
  }

  /** S6 — create (`version: null`) or update a machine's layout by hand. */
  async save(
    machineId: string,
    input: SaveAtmCassetteLayout,
    ctx: AuthContext,
  ): Promise<AtmCassetteLayoutDetailDto> {
    // 1. The machine: in reach, live, active, and the manage key reaching its branch.
    const machine = await this.machineInReach(machineId, ctx);
    if (!keyReachesBranch(ctx, MANAGE, String(machine.branchId))) {
      throw new ForbiddenError('the layout key does not reach this branch');
    }
    if (!machine.isActive) throw new BusinessRuleError('the machine is archived');

    // 2. The profile, when set, is a live one of the machine's branch and bank.
    if (input.standardLoadId !== null) {
      const bank = (await machineBanks([machine._id])).get(String(machine._id))?.bank ?? null;
      const loadIds = await profileIdsOf(machine.branchId, bank);
      if (!loadIds.has(input.standardLoadId)) {
        throw new ValidationError([
          {
            field: 'body.standardLoadId',
            code: 'STANDARD_LOAD_OTHER_BANK',
            message: "the standard load is not one of this machine's bank and branch",
          },
        ]);
      }
    }

    const next = {
      slots: input.slots.map((s) => ({
        slot: s.slot,
        kind: s.kind,
        denomination: s.denomination,
        currency: s.currency,
      })),
      typeLabel: storedLabel(input.typeLabel),
      featuresLabel: storedLabel(input.featuresLabel),
      hubLabel: storedLabel(input.hubLabel),
      standardLoadId: input.standardLoadId === null ? null : asId(input.standardLoadId),
    };
    const current = await liveLayoutOf(machine._id);

    // 3. A save equal to the current layout writes nothing.
    if (
      input.version !== null &&
      current !== null &&
      sameSlots(current.slots, next.slots) &&
      current.typeLabel === next.typeLabel &&
      current.featuresLabel === next.featuresLabel &&
      current.hubLabel === next.hubLabel &&
      String(current.standardLoadId) === String(next.standardLoadId)
    ) {
      return this.detailOf(machine);
    }

    // 4. One transaction: the layout, then its version row.
    const by = asId(ctx.userId);
    const name = actorName(ctx);
    const reason = input.reason === null || input.reason === '' ? null : input.reason;
    const version = input.version;
    let saved: AtmCassetteLayoutDoc;
    try {
      saved = await unitOfWork(async (session) => {
        const now = new Date();
        let doc: AtmCassetteLayoutDoc | null;
        if (version === null) {
          const [created] = await AtmCassetteLayoutModel.create(
            [
              {
                machineId: machine._id,
                branchId: machine.branchId,
                ...next,
                revision: 1,
                source: 'manual',
                changedByName: name,
                changedAt: now,
                createdBy: by,
                updatedBy: by,
              },
            ],
            { session },
          );
          doc = (created?.toObject() as AtmCassetteLayoutDoc | undefined) ?? null;
        } else {
          if (current === null) throw new StaleDocumentError();
          doc = await AtmCassetteLayoutModel.findOneAndUpdate(
            { _id: current._id, __v: version, isDeleted: false },
            {
              $set: {
                ...next,
                revision: current.revision + 1,
                source: 'manual',
                changedByName: name,
                changedAt: now,
                updatedBy: by,
              },
              $inc: { __v: 1 },
            },
            { new: true, session },
          )
            .lean<AtmCassetteLayoutDoc>()
            .exec();
        }
        if (doc === null) throw new StaleDocumentError();
        await AtmCassetteLayoutVersionModel.create(
          [
            {
              layoutId: doc._id,
              machineId: machine._id,
              branchId: machine.branchId,
              revision: doc.revision,
              ...next,
              source: 'manual',
              reason,
              importRunId: null,
              changedBy: by,
              changedByName: name,
              changedAt: now,
              createdBy: by,
              updatedBy: by,
            },
          ],
          { session },
        );
        return doc;
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new StaleDocumentError();
      throw error;
    }

    // 5. After the commit.
    const changes = diffChanges(
      current === null ? {} : auditSnapshot(current),
      auditSnapshot(saved),
    );
    await auditService.record({
      entityRef: layoutRef(String(machine._id)),
      action: current === null ? 'create' : 'update',
      changes: [...changes, ...(reason === null ? [] : [{ field: 'reason', old: null, new: reason }])],
    });
    return this.detailOf(machine);
  }
}

export const atmCassetteLayoutService = new AtmCassetteLayoutService();
