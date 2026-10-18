// The machine map's reads: the page's context, every point in reach, the zones, and the location
// summary of the unlocated screen (docs/12-planning/atm-map-zones.md §6.4).
//
// Every read is `{ $and: [{ isDeleted: false }, mapScopeMatch(s), narrowToBranch(s, b), …] }` — the
// scope clause and the browser's narrowing side by side, never spread into one object (§6.2).
//
// The points endpoint is not paginated: a list page caps at 100 rows and the map needs every
// machine in reach at once, so it is three lean, projected queries instead. Nothing K or S is sent,
// and no register text, `manualText` or `moveReason` either: the map shows WHERE, never the source.
import {
  ATM_MAP_UNLOCATED_REASONS_DTO,
  type AtmMapContextDto,
  type AtmMapLocationSummaryDto,
  type AtmMapLocationSummaryQuery,
  type AtmMapPointDto,
  type AtmMapPointsDto,
  type AtmMapPointsQuery,
  type AtmMapUnlocatedReasonDto,
  type AtmMapZoneDto,
  type AtmMapZoneSetDto,
  type AtmMapZonesDto,
  type AtmMapZonesQuery,
  type AtmBankCode,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { branchRepository } from '../../../platform/organization';
import { keyReachesBranch, scopeSelector, type AuthContext } from '../../../shared/types';
import { AtmMachineModel, type AtmMachineDoc } from '../machines/machine.model';
import { AtmRegisterEntryModel } from '../register/register.model';
import { commonBankCode, mergeOpenEntries, sameIds, sameTexts } from './location/derive';
import { entriesByMachine, locationState, openEntryLocationTexts } from './location.service';
import { AtmMachineLocationModel, type AtmMachineLocationDoc } from './machine-location.model';
import {
  activeBranchIds,
  mapScopeBranches,
  mapScopeMatch,
  narrowToBranch,
  resolveZoneEditBranch,
  writableBranches,
} from './map-scope';
import { AtmMapZoneSetModel, type AtmMapZoneSetDoc } from './zone-set.model';
import { AtmMapZoneModel, type AtmMapZoneDoc } from './zone.model';

type PointMachine = Pick<
  AtmMachineDoc,
  '_id' | 'branchId' | 'machineCode' | 'name' | 'area' | 'bankName' | 'isActive'
>;

/** The location fields a point needs — never the texts, the manual text or the reason. */
type PointLocation = Pick<
  AtmMachineLocationDoc,
  | 'machineId'
  | 'status'
  | 'lat'
  | 'lng'
  | 'source'
  | 'needsReview'
  | 'reason'
  | 'warnings'
  | 'pinned'
  | 'setByName'
  | 'setAt'
  | 'reviewedByName'
  | 'reviewedAt'
>;

const POINT_LOCATION_PROJECTION = {
  machineId: 1,
  status: 1,
  lat: 1,
  lng: 1,
  source: 1,
  needsReview: 1,
  reason: 1,
  warnings: 1,
  pinned: 1,
  setByName: 1,
  setAt: 1,
  reviewedByName: 1,
  reviewedAt: 1,
} as const;

/** DM-20: who last set a pin a person set — a manual pin's mover, or an approved pin's approver. */
const lastSetOf = (doc: PointLocation | null): AtmMapPointDto['lastSet'] => {
  if (doc === null || doc.status !== 'located') return null;
  if (doc.source === 'manual' && doc.setAt !== null) {
    return { kind: 'moved', byName: doc.setByName, at: new Date(doc.setAt).toISOString() };
  }
  if (doc.pinned && doc.reviewedAt !== null) {
    return {
      kind: 'approved',
      byName: doc.reviewedByName,
      at: new Date(doc.reviewedAt).toISOString(),
    };
  }
  return null;
};

const toPointDto = (
  machine: PointMachine,
  doc: PointLocation | null,
  bankCode: AtmBankCode | null,
): AtmMapPointDto => {
  const { state, reason } = locationState(doc);
  const located = doc !== null && doc.status === 'located';
  return {
    machineId: String(machine._id),
    code: machine.machineCode,
    name: machine.name,
    branchId: String(machine.branchId),
    area: machine.area,
    bankName: machine.bankName,
    bankCode,
    active: machine.isActive,
    lat: located ? doc.lat : null,
    lng: located ? doc.lng : null,
    state,
    source: located ? doc.source : null,
    reason,
    warnings: doc === null ? [] : [...doc.warnings],
    lastSet: lastSetOf(doc),
  };
};

const toZoneDto = (zone: AtmMapZoneDoc): AtmMapZoneDto => ({
  id: String(zone._id),
  branchId: String(zone.branchId),
  name: zone.name,
  color: zone.color,
  order: zone.order,
  points: zone.points.map((p) => ({ lat: p.lat, lng: p.lng })),
  updatedAt: new Date(zone.updatedAt).toISOString(),
});

/** One branch's set: its revision (0 when it never saved) and its live zones in order. */
export const toZoneSetDto = (
  branchId: string,
  set: Pick<AtmMapZoneSetDoc, 'revision'> | null,
  zones: readonly AtmMapZoneDoc[],
): AtmMapZoneSetDto => ({
  branchId,
  revision: set?.revision ?? 0,
  zones: [...zones].sort((a, b) => a.order - b.order).map(toZoneDto),
});

const statusFilter = (status: AtmMapPointsQuery['status']): Record<string, unknown> =>
  status === 'active' ? { isActive: true } : status === 'archived' ? { isActive: false } : {};

const emptyByReason = (): Record<AtmMapUnlocatedReasonDto, number> =>
  Object.fromEntries(ATM_MAP_UNLOCATED_REASONS_DTO.map((r) => [r, 0])) as Record<
    AtmMapUnlocatedReasonDto,
    number
  >;

class AtmMapService {
  /** GET /context — the branches in reach, what the caller may do in each, and the edit branch. */
  async context(ctx: AuthContext): Promise<AtmMapContextDto> {
    const view = scopeSelector(ctx, 'atmMap.view');
    const readable = mapScopeBranches(view);
    const ids = readable === 'all' ? await activeBranchIds() : readable;
    const named = await branchRepository.findByIdsSystem(ids);
    const byId = new Map(named.map((branch) => [String(branch._id), branch]));
    const edit = await resolveZoneEditBranch(ctx);
    return {
      branches: ids
        .flatMap((id) => {
          const branch = byId.get(id);
          return branch === undefined ? [] : [branch];
        })
        .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
        .map((branch) => {
          const id = String(branch._id);
          return {
            id,
            name: branch.name,
            canManageZones: keyReachesBranch(ctx, 'atmZone.manage', id),
            canLocate: keyReachesBranch(ctx, 'atmMachine.locate', id),
          };
        }),
      organizationWide: view.scope === 'organization',
      editBranchId: edit.branchId,
      editBlocked: edit.branchId === null ? edit.blocked : null,
    };
  }

  /** GET /points — every machine in reach (active by default), with its location state. */
  async points(query: AtmMapPointsQuery, ctx: AuthContext): Promise<AtmMapPointsDto> {
    const view = scopeSelector(ctx, 'atmMap.view');
    const match = {
      $and: [
        { isDeleted: false },
        mapScopeMatch(view),
        narrowToBranch(view, query.branchId),
        statusFilter(query.status),
      ],
    } as FilterQuery<AtmMachineDoc>;
    const machines = await AtmMachineModel.find(match, {
      branchId: 1,
      machineCode: 1,
      name: 1,
      area: 1,
      bankName: 1,
      isActive: 1,
    })
      .sort({ machineCode: 1, _id: 1 })
      .lean<PointMachine[]>()
      .exec();
    const ids = machines.map((m) => m._id);
    const [docs, entries] = await Promise.all([
      AtmMachineLocationModel.find(
        { isDeleted: false, machineId: { $in: ids } },
        POINT_LOCATION_PROJECTION,
      )
        .lean<PointLocation[]>()
        .exec(),
      AtmRegisterEntryModel.find(
        { machineId: { $in: ids }, isDeleted: false, status: 'open' },
        { machineId: 1, bankCode: 1 },
      )
        .lean<{ machineId: Types.ObjectId; bankCode: AtmBankCode | null }[]>()
        .exec(),
    ]);
    const docOf = new Map(docs.map((doc) => [String(doc.machineId), doc]));
    const banksOf = new Map<string, (AtmBankCode | null)[]>();
    for (const entry of entries) {
      const key = String(entry.machineId);
      banksOf.set(key, [...(banksOf.get(key) ?? []), entry.bankCode ?? null]);
    }
    return {
      points: machines.map((machine) => {
        const key = String(machine._id);
        return toPointDto(machine, docOf.get(key) ?? null, commonBankCode(banksOf.get(key) ?? []));
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * GET /zones — the SET documents first, then the zones. In that order, a save committing between
   * the two reads gives the client newer zones under the older revision, and its next save is a
   * 409; the other order would label old zones with the new revision and let that save overwrite
   * the other editor's work.
   */
  async zones(query: AtmMapZonesQuery, ctx: AuthContext): Promise<AtmMapZonesDto> {
    const view = scopeSelector(ctx, 'atmMap.view');
    const clauses = [
      { isDeleted: false },
      mapScopeMatch(view),
      narrowToBranch(view, query.branchId),
    ];
    const sets = await AtmMapZoneSetModel.find({ $and: clauses }, { branchId: 1, revision: 1 })
      .lean<Pick<AtmMapZoneSetDoc, 'branchId' | 'revision'>[]>()
      .exec();
    const zones = await AtmMapZoneModel.find({ $and: clauses })
      .sort({ branchId: 1, order: 1 })
      .lean<AtmMapZoneDoc[]>()
      .exec();
    const setOf = new Map(sets.map((set) => [String(set.branchId), set]));
    const zonesOf = new Map<string, AtmMapZoneDoc[]>();
    for (const zone of zones) {
      const key = String(zone.branchId);
      zonesOf.set(key, [...(zonesOf.get(key) ?? []), zone]);
    }
    const branchIds = new Set([...setOf.keys(), ...zonesOf.keys()]);
    // A named branch always gets its set, `revision: 0` and no zones when it never saved.
    if (query.branchId !== undefined) branchIds.add(query.branchId);
    return {
      sets: [...branchIds]
        .sort()
        .map((id) => toZoneSetDto(id, setOf.get(id) ?? null, zonesOf.get(id) ?? [])),
    };
  }

  /**
   * GET /locations/summary — the map's read scope limited to the branches where the caller can
   * locate: exactly the rows the unlocated screen lists and can act on, so «n من m» always matches
   * the list. An empty writable set gives zero counts, not an error.
   */
  async summary(
    query: AtmMapLocationSummaryQuery,
    ctx: AuthContext,
  ): Promise<AtmMapLocationSummaryDto> {
    const view = scopeSelector(ctx, 'atmMap.view');
    const narrow = narrowToBranch(view, query.branchId);
    const writable = await writableBranches(ctx, 'atmMachine.locate', mapScopeBranches(view));
    const summary: AtmMapLocationSummaryDto = {
      totalActive: 0,
      located: 0,
      review: 0,
      unlocated: 0,
      byReason: emptyByReason(),
      pendingSync: 0,
      shortLinksPending: 0,
      shortLinksFailed: 0,
      lastSyncAt: null,
    };
    if (writable !== 'all' && writable.length === 0) return summary;

    const machines = await AtmMachineModel.find(
      {
        $and: [
          { isDeleted: false, isActive: true },
          mapScopeMatch(view),
          writable === 'all'
            ? {}
            : { branchId: { $in: writable.map((id) => new Types.ObjectId(id)) } },
          narrow,
        ],
      } as FilterQuery<AtmMachineDoc>,
      { _id: 1 },
    )
      .lean<Pick<AtmMachineDoc, '_id'>[]>()
      .exec();
    const ids = machines.map((m) => m._id);
    const [docs, rows] = await Promise.all([
      AtmMachineLocationModel.find(
        { isDeleted: false, machineId: { $in: ids } },
        {
          machineId: 1,
          status: 1,
          needsReview: 1,
          reason: 1,
          seenText: 1,
          seenEntryIds: 1,
          'shortLink.status': 1,
          derivedAt: 1,
        },
      )
        .lean<AtmMachineLocationDoc[]>()
        .exec(),
      openEntryLocationTexts(ids),
    ]);
    const docOf = new Map(docs.map((doc) => [String(doc.machineId), doc]));
    const entries = entriesByMachine(rows);
    let lastSync: number | null = null;

    summary.totalActive = machines.length;
    for (const machine of machines) {
      const key = String(machine._id);
      const doc = docOf.get(key) ?? null;
      const { state, reason } = locationState(doc);
      summary[state] += 1;
      if (reason !== null) summary.byReason[reason] += 1;
      if (doc === null) {
        summary.pendingSync += 1;
        continue;
      }
      // Waiting for a sync: the open entries moved since the last one read them.
      const current = mergeOpenEntries(entries.get(key) ?? []);
      if (
        !sameIds(doc.seenEntryIds.map(String), current.entryIds) ||
        !sameTexts(doc.seenText, current.texts)
      ) {
        summary.pendingSync += 1;
      }
      if (doc.shortLink?.status === 'pending') summary.shortLinksPending += 1;
      if (doc.shortLink?.status === 'failed') summary.shortLinksFailed += 1;
      if (doc.derivedAt !== null) {
        const at = new Date(doc.derivedAt).getTime();
        lastSync = lastSync === null ? at : Math.max(lastSync, at);
      }
    }
    summary.lastSyncAt = lastSync === null ? null : new Date(lastSync).toISOString();
    return summary;
  }
}

export const atmMapService = new AtmMapService();
