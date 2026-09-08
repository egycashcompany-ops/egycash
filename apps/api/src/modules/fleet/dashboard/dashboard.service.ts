// The landing screen, assembled once per request (FW-2).
//
// One method, and it takes the caller's OWN permissions rather than a fixed answer: the dashboard
// is the module's front door and its readers are not one audience — a workshop clerk, a branch
// dispatcher and a fleet manager all land here holding different grants. Each section is computed
// only for a reader who may read the collection behind it, with that permission's own data scope,
// and comes back `null` otherwise. So the payload IS the permission model, and the page renders
// what it was given without knowing which grant produced which half.
//
// Nothing here is stored. Every figure is derived from the collections that own it on the read
// that asks for it — the same discipline as the alarm projection (FR-3).
import { Types } from 'mongoose';
import {
  type FleetDashboardAccidentDto,
  type FleetDashboardBranchStatsDto,
  type FleetDashboardDto,
  type FleetDashboardDueLicenseDto,
  type FleetDashboardTypeRowDto,
  type FleetDashboardVisitDto,
  type FleetAccidentStatus,
  type LocalizedString,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { getDirectoryEmployees } from '../../../platform/directory';
import { branchRepository } from '../../../platform/organization/branches/branch.repository';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetDashboardRepository, type VehicleKm } from './dashboard.repository';

/** How many rows each list section carries. The screen shows five; the strips show ten. */
const RANK_SIZE = 5;
const STRIP_SIZE = 10;
const DUE_SIZE = 8;
/** How far ahead a licence counts as "coming due" on this screen. */
const LICENSE_HORIZON_DAYS = 60;

export interface DashboardGrants {
  /** Each is the caller's scope for that permission, or null when they do not hold it. */
  vehicles: ScopeSelector | null;
  drivers: ScopeSelector | null;
  odometer: ScopeSelector | null;
  maintenance: ScopeSelector | null;
  accidents: ScopeSelector | null;
}

const utcDay = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

const startOfMonth = (at: Date): Date => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

const addDays = (at: Date, days: number): Date =>
  new Date(at.getTime() + days * 24 * 60 * 60 * 1000);

/**
 * The branch filter a scope implies, as a plain `$match` fragment.
 *
 * The repositories' own `scopeFilter` is the authority for the LIST endpoints; these pipelines do
 * not go through it, so the one thing a scope means for an aggregate — "your branch only" — is
 * spelled here, from the same selector. A scope with no branch matches nothing rather than
 * everything: a reader placed nowhere sees no branch, which is the fail-closed direction.
 */
const branchMatch = (scope: ScopeSelector): Record<string, unknown> => {
  if (scope.scope === 'organization') return {};
  if (scope.scope === 'branch' || scope.scope === 'department' || scope.scope === 'section') {
    return scope.branchId === null
      ? { branchId: new Types.ObjectId('000000000000000000000000') }
      : { branchId: new Types.ObjectId(scope.branchId) };
  }
  return { createdBy: new Types.ObjectId(scope.userId) };
};

/** The same, for a collection that reaches the branch THROUGH its vehicle. */
const vehicleIdMatch = async (scope: ScopeSelector): Promise<Record<string, unknown>> => {
  const match = branchMatch(scope);
  if (Object.keys(match).length === 0) return {};
  const ids = await fleetVehicleRepository.idsMatching(match);
  return { vehicleId: { $in: ids } };
};

class FleetDashboardService {
  async build(grants: DashboardGrants, now: Date): Promise<FleetDashboardDto> {
    const branches = await branchRepository.listAll();
    const branchIds = branches.map((b) => String(b._id));

    const fleet = grants.vehicles === null ? null : await this.fleetSection(grants, branchIds);
    const odometer =
      grants.odometer === null ? null : await this.odometerSection(grants.odometer, branchIds);
    const maintenance =
      grants.maintenance === null ? null : await this.maintenanceSection(grants.maintenance, now);
    const accidents =
      grants.accidents === null ? null : await this.accidentsSection(grants.accidents, now);

    return {
      branches: branches.map((b) => ({ id: String(b._id), name: b.name as LocalizedString })),
      fleet,
      odometer,
      maintenance,
      accidents,
    };
  }

  private async fleetSection(
    grants: DashboardGrants,
    branchIds: readonly string[],
  ): Promise<NonNullable<FleetDashboardDto['fleet']>> {
    const scope = grants.vehicles as ScopeSelector;
    const match = branchMatch(scope);
    const [counts, byOperation, types, operations, specializations] = await Promise.all([
      fleetDashboardRepository.vehiclesByTypeAndBranch(match),
      fleetDashboardRepository.vehiclesByOperationAndBranch(match),
      fleetVehicleTypeRepository.listAll(),
      fleetCatalogItemRepository.listKind('operation'),
      fleetCatalogItemRepository.listKind('driverSpecialization'),
    ]);

    const typeName = new Map(types.map((t) => [String(t._id), t.name as LocalizedString]));
    const rows = new Map<string, FleetDashboardTypeRowDto>();
    for (const row of counts) {
      const name = typeName.get(row.typeId);
      if (name === undefined) continue;
      const entry = rows.get(row.typeId) ?? { typeId: row.typeId, name, counts: {}, total: 0 };
      if (row.branchId !== null) entry.counts[row.branchId] = row.count;
      entry.total += row.count;
      rows.set(row.typeId, entry);
    }

    // «نقل أموال» and «ATM» are OPERATIONS in the catalog, matched by the catalog's own Arabic
    // name rather than by an id hardcoded here: ids differ per environment, and a house that
    // renames the operation renames the counter with it.
    const operationKind = (id: string | null): 'cash' | 'atm' | null => {
      if (id === null) return null;
      const item = operations.find((o) => String(o._id) === id);
      if (item === undefined) return null;
      const ar = item.name.ar ?? '';
      const en = (item.name.en ?? '').toLowerCase();
      if (ar.includes('نقل') || en.includes('cash')) return 'cash';
      if (ar.toUpperCase().includes('ATM') || en.includes('atm')) return 'atm';
      return null;
    };

    /**
     * The same question on the DRIVER side, and now the same kind of answer.
     *
     * «التخصص» became a `driverSpecialization` catalog, so the split reads the catalog's own name
     * exactly as the operation split above does — «نقل اموال» counts as cash, «ATM» as ATM, and a
     * house's own additions («ملاكى», «سزوكى») count as neither, which is the truth rather than a
     * guess. A profile nobody has re-classified still carries the legacy enum, and that is read as
     * a second chance rather than as nothing: the counters keep covering the whole registry.
     */
    const specializationKind = (
      id: string | null | undefined,
      legacy: string | null | undefined,
    ): 'cash' | 'atm' | null => {
      // `== null`, not `=== null`: a profile written before the field existed has no key at all
      // and arrives as `undefined`, which would otherwise be looked up and silently match nothing.
      const item = id == null ? undefined : specializations.find((s) => String(s._id) === id);
      if (item !== undefined) {
        const ar = item.name.ar ?? '';
        const en = (item.name.en ?? '').toLowerCase();
        if (ar.includes('نقل') || en.includes('cash')) return 'cash';
        if (ar.toUpperCase().includes('ATM') || en.includes('atm')) return 'atm';
        return null;
      }
      if (legacy === 'cashTransport') return 'cash';
      if (legacy === 'atm') return 'atm';
      return null;
    };

    const profiles =
      grants.drivers === null ? [] : await fleetDashboardRepository.activeDriverProfiles();
    const employees = await getDirectoryEmployees(profiles.map((p) => p.employeeId));

    const blank = (branchId: string | null): FleetDashboardBranchStatsDto => ({
      branchId,
      vehicles: 0,
      drivers: 0,
      cashVehicles: 0,
      cashDrivers: 0,
      atmVehicles: 0,
      atmDrivers: 0,
    });
    const stats = new Map<string, FleetDashboardBranchStatsDto>([['*', blank(null)]]);
    for (const id of branchIds) stats.set(id, blank(id));
    const bump = (branchId: string | null, apply: (s: FleetDashboardBranchStatsDto) => void) => {
      apply(stats.get('*') as FleetDashboardBranchStatsDto);
      if (branchId === null) return;
      const entry = stats.get(branchId);
      if (entry !== undefined) apply(entry);
    };

    for (const row of byOperation) {
      const kind = operationKind(row.operationId);
      bump(row.branchId, (s) => {
        s.vehicles += row.count;
        if (kind === 'cash') s.cashVehicles += row.count;
        if (kind === 'atm') s.atmVehicles += row.count;
      });
    }
    for (const profile of profiles) {
      const employee = employees.get(profile.employeeId);
      const branchId = employee?.branchId ?? null;
      // `both` has no successor in the new vocabulary, so it stays a legacy-only reading and keeps
      // counting on BOTH sides exactly as it always did.
      const kind = specializationKind(profile.specializationId, profile.specialization);
      const legacyBoth = profile.specializationId == null && profile.specialization === 'both';
      bump(branchId, (s) => {
        s.drivers += 1;
        if (kind === 'cash' || legacyBoth) s.cashDrivers += 1;
        if (kind === 'atm' || legacyBoth) s.atmDrivers += 1;
      });
    }

    const dueLicenses = await fleetDashboardRepository.dueLicenses(
      addDays(new Date(), LICENSE_HORIZON_DAYS),
      match,
      DUE_SIZE,
    );

    return {
      types: [...rows.values()].sort((a, b) => b.total - a.total),
      stats: [...stats.values()],
      dueLicenses: dueLicenses.map(
        (v): FleetDashboardDueLicenseDto => ({
          vehicleId: String(v._id),
          code: v.code,
          branchId: v.branchId === null ? null : String(v.branchId),
          licenseExpiresAt: v.licenseExpiresAt.toISOString(),
        }),
      ),
    };
  }

  private async odometerSection(
    scope: ScopeSelector,
    branchIds: readonly string[],
  ): Promise<NonNullable<FleetDashboardDto['odometer']>> {
    const rows = await fleetDashboardRepository.kilometresByVehicle(branchMatch(scope));
    const byBranch = new Map<string, number>(branchIds.map((id) => [id, 0]));
    for (const row of rows) {
      if (row.branchId === null) continue;
      byBranch.set(row.branchId, (byBranch.get(row.branchId) ?? 0) + row.km);
    }
    // One ordering, read from both ends — so the two lists cannot disagree about a tie.
    const ranked = [...rows].sort((a, b) => b.km - a.km || a.code.localeCompare(b.code));
    const shape = (row: VehicleKm) => ({ vehicleId: row.vehicleId, code: row.code, km: row.km });
    return {
      byBranch: [...byBranch.entries()]
        .map(([branchId, km]) => ({ branchId, km }))
        .sort((a, b) => b.km - a.km),
      top: ranked.slice(0, RANK_SIZE).map(shape),
      bottom: ranked.slice(-RANK_SIZE).reverse().map(shape),
    };
  }

  private async maintenanceSection(
    scope: ScopeSelector,
    now: Date,
  ): Promise<NonNullable<FleetDashboardDto['maintenance']>> {
    const match = await vehicleIdMatch(scope);
    const dayStart = utcDay(now);
    const [visits, monthCount] = await Promise.all([
      fleetDashboardRepository.visitsBetween(dayStart, addDays(dayStart, 1), match, STRIP_SIZE),
      fleetDashboardRepository.countVisitsBetween(
        startOfMonth(now),
        addDays(utcDay(now), 1),
        match,
      ),
    ]);
    if (visits.length === 0) return { today: [], monthCount };

    const codes = await fleetVehicleRepository.codesByIds(visits.map((v) => String(v.vehicleId)));
    const catalogIds = new Set<string>();
    for (const visit of visits) {
      catalogIds.add(String(visit.workshopId));
      catalogIds.add(String(visit.workTypeId));
      for (const part of visit.sparePartIds) catalogIds.add(String(part));
    }
    const names = await fleetCatalogItemRepository.namesByIds([...catalogIds]);

    return {
      today: visits.map(
        (visit): FleetDashboardVisitDto => ({
          visitId: String(visit._id),
          code: codes.get(String(visit.vehicleId)) ?? '—',
          workshop: names.get(String(visit.workshopId)) ?? null,
          workType: names.get(String(visit.workTypeId)) ?? null,
          spareParts: visit.sparePartIds
            .map((id) => names.get(String(id)))
            .filter((name): name is LocalizedString => name !== undefined),
          notes: visit.notes,
        }),
      ),
      monthCount,
    };
  }

  private async accidentsSection(
    scope: ScopeSelector,
    now: Date,
  ): Promise<NonNullable<FleetDashboardDto['accidents']>> {
    const match = await vehicleIdMatch(scope);
    const dayStart = utcDay(now);
    const [today, monthCount] = await Promise.all([
      fleetDashboardRepository.accidentsBetween(dayStart, addDays(dayStart, 1), match, STRIP_SIZE),
      fleetDashboardRepository.countAccidentsBetween(
        startOfMonth(now),
        addDays(utcDay(now), 1),
        match,
      ),
    ]);
    if (today.length === 0) return { today: [], monthCount };
    const codes = await fleetVehicleRepository.codesByIds(today.map((a) => String(a.vehicleId)));
    return {
      today: today.map(
        (accident): FleetDashboardAccidentDto => ({
          accidentId: String(accident._id),
          code: codes.get(String(accident.vehicleId)) ?? '—',
          occurredAt: accident.occurredAt.toISOString(),
          culprit: accident.culprit,
          status: accident.status as FleetAccidentStatus,
        }),
      ),
      monthCount,
    };
  }
}

export const fleetDashboardService = new FleetDashboardService();
