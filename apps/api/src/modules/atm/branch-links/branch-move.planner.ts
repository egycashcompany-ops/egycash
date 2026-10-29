// The rules of «نقل البيانات» — a linked source branch's ATM data re-filed under its target
// (contracts atm-settings.ts) — over rows the service has already read: what merges, what is
// renamed or renumbered, which machine twin is retired, and what refuses the move. Pure: no read,
// no write, so each rule is pinned on its own (branch-move.planner.spec.ts) and the preview and the
// move decide with the same code.
//
// Why each rule exists (docs: the branch-alignment maps, §2): a straight `$set: { branchId: T }`
// collides on the unique indexes keyed by branch — a machine code, a label name, a default standard
// load, a route name per day — and those indexes may be MISSING in production (a boot build that
// existing rows violate is logged and skipped, atm-indexes.ts), so a collision is found here, from
// the rows themselves, and never left to an E11000 that may not come.
import {
  ATM_BRANCH_MOVE_BLOCKERS,
  ATM_MAP_ZONE_NAME_MAX,
  ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX,
  ATM_MAP_ZONES_PER_BRANCH_MAX,
  type ApiErrorDetail,
  type AtmBranchMoveBlockerDto,
  type LocalizedString,
} from '@ecms/contracts';
import { zoneNameKey } from '../map/zone.service';

export type MoveSide = 'source' | 'target';

/** Rows in their own sequence: `order`, then id (creation order). */
const byOrder = <R extends { order: number; id: string }>(a: R, b: R): number =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The first `order` after a branch's own: 0 for a branch that has none. */
const firstOrderAfter = (rows: readonly { order: number }[]): number =>
  rows.reduce((max, row) => Math.max(max, row.order), -1) + 1;

const groupBy = <R, K>(rows: readonly R[], keyOf: (row: R) => K): Map<K, R[]> => {
  const groups = new Map<K, R[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return groups;
};

/** Machine codes in their natural order (`101` before `1001`), for a stable list. */
const byCode = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/**
 * Rows per transaction — the register import's 200 (register/import/apply-import.ts): a transaction
 * is capped at 60 seconds, and a move re-files thousands of rows.
 */
export const BRANCH_MOVE_BATCH_SIZE = 200;

/** `items` in runs of `size`, in order. */
export const chunks = <T>(items: readonly T[], size: number = BRANCH_MOVE_BATCH_SIZE): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// ── Names a merge renames ─────────────────────────────────────────────────────────────────────

/**
 * What a renamed zone or line carries: the source branch's name, as the top bar shows it (Arabic
 * first, the zones' own script) — «قطاع 1 (أكتوبر)» says where the zone came from, where a bare
 * number would not. Control characters dropped (a route name refuses them), capped so the base keeps
 * room. Empty for a branch with no name left: the numbered form is used instead.
 */
export const moveSuffixLabel = (name: LocalizedString | null): string => {
  const text = name === null ? '' : name.ar.trim() || name.en.trim();
  return text
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, 30)
    .trim();
};

/**
 * `base (label)`, then `base (label 2)`, `base (label 3)`, … — the first name `isFree` accepts. The
 * base is shortened so the whole stays within `max` (a zone or route name is at most 60). With no
 * label: `base (2)`, `base (3)`, ….
 */
export const suffixedName = (
  base: string,
  label: string,
  isFree: (name: string) => boolean,
  max: number = ATM_MAP_ZONE_NAME_MAX,
): string => {
  for (let n = 1; ; n += 1) {
    const inner = label === '' ? String(n + 1) : n === 1 ? label : `${label} ${String(n)}`;
    const tail = ` (${inner})`;
    const name = `${base
      .trim()
      .slice(0, Math.max(0, max - tail.length))
      .trimEnd()}${tail}`.trim();
    if (isFree(name)) return name;
  }
};

// ── Labels (`atm_ref_labels`) ─────────────────────────────────────────────────────────────────

export interface MoveLabelRow {
  id: string;
  kind: string;
  name: string;
  nameAr: string | null;
  nameEn: string | null;
  formerNames: readonly string[];
  bankCode: string | null;
  isDeleted: boolean;
}

/** What one source label becomes. Every source row moves — a merged or retired one deleted first. */
export type LabelMove =
  { action: 'move' } | { action: 'merge'; targetId: string } | { action: 'retire' };

/** What a merge fills on the row that stays — only what it left empty, never a value it set. */
export interface LabelFill {
  bankCode: string | null;
  nameAr: string | null;
  nameEn: string | null;
  /** Appended to its former names: new ones only, never its own current name. */
  formerNames: string[];
}

export interface LabelMovePlan {
  /** By source row id — every source row has one. */
  moves: Map<string, LabelMove>;
  /** By the id of the row that stays — only rows that get something. */
  fills: Map<string, LabelFill>;
  merged: number;
  retired: number;
}

const labelKey = (kind: string, name: string): string => `${kind}\u0000${name}`;

/**
 * The label rule. A source name the target also holds LIVE: the target's row stays (its bank and
 * archive decisions are Operations' own), it takes only what it left empty — a bank code, a display
 * name — and the union of the former names, and the source's row is retired. A source name the
 * target RENAMED AWAY (in the former names of any of its rows, live or deleted — DEC-38's "never
 * bring this name back" reads them all): retired. Everything else moves as it is, deleted rows
 * included — they are the branch's memory of what it deleted and renamed, which the boot backfill
 * reads so it never re-creates those names (catalogs/area-labels.ts).
 */
export const planLabelMoves = (
  source: readonly MoveLabelRow[],
  target: readonly MoveLabelRow[],
): LabelMovePlan => {
  // The target's live rows as the merge leaves them — a working copy each, so a second source row
  // of one name fills only what the first left empty.
  const live = new Map<
    string,
    { id: string; name: string } & Omit<LabelFill, 'formerNames'> & {
        formerNames: string[];
      }
  >();
  const adopt = (row: MoveLabelRow): void => {
    live.set(labelKey(row.kind, row.name), {
      id: row.id,
      name: row.name,
      bankCode: row.bankCode,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      formerNames: [...row.formerNames],
    });
  };
  for (const row of target) if (!row.isDeleted) adopt(row);
  const renamedAway = new Set(
    target.flatMap((row) => row.formerNames.map((former) => labelKey(row.kind, former))),
  );

  const plan: LabelMovePlan = { moves: new Map(), fills: new Map(), merged: 0, retired: 0 };
  for (const row of source) {
    if (row.isDeleted) {
      plan.moves.set(row.id, { action: 'move' });
      continue;
    }
    const key = labelKey(row.kind, row.name);
    const into = live.get(key);
    if (into !== undefined) {
      const fill = plan.fills.get(into.id) ?? {
        bankCode: null,
        nameAr: null,
        nameEn: null,
        formerNames: [],
      };
      for (const field of ['bankCode', 'nameAr', 'nameEn'] as const) {
        const given = row[field];
        if (into[field] === null && given !== null) {
          into[field] = given;
          fill[field] = given;
        }
      }
      for (const former of row.formerNames) {
        if (former === into.name || into.formerNames.includes(former)) continue;
        into.formerNames.push(former);
        fill.formerNames.push(former);
      }
      const fills =
        fill.bankCode !== null ||
        fill.nameAr !== null ||
        fill.nameEn !== null ||
        fill.formerNames.length > 0;
      if (fills) plan.fills.set(into.id, fill);
      plan.moves.set(row.id, { action: 'merge', targetId: into.id });
      plan.merged += 1;
      continue;
    }
    if (renamedAway.has(key)) {
      plan.moves.set(row.id, { action: 'retire' });
      plan.retired += 1;
      continue;
    }
    plan.moves.set(row.id, { action: 'move' });
    // Live in the target from here on: a second source row of the same name (two live rows of one
    // name — a database whose unique index was never built) merges into this one.
    adopt(row);
  }
  return plan;
};

// ── Machines (`atm_machines`) ─────────────────────────────────────────────────────────────────

/** A LIVE master (not deleted) of a code both branches hold. */
export interface MoveMachineRow {
  id: string;
  side: MoveSide;
  machineCode: string;
  isActive: boolean;
  /** An open register entry is coupled to it (`machineId`): it holds the code's open period (D2). */
  holdsOpenEntry: boolean;
  /**
   * An open replenishment or maintenance names it, or a draft or issued settlements plan line does
   * (review finding: a retired twin's line could no longer be issued — `machinePlannable` reads
   * live masters only). A prepared or cancelled line is history, kept as its snapshot.
   */
  holdsOpenOperation: boolean;
}

export interface MachineTwinPlan {
  /**
   * Retired before the move, the legacy way — `<code>-D`, deleted — each keeping its history, and
   * naming the master that stays (`survivorId`), which takes the twin's cassette layout and map
   * point when it has none of its own (the service, inside the retire).
   */
  retire: { id: string; machineCode: string; side: MoveSide; survivorId: string }[];
  /** Codes active in both branches where the register does not decide which machine exists. */
  activeInBoth: string[];
  /** Codes whose twin to retire still holds an open register entry or an open operation. */
  twinOpen: string[];
}

/**
 * The master that stays for one code: the ACTIVE one; of several active ones, the one holding the
 * code's open register period (D2 — the register decides which machine exists), none when neither
 * or both do (DEC-11 twins); of archived ones only, the target's.
 */
const survivorOf = (group: readonly MoveMachineRow[]): MoveMachineRow | null => {
  const active = group.filter((row) => row.isActive);
  if (active.length > 1) {
    const holders = active.filter((row) => row.holdsOpenEntry);
    return holders.length === 1 ? (holders[0] ?? null) : null;
  }
  if (active.length === 1) return active[0] ?? null;
  const targets = group.filter((row) => row.side === 'target');
  return targets.find((row) => row.holdsOpenEntry || row.holdsOpenOperation) ?? targets[0] ?? null;
};

/**
 * One code held by a live master in each branch cannot be re-filed as it is: `ux_branch_code` is
 * one live master per branch and code. The survivor keeps its id and history; every twin that would
 * meet it in the target is retired — the other branch's, and the source's own when the source's
 * survives (all of the source arrives). Never merged into one identity: the twin's layouts,
 * locations and layout versions are unique per machine id, so they go to the survivor only where it
 * has none (the service). A twin still holding an open entry, operation or plan line is never
 * retired: the code is listed instead, for the administrator to close it first.
 */
export const planMachineTwins = (rows: readonly MoveMachineRow[]): MachineTwinPlan => {
  const plan: MachineTwinPlan = { retire: [], activeInBoth: [], twinOpen: [] };
  const groups = groupBy(rows, (row) => row.machineCode);
  for (const code of [...groups.keys()].sort(byCode)) {
    const group = groups.get(code) ?? [];
    if (
      !group.some((row) => row.side === 'source') ||
      !group.some((row) => row.side === 'target')
    ) {
      continue;
    }
    const survivor = survivorOf(group);
    if (survivor === null) {
      plan.activeInBoth.push(code);
      continue;
    }
    const retired = group.filter(
      (row) => row !== survivor && (survivor.side === 'source' || row.side === 'source'),
    );
    if (retired.some((row) => row.holdsOpenEntry || row.holdsOpenOperation)) {
      plan.twinOpen.push(code);
      continue;
    }
    plan.retire.push(
      ...retired.map((row) => ({
        id: row.id,
        machineCode: row.machineCode,
        side: row.side,
        survivorId: survivor.id,
      })),
    );
  }
  return plan;
};

/** What the twin plan refuses: the codes the administrator resolves first. */
export const twinBlockers = (plan: MachineTwinPlan): AtmBranchMoveBlockerDto[] => [
  ...(plan.activeInBoth.length > 0
    ? [{ kind: 'machineActiveInBoth' as const, codes: plan.activeInBoth }]
    : []),
  ...(plan.twinOpen.length > 0 ? [{ kind: 'machineTwinOpen' as const, codes: plan.twinOpen }] : []),
];

// ── Map zones (`atm_map_zones`) ───────────────────────────────────────────────────────────────

/** A LIVE zone, with its number of points. */
export interface MoveZoneRow {
  id: string;
  name: string;
  order: number;
  points: number;
}

export interface ZoneMove {
  id: string;
  name: string;
  order: number;
  renamed: boolean;
}

/**
 * The source's live zones as they arrive: after the target's, in their own order (D-M7 — the order
 * is the priority, and the target's keeps its own), a name the target already uses suffixed with the
 * source's name. Names compare by the zone service's own key (DM-8): a later save of the target
 * would refuse a duplicate. A suffixed name avoids every name either branch holds; two source zones
 * of one name (legacy) end up distinct too.
 */
export const planZoneMoves = (
  source: readonly MoveZoneRow[],
  target: readonly MoveZoneRow[],
  label: string,
): { zones: ZoneMove[]; renamed: number } => {
  const taken = new Set(target.map((zone) => zoneNameKey(zone.name)));
  const reserved = new Set([...taken, ...source.map((zone) => zoneNameKey(zone.name))]);
  const first = firstOrderAfter(target);
  let renamed = 0;
  const zones = [...source].sort(byOrder).map((zone, index): ZoneMove => {
    let name = zone.name;
    if (taken.has(zoneNameKey(name))) {
      name = suffixedName(zone.name, label, (candidate) => !reserved.has(zoneNameKey(candidate)));
      reserved.add(zoneNameKey(name));
      renamed += 1;
    }
    taken.add(zoneNameKey(name));
    return { id: zone.id, name, order: first + index, renamed: name !== zone.name };
  });
  return { zones, renamed };
};

/**
 * The map's caps on the target after the move (`ATM_MAP_ZONES_PER_BRANCH_MAX` zones,
 * `ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX` points): past either, no zone save of the target could ever
 * pass again. A source with no zones adds nothing and never blocks.
 */
export const zoneCapsBlocker = (
  source: readonly MoveZoneRow[],
  target: readonly MoveZoneRow[],
): AtmBranchMoveBlockerDto | null => {
  if (source.length === 0) return null;
  const zones = source.length + target.length;
  const points = [...source, ...target].reduce((sum, zone) => sum + zone.points, 0);
  return zones > ATM_MAP_ZONES_PER_BRANCH_MAX || points > ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX
    ? { kind: 'zoneCaps', zones, points }
    : null;
};

// ── Dispatch lines (`atm_dispatch_routes`) ────────────────────────────────────────────────────

/** A LIVE route of one day. */
export interface MoveRouteRow {
  id: string;
  replenishDate: string;
  name: string;
  nameKey: string;
  order: number;
}

export interface RouteMove {
  id: string;
  name: string;
  nameKey: string;
  order: number;
  renamed: boolean;
}

/**
 * Per day, the zones' rule: the source's lines follow the target's in their own order, and a name
 * the target uses that day (`ux_branch_date_name` is per branch, day and name key) is suffixed with
 * the source's name. A zone-made line copies its zone's name, so the clashes are likely.
 */
export const planRouteMoves = (
  source: readonly MoveRouteRow[],
  target: readonly MoveRouteRow[],
  label: string,
): { routes: RouteMove[]; renamed: number } => {
  const targetByDay = groupBy(target, (route) => route.replenishDate);
  const routes: RouteMove[] = [];
  let renamed = 0;
  for (const [day, own] of groupBy(source, (route) => route.replenishDate)) {
    const theirs = targetByDay.get(day) ?? [];
    const taken = new Set(theirs.map((route) => route.nameKey));
    const reserved = new Set([...taken, ...own.map((route) => route.nameKey)]);
    const first = firstOrderAfter(theirs);
    [...own].sort(byOrder).forEach((route, index) => {
      let { name, nameKey } = route;
      if (taken.has(nameKey)) {
        name = suffixedName(
          route.name,
          label,
          (candidate) => !reserved.has(zoneNameKey(candidate)),
        );
        nameKey = zoneNameKey(name);
        reserved.add(nameKey);
        renamed += 1;
      }
      taken.add(nameKey);
      routes.push({
        id: route.id,
        name,
        nameKey,
        order: first + index,
        renamed: name !== route.name,
      });
    });
  }
  return { routes, renamed };
};

// ── Standard loads (`atm_standard_loads`) ─────────────────────────────────────────────────────

/** A LIVE standard load. */
export interface MoveStandardLoadRow {
  id: string;
  bankCode: string;
  isDefault: boolean;
  order: number;
}

export interface StandardLoadMove {
  id: string;
  order: number;
  /** A default for a bank the target already has a default for: no longer the default. */
  unsetDefault: boolean;
}

/**
 * Per bank: the source's loads follow the target's in their own order, and the target's default
 * stays the default (`ux_default` is one per branch and bank) — the source's is switched off, the
 * standard-load service's own switch. A load, layout or line pointing at a source load by id keeps
 * working: the profile lookup reads the target's live loads (standard-load.service.ts).
 */
export const planStandardLoadMoves = (
  source: readonly MoveStandardLoadRow[],
  target: readonly MoveStandardLoadRow[],
): { loads: StandardLoadMove[]; defaultsUnset: number } => {
  const targetByBank = groupBy(target, (load) => load.bankCode);
  const loads: StandardLoadMove[] = [];
  let defaultsUnset = 0;
  for (const [bankCode, own] of groupBy(source, (load) => load.bankCode)) {
    const theirs = targetByBank.get(bankCode) ?? [];
    let hasDefault = theirs.some((load) => load.isDefault);
    const first = firstOrderAfter(theirs);
    [...own].sort(byOrder).forEach((load, index) => {
      const unsetDefault = load.isDefault && hasDefault;
      if (load.isDefault) hasDefault = true;
      if (unsetDefault) defaultsUnset += 1;
      loads.push({ id: load.id, order: first + index, unsetDefault });
    });
  }
  return { loads, defaultsUnset };
};

// ── Branch ids inside values ──────────────────────────────────────────────────────────────────

const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * A setting row list keyed by branch (`atm.mail.branchCategories`, `atm.register.branchCodes`): the
 * source's rows re-pointed to the target, unless the target has a row of its own — then nothing
 * changes (the target's answers; a code left on the source still resolves to the target through the
 * link). Null when nothing changes.
 */
export const repointBranchRows = <R extends { branchId: string }>(
  rows: readonly R[],
  source: string,
  target: string,
): { rows: R[]; repointed: number } | null => {
  const named = rows.filter((row) => sameId(row.branchId, source)).length;
  if (named === 0 || rows.some((row) => sameId(row.branchId, target))) return null;
  return {
    rows: rows.map((row) => (sameId(row.branchId, source) ? { ...row, branchId: target } : row)),
    repointed: named,
  };
};

/**
 * The mailbox's switched-on list: the source's row becomes the target's, its category kept — or is
 * dropped when the target is on the list already (each branch once, the save's own rule). Null when
 * the source is not on it.
 */
export const repointMailboxBranches = <R extends { branchId: string }>(
  rows: readonly R[],
  source: string,
  target: string,
): R[] | null => {
  if (!rows.some((row) => sameId(row.branchId, source))) return null;
  let listed = rows.some((row) => sameId(row.branchId, target));
  const out: R[] = [];
  for (const row of rows) {
    if (!sameId(row.branchId, source)) out.push(row);
    else if (!listed) {
      out.push({ ...row, branchId: target });
      listed = true;
    }
  }
  return out;
};

// ── Blockers ──────────────────────────────────────────────────────────────────────────────────

/** Blockers in the contract's order — the dialog lists them so. */
export const orderedBlockers = (
  blockers: readonly AtmBranchMoveBlockerDto[],
): AtmBranchMoveBlockerDto[] =>
  [...blockers].sort(
    (a, b) => ATM_BRANCH_MOVE_BLOCKERS.indexOf(a.kind) - ATM_BRANCH_MOVE_BLOCKERS.indexOf(b.kind),
  );

/** A long list shortened for a message: the first ten, then how many more. */
const listed = (items: readonly string[]): string =>
  items.length <= 10
    ? items.join(', ')
    : `${items.slice(0, 10).join(', ')} and ${String(items.length - 10)} more`;

const blockerMessage = (blocker: AtmBranchMoveBlockerDto): string => {
  switch (blocker.kind) {
    case 'machineActiveInBoth':
      return `machine codes active in both branches: ${listed(blocker.codes)}`;
    case 'machineTwinOpen':
      return `machine twins still holding open work: ${listed(blocker.codes)}`;
    case 'planSerialCollision':
      return `Notes of these banks were issued in both branches: ${listed(blocker.bankCodes)}`;
    case 'planSameDay':
      return `plans of one bank and day in both branches: ${listed(
        blocker.items.map((item) => `${item.bankCode} ${item.replenishDate}`),
      )}`;
    case 'zoneCaps':
      return `the target would hold ${String(blocker.zones)} zones and ${String(blocker.points)} points`;
    case 'layoutImportRunning':
      return `a Full list import of the source is running: ${listed(blocker.bankCodes)}`;
    case 'moveRunning':
      return 'another move is running';
  }
};

/** The 409's details (`ATM_BRANCH_MOVE_BLOCKED`): one per blocker, its kind as the code. */
export const blockerDetails = (blockers: readonly AtmBranchMoveBlockerDto[]): ApiErrorDetail[] =>
  orderedBlockers(blockers).map((blocker) => ({
    field: 'blockers',
    code: blocker.kind,
    message: blockerMessage(blocker),
  }));
