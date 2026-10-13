// What applying this file would do — decided from the parsed rows and a read of the database,
// with NO write (spec §6.4, second half). The preview shows this plan; the apply re-plans the same
// bytes and refuses while any blocker stands (§6.6).
//
// THE REACH RULE (review finding F-3). Everything the plan reads or would write is limited to the
// importer's reach: `atmRegister.import` must reach a row's branch (rows with no or an unknown
// branch need an organization-wide grant). Rows of a branch out of reach are counted in the
// branches table and block the apply (`branchOutOfReach`) — they produce no item, no issue detail
// and no master data. An active master in an out-of-reach branch is still CONSIDERED (a receipt
// would be refused because of it, DEC-9), but it is named only to an importer who reaches it.
//
// THE SAME RULE FOR WHAT IS ALREADY STORED (review finding SEC-1). `changedSinceImport` names the
// columns where a stored entry differs from the file — an equality test per column, so for a value
// the importer may not read it is an oracle (vary the cell, watch the letter). A stored entry is
// therefore compared only when `atmRegister.import` reaches ITS branch (one imported into a branch
// out of reach is reported as differing in column A — true, since the row's own branch is in reach
// — and nothing else about it is looked at or shown), and its K columns (J..Q, AN, AU) only when
// `atmRegister.viewSecrets` covers that branch: the DTO's `secretsVisible` rule (DEC-7, DEC-29).
//
// The pure half (`planRegisterImport`) takes the world as a value so its spec can hold the masters
// in memory; `loadPlanWorld` is the one place that reads the database for it.
import {
  ATM_NBE_FOREX_LABEL,
  ATM_REGISTER_BRANCH_CODES,
  ATM_REGISTER_BRANCH_NAMES,
  ATM_REGISTER_COLUMNS,
  ATM_REGISTER_IMPORT_BLOCKERS,
  type AtmBankCode,
  type AtmRegisterImportBlocker,
  type AtmRegisterImportCategory,
  type AtmRegisterImportCategoryDto,
  type AtmRegisterImportIssueCode,
  type AtmRegisterImportItemDto,
  type AtmRegisterImportReason,
  type AtmRegisterImportReport,
  type AtmRegisterImportResultDto,
  type AtmRegisterStatus,
  type LocalizedString,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { branchRepository } from '../../../../platform/organization';
import { getSecretStore } from '../../../../platform/secrets';
import { keyReachesBranch, scopeOf, type AuthContext } from '../../../../shared/types';
import { AtmRefLabelModel } from '../../catalogs/ref-label.model';
import { AtmMachineModel } from '../../machines/machine.model';
import { isPlaceholderMachineCode } from '../register-coupling';
import { registerDateString } from '../register.mapper';
import { AtmRegisterEntryModel, type AtmRegisterEntryDoc } from '../register.model';
import { atmRegisterEntryRepository } from '../register.repository';
import { resolveRegisterSettings, type RegisterSettings } from '../register-settings';
import { AtmRegisterImportRunModel } from './register-import-run.model';
import { comparableColumns, type ParsedRegisterFile, type ParsedRow } from './parse-rows';
import { checkDataReport, type DataReportCheck } from './report-check';

/** A `running` import older than this is abandoned, not in progress (§6.6 step 3). */
export const STALE_RUN_MS = 30 * 60 * 1000;

// ── The world the plan is decided against ───────────────────────────────────────────────────────

export interface PlanMaster {
  id: string;
  branchId: string;
  machineCode: string;
  name: string;
  area: string;
  bankName: string;
  isActive: boolean;
}

/** An entry already written from one of this file's row numbers (soft-deleted ones included). */
export interface PlanStoredEntry {
  id: string;
  importRow: number;
  /** The stored entry's own branch — what reach and secrets are judged against (SEC-1). */
  branchId: string | null;
  isDeleted: boolean;
  status: AtmRegisterStatus;
  machineId: string | null;
  opsBankLabel: string | null;
  /** Excel letter → stored value, A..AN and AP..AW (AO is never compared — DEC-31). */
  columns: Map<string, string | null>;
}

export interface PlanOpenEntry {
  id: string;
  branchId: string | null;
  importRow: number | null;
}

export interface PlanBranch {
  name: LocalizedString;
  active: boolean;
}

export interface PlanWorld {
  settings: Pick<RegisterSettings, 'branchIdByCode' | 'codeByBranchId' | 'opsLabel'>;
  /** The mapped branches of the file's codes, by id. */
  branches: Map<string, PlanBranch>;
  /** Live masters (isDeleted:false): every one in the file's in-reach branches, plus every ACTIVE
   *  one anywhere carrying a code of the file (the DEC-9 check). */
  masters: PlanMaster[];
  /** By importRow. */
  imported: Map<number, PlanStoredEntry>;
  /** Non-deleted OPEN entries by machine code (the file's codes and its in-reach masters' codes). */
  openByCode: Map<string, PlanOpenEntry[]>;
  /** In-reach branches holding an ACTIVE `NBE FOREX` bank label (DEC-16). */
  nbeForexBranchIds: Set<string>;
  runInProgress: boolean;
  secretStoreAvailable: boolean;
}

// ── The plan ────────────────────────────────────────────────────────────────────────────────────

export interface ImportPlan {
  counts: AtmRegisterImportResultDto['counts'];
  blockers: AtmRegisterImportBlocker[];
  report: DataReportCheck;
  issues: AtmRegisterImportResultDto['issues'];
  branches: AtmRegisterImportResultDto['branches'];
  categories: AtmRegisterImportCategoryDto[];
  /** Rows not imported before, in row order — what `entries` writes. */
  rowsToImport: ParsedRow[];
  /** Every row number of the file. */
  fileRows: Set<number>;
  /** The file's mapped, in-reach branches — the coupling pass is limited to them (F-3). */
  couplingBranchIds: string[];
}

/** Who the importer is, as far as the plan cares (DEC-7, F-3). */
interface Reach {
  /** Organization-wide `atmRegister.import` — the only reach for rows with no or an unknown branch. */
  importOrg: boolean;
  rowInReach: (row: ParsedRow) => boolean;
  importReaches: (branchId: string) => boolean;
  secretsCover: (branchId: string | null) => boolean;
}

const reachOf = (ctx: AuthContext, branchIdOf: (row: ParsedRow) => string | null): Reach => {
  const importOrg = scopeOf(ctx, 'atmRegister.import') === 'organization';
  const secretsOrg = scopeOf(ctx, 'atmRegister.viewSecrets') === 'organization';
  const importReaches = (branchId: string): boolean =>
    keyReachesBranch(ctx, 'atmRegister.import', branchId);
  return {
    importOrg,
    importReaches,
    rowInReach: (row) => {
      if (importOrg) return true;
      const branchId = branchIdOf(row);
      return branchId !== null && importReaches(branchId);
    },
    secretsCover: (branchId) =>
      secretsOrg ||
      (branchId !== null && keyReachesBranch(ctx, 'atmRegister.viewSecrets', branchId)),
  };
};

const realCode = (code: string | null): code is string =>
  code !== null && !isPlaceholderMachineCode(code);

/** The K columns (J..Q, AN, AU): compared only where the importer may read them (SEC-1). */
const SECRET_LETTERS: ReadonlySet<string> = new Set(
  ATM_REGISTER_COLUMNS.filter((c) => c.sensitivity === 'K').map((c) => c.excel),
);

/** D5 / §6.4: an NBE machine whose area ends with ` FX` is an `NBE FOREX` candidate. */
export const isNbeForexCandidate = (bankCode: AtmBankCode | null, area: string | null): boolean =>
  bankCode === 'NBE' && area !== null && /\sFX$/i.test(area.trim());

const itemOf = (
  row: ParsedRow,
  extra: Partial<AtmRegisterImportItemDto> = {},
): AtmRegisterImportItemDto => ({
  importRow: row.importRow,
  branchCode: row.values.branchCode,
  machineCode: row.values.machineCode,
  name: row.values.name,
  area: row.values.area,
  bankCode: row.values.bankCode,
  machineId: null,
  masterBankLabel: null,
  reason: null,
  differences: [],
  otherBranchCode: null,
  otherBranchName: null,
  entryId: null,
  columns: [],
  ...extra,
});

const APPROVABLE: readonly AtmRegisterImportCategory[] = [
  'entries',
  'link',
  'reactivate',
  'create',
  'nbeForex',
];
const REPORTS: readonly AtmRegisterImportReport[] = [
  'openInRegister',
  'changedSinceImport',
  'cannotCouple',
  'activeElsewhere',
  'activeMasterWithoutOpenEntry',
];

/**
 * Decide the plan. Pure: every database fact arrives in `world`, the importer's reach in `ctx`.
 */
export const planRegisterImport = (
  parsed: ParsedRegisterFile,
  world: PlanWorld,
  ctx: AuthContext,
): ImportPlan => {
  const { settings } = world;
  const branchIdOf = (row: ParsedRow): string | null =>
    row.values.branchCode === null
      ? null
      : (settings.branchIdByCode.get(row.values.branchCode) ?? null);
  const reach = reachOf(ctx, branchIdOf);
  const blockers = new Set<AtmRegisterImportBlocker>();
  const fileRows = new Set(parsed.rows.map((r) => r.importRow));
  const inReachRows = parsed.rows.filter(reach.rowInReach);

  // 1. Branches — every code present, mapped or not; blank/unknown A needs organization reach.
  const branches: AtmRegisterImportResultDto['branches'] = [];
  for (const code of ATM_REGISTER_BRANCH_CODES) {
    const rows = parsed.rows.filter((r) => r.values.branchCode === code);
    if (rows.length === 0) continue;
    const branchId = settings.branchIdByCode.get(code) ?? null;
    const branch = branchId === null ? undefined : world.branches.get(branchId);
    const active = branch?.active ?? false;
    const inReach = branchId !== null && reach.importReaches(branchId);
    if (branchId === null) blockers.add('branchUnmapped');
    else if (!active) blockers.add('branchInactive');
    if (branchId !== null && !inReach) blockers.add('branchOutOfReach');
    branches.push({
      code,
      branchId,
      branchName: branch?.name ?? null,
      active,
      inReach,
      rows: rows.length,
      openRows: rows.filter((r) => r.status === 'open').length,
    });
  }
  if (parsed.rows.some((r) => r.values.branchCode === null) && !reach.importOrg) {
    blockers.add('branchOutOfReach');
  }

  // 2. Secrets reach (DEC-7, per branch): whoever writes a key value must be able to read it there.
  if (parsed.rows.some((r) => r.carriesSecrets && !reach.secretsCover(branchIdOf(r)))) {
    blockers.add('secretsOutOfReach');
  }

  // 3. Already imported — skipped by `entries`, but only while nothing changed (DEC-31). Compared
  //    only as far as the importer may read the stored entry (SEC-1, header).
  const rowsToImport = parsed.rows.filter((r) => !world.imported.has(r.importRow));
  const storedInReach = (stored: PlanStoredEntry): boolean =>
    reach.importOrg || (stored.branchId !== null && reach.importReaches(stored.branchId));
  const changed: AtmRegisterImportItemDto[] = [];
  for (const row of inReachRows) {
    const stored = world.imported.get(row.importRow);
    // A deleted entry was removed from the register on purpose and the import never brings it
    // back, wherever it sat — so it is skipped before reach is asked. That reveals only that some
    // entry with this row number was deleted, never what it held (REG-3).
    if (stored === undefined || stored.isDeleted) continue;
    if (!storedInReach(stored)) {
      // Imported into a branch out of reach while the file puts the row in one in reach: column A
      // differs, whatever else is true of that entry — which is neither compared nor named.
      changed.push(itemOf(row, { columns: ['A'] }));
      continue;
    }
    const secretsSeen = reach.secretsCover(stored.branchId);
    const columns: string[] = [];
    for (const [letter, value] of comparableColumns(row)) {
      if (!secretsSeen && SECRET_LETTERS.has(letter)) continue;
      if ((stored.columns.get(letter) ?? null) !== value) columns.push(letter);
    }
    if (columns.length > 0) changed.push(itemOf(row, { entryId: stored.id, columns }));
  }
  if (changed.length > 0) blockers.add('changedSinceImport');

  // 4. The 57 numbers.
  const report = checkDataReport(parsed.rows);
  if (!report.allMatch) blockers.add('reportMismatch');

  // 5. Unreadable dates.
  if (parsed.rows.some((r) => r.dateUnreadable)) blockers.add('dateUnreadable');

  // 6. Open in the register already — except an entry imported from a row of this very file
  //    (an in-file pair is `duplicateOpen`, DEC-11).
  const notFromThisFile = (entry: PlanOpenEntry): boolean =>
    entry.importRow === null || !fileRows.has(entry.importRow);
  const nameIfReached = (
    branchId: string | null,
  ): Pick<AtmRegisterImportItemDto, 'otherBranchCode' | 'otherBranchName'> => {
    const code = branchId === null ? undefined : settings.codeByBranchId.get(branchId);
    return branchId !== null && code !== undefined && reach.importReaches(branchId)
      ? { otherBranchCode: code, otherBranchName: ATM_REGISTER_BRANCH_NAMES[code] }
      : { otherBranchCode: null, otherBranchName: null };
  };
  const openInRegister: AtmRegisterImportItemDto[] = [];
  const blockedOpen = new Set<number>();
  for (const row of inReachRows) {
    const code = row.values.machineCode;
    if (row.status !== 'open' || world.imported.has(row.importRow) || !realCode(code)) continue;
    const other = (world.openByCode.get(code) ?? []).find(notFromThisFile);
    if (other === undefined) continue;
    blockedOpen.add(row.importRow);
    openInRegister.push(itemOf(row, { entryId: other.id, ...nameIfReached(other.branchId) }));
  }
  if (openInRegister.length > 0) blockers.add('openInRegister');

  // 7. The secret store, and another import.
  if (!world.secretStoreAvailable && parsed.rows.some((r) => r.plaintextCombination !== null)) {
    blockers.add('secretStoreUnavailable');
  }
  if (world.runInProgress) blockers.add('runInProgress');

  // 8. Reconciliation of OPEN rows against the live masters and the masters this plan creates.
  const key = (branchId: string, code: string): string => `${branchId}|${code}`;
  const liveMaster = new Map(world.masters.map((m) => [key(m.branchId, m.machineCode), m]));
  const activeByCode = new Map<string, PlanMaster[]>();
  for (const master of world.masters) {
    if (!master.isActive) continue;
    activeByCode.set(master.machineCode, [...(activeByCode.get(master.machineCode) ?? []), master]);
  }
  /** Masters this plan activates (create / reactivate), so a later row of the code links to them. */
  const planned = new Map<
    string,
    { branchId: string; name: string; area: string; label: string }
  >();
  const plannedByCode = new Map<string, string>();

  const items = new Map<
    AtmRegisterImportCategory | AtmRegisterImportReport,
    AtmRegisterImportItemDto[]
  >([...APPROVABLE, ...REPORTS].map((k) => [k, []]));
  const push = (
    category: AtmRegisterImportCategory | AtmRegisterImportReport,
    item: AtmRegisterImportItemDto,
  ): void => {
    items.get(category)?.push(item);
  };
  items.set('changedSinceImport', changed);
  items.set('openInRegister', openInRegister);
  const pairs = new Map<string, AtmRegisterImportCategoryDto['pairs'][number]>();
  const cannot = (row: ParsedRow, reason: AtmRegisterImportReason): void =>
    push('cannotCouple', itemOf(row, { reason }));

  for (const row of inReachRows) {
    if (row.status !== 'open' || blockedOpen.has(row.importRow)) continue;
    const branchId = branchIdOf(row);
    const toCode = row.values.branchCode;
    if (branchId === null || toCode === null) continue;
    const stored = world.imported.get(row.importRow);
    // Already written: only an OPEN, still-unlinked entry the importer reaches is still to be
    // coupled (one out of reach is `changedSinceImport` above, and stays out of this plan).
    if (
      stored !== undefined &&
      (!storedInReach(stored) ||
        stored.isDeleted ||
        stored.status !== 'open' ||
        stored.machineId !== null)
    ) {
      continue;
    }
    const { machineCode: code, bankCode, area, name } = row.values;
    if (code === null) {
      cannot(row, 'noCode');
      continue;
    }
    if (isPlaceholderMachineCode(code)) {
      cannot(row, 'placeholderCode');
      continue;
    }
    if (bankCode === null) {
      cannot(row, 'noBank');
      continue;
    }

    // DEC-9 first: an ACTIVE master with this code in another branch refuses, whatever this
    // branch holds — the same order `coupleReceipt` checks in.
    const elsewhere = (activeByCode.get(code) ?? []).find((m) => m.branchId !== branchId);
    const plannedElsewhere = plannedByCode.get(code);
    const otherBranchId =
      elsewhere?.branchId ??
      (plannedElsewhere !== undefined && plannedElsewhere !== branchId ? plannedElsewhere : null);
    if (otherBranchId !== null) {
      const named = nameIfReached(otherBranchId);
      push('activeElsewhere', itemOf(row, { reason: 'activeElsewhere', ...named }));
      const pairKey = `${named.otherBranchCode ?? ''}>${toCode}`;
      const pair = pairs.get(pairKey) ?? {
        fromBranchCode: named.otherBranchCode,
        fromBranchName: named.otherBranchName,
        toBranchCode: toCode,
        count: 0,
      };
      pair.count += 1;
      pairs.set(pairKey, pair);
      continue;
    }

    const live = liveMaster.get(key(branchId, code));
    const plan = planned.get(key(branchId, code));
    const nbe = isNbeForexCandidate(bankCode, area);
    if (plan !== undefined || (live !== undefined && live.isActive)) {
      const master = plan ?? live;
      const differences: ('name' | 'area')[] = [];
      if (master?.name !== name) differences.push('name');
      if (master?.area !== area) differences.push('area');
      const label = plan?.label ?? live?.bankName ?? null;
      push(
        'link',
        itemOf(row, {
          machineId: plan === undefined ? (live?.id ?? null) : null,
          masterBankLabel: label,
          differences,
        }),
      );
      if (nbe)
        push('nbeForex', itemOf(row, { reason: 'keepsMasterLabel', masterBankLabel: label }));
      continue;
    }
    if (area === null) {
      cannot(row, 'blankArea');
      continue;
    }
    if (name === null) {
      cannot(row, 'noName');
      continue;
    }
    const label = settings.opsLabel(bankCode);
    if (live !== undefined) push('reactivate', itemOf(row, { machineId: live.id }));
    else push('create', itemOf(row));
    planned.set(key(branchId, code), { branchId, name, area, label });
    plannedByCode.set(code, branchId);
    if (nbe) {
      push(
        'nbeForex',
        itemOf(row, {
          machineId: live?.id ?? null,
          reason: world.nbeForexBranchIds.has(branchId) ? null : 'labelMissing',
        }),
      );
    }
  }

  // NBE FOREX for entries already coupled under the DEFAULT label (an earlier pass created or
  // reactivated their master without the category): relabel + the D2 edit sync.
  for (const row of inReachRows) {
    const stored = world.imported.get(row.importRow);
    const branchId = branchIdOf(row);
    if (
      stored === undefined ||
      branchId === null ||
      !storedInReach(stored) ||
      stored.isDeleted ||
      stored.status !== 'open' ||
      stored.machineId === null ||
      !isNbeForexCandidate(row.values.bankCode, row.values.area)
    ) {
      continue;
    }
    if (stored.opsBankLabel !== null) {
      if (stored.opsBankLabel !== ATM_NBE_FOREX_LABEL) {
        push(
          'nbeForex',
          itemOf(row, {
            reason: 'keepsMasterLabel',
            machineId: stored.machineId,
            masterBankLabel: stored.opsBankLabel,
          }),
        );
      }
      continue;
    }
    push(
      'nbeForex',
      itemOf(row, {
        machineId: stored.machineId,
        entryId: stored.id,
        reason: world.nbeForexBranchIds.has(branchId) ? null : 'labelMissing',
      }),
    );
  }

  // Active Operations machines of the file's in-reach branches with no open period anywhere in
  // the file or the register — shown for the owner to decide in data-edit.
  const couplingBranchIds = [
    ...new Set(
      inReachRows.flatMap((row) => {
        const branchId = branchIdOf(row);
        return branchId === null ? [] : [branchId];
      }),
    ),
  ];
  const openInFile = new Set(
    parsed.rows
      .filter((r) => r.status === 'open' && realCode(r.values.machineCode))
      .flatMap((r) => {
        const branchId = branchIdOf(r);
        return branchId === null ? [] : [key(branchId, r.values.machineCode ?? '')];
      }),
  );
  for (const master of world.masters) {
    if (!master.isActive || !couplingBranchIds.includes(master.branchId)) continue;
    if (openInFile.has(key(master.branchId, master.machineCode))) continue;
    const openHere = (world.openByCode.get(master.machineCode) ?? []).some(
      (entry) => entry.branchId === master.branchId,
    );
    if (openHere) continue;
    push('activeMasterWithoutOpenEntry', {
      importRow: 0,
      branchCode: settings.codeByBranchId.get(master.branchId) ?? null,
      machineCode: master.machineCode,
      name: master.name,
      area: master.area,
      bankCode: null,
      machineId: master.id,
      masterBankLabel: master.bankName,
      reason: null,
      differences: [],
      otherBranchCode: null,
      otherBranchName: null,
      entryId: null,
      columns: [],
    });
  }

  const categories: AtmRegisterImportCategoryDto[] = [
    {
      key: 'entries',
      approvable: true,
      count: rowsToImport.length,
      // One per row would be the whole file again; the counts above say it by status.
      items: [],
      pairs: [],
    },
    ...(['link', 'reactivate', 'create'] as const).map((k): AtmRegisterImportCategoryDto => {
      const list = items.get(k) ?? [];
      return { key: k, approvable: true, count: list.length, items: list, pairs: [] };
    }),
    (() => {
      const list = items.get('nbeForex') ?? [];
      // Only the items without a reason are applied; the others are listed so nobody wonders.
      return {
        key: 'nbeForex' as const,
        approvable: true,
        count: list.filter((i) => i.reason === null).length,
        items: list,
        pairs: [],
      };
    })(),
    ...REPORTS.map((k): AtmRegisterImportCategoryDto => {
      const list = items.get(k) ?? [];
      return {
        key: k,
        approvable: false,
        count: list.length,
        items: list,
        pairs: k === 'activeElsewhere' ? [...pairs.values()] : [],
      };
    }),
  ];

  // Issues — of the rows the importer reaches (a detail is a P value of that row).
  const byCode = new Map<AtmRegisterImportIssueCode, number>();
  const issueRows: AtmRegisterImportResultDto['issues']['rows'] = [];
  for (const row of inReachRows) {
    if (row.issues.length === 0) continue;
    issueRows.push({ importRow: row.importRow, issues: row.issues.map((i) => ({ ...i })) });
    for (const issue of row.issues) byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);
  }

  return {
    counts: {
      rows: parsed.rows.length,
      open: parsed.rows.filter((r) => r.status === 'open').length,
      ended: parsed.rows.filter((r) => r.status === 'ended').length,
      pending: parsed.rows.filter((r) => r.status === 'pending').length,
      alreadyImported: parsed.rows.length - rowsToImport.length,
    },
    blockers: ATM_REGISTER_IMPORT_BLOCKERS.filter((b) => blockers.has(b)),
    report,
    issues: { byCode: [...byCode].map(([code, count]) => ({ code, count })), rows: issueRows },
    branches,
    categories,
    rowsToImport,
    fileRows,
    couplingBranchIds,
  };
};

// ── The database read behind the plan ───────────────────────────────────────────────────────────

/** A stored entry's comparable columns, in the parsed row's vocabulary. */
const storedColumns = (
  doc: AtmRegisterEntryDoc,
  settings: Pick<RegisterSettings, 'codeByBranchId'>,
): Map<string, string | null> => {
  const out = new Map<string, string | null>();
  for (const column of ATM_REGISTER_COLUMNS) {
    const { field } = column;
    if (field === 'safeCombination') continue;
    let value: unknown;
    if (field === 'branchCode') {
      value =
        doc.branchId === null ? null : (settings.codeByBranchId.get(String(doc.branchId)) ?? null);
    } else if (field === 'startDate' || field === 'endDate') {
      value = registerDateString(doc[field]);
    } else if (field.startsWith('keys.')) {
      value = (doc.keys as unknown as Record<string, unknown> | undefined)?.[field.slice(5)];
    } else if (field.startsWith('cassettes.')) {
      value = (doc.cassettes as unknown as Record<string, unknown> | undefined)?.[field.slice(10)];
    } else {
      value = (doc as unknown as Record<string, unknown>)[field];
    }
    out.set(column.excel, typeof value === 'string' ? value : null);
  }
  return out;
};

/** Every database fact the plan needs, read once, limited to what the importer reaches (F-3). */
export const loadPlanWorld = async (
  parsed: ParsedRegisterFile,
  ctx: AuthContext,
): Promise<PlanWorld> => {
  const settings = await resolveRegisterSettings();
  const codesInFile = [
    ...new Set(
      parsed.rows.flatMap((r) => (r.values.branchCode === null ? [] : [r.values.branchCode])),
    ),
  ];
  const mappedIds = codesInFile.flatMap((code) => {
    const id = settings.branchIdByCode.get(code);
    return id === undefined ? [] : [id];
  });
  const branchDocs = await branchRepository.findByIdsSystem(mappedIds);
  const branches = new Map<string, PlanBranch>(
    branchDocs.map((b) => [
      String(b._id),
      { name: b.name, active: !b.isDeleted && b.status === 'active' },
    ]),
  );
  const reachedIds = mappedIds.filter((id) => keyReachesBranch(ctx, 'atmRegister.import', id));
  const reached = reachedIds.map((id) => new Types.ObjectId(id));
  const machineCodes = [
    ...new Set(
      parsed.rows.flatMap((r) => (realCode(r.values.machineCode) ? [r.values.machineCode] : [])),
    ),
  ];

  const masterDocs = await AtmMachineModel.find(
    {
      isDeleted: false,
      $or: [{ branchId: { $in: reached } }, { isActive: true, machineCode: { $in: machineCodes } }],
    },
    { branchId: 1, machineCode: 1, name: 1, area: 1, bankName: 1, isActive: 1 },
  )
    .lean<
      {
        _id: Types.ObjectId;
        branchId: Types.ObjectId;
        machineCode: string;
        name: string;
        area: string;
        bankName: string;
        isActive: boolean;
      }[]
    >()
    .exec();
  const masters: PlanMaster[] = masterDocs.map((m) => {
    const inReach = reachedIds.includes(String(m.branchId));
    // A master of a branch the importer does not reach is only a fact ("active elsewhere"); its
    // name, area and label are not carried.
    return {
      id: String(m._id),
      branchId: String(m.branchId),
      machineCode: m.machineCode,
      name: inReach ? m.name : '',
      area: inReach ? m.area : '',
      bankName: inReach ? m.bankName : '',
      isActive: m.isActive,
    };
  });

  // Every stored row number of the file, whatever its branch: `ux_import_row` is company-wide, so
  // the idempotency of `entries` needs them all. What the plan may LOOK AT in one of them is
  // decided per entry in `planRegisterImport` (SEC-1).
  const importedDocs = await AtmRegisterEntryModel.find({
    importRow: { $in: parsed.rows.map((r) => r.importRow) },
  })
    .lean<AtmRegisterEntryDoc[]>()
    .exec();
  const imported = new Map<number, PlanStoredEntry>();
  for (const doc of importedDocs) {
    if (doc.importRow === null) continue;
    imported.set(doc.importRow, {
      id: String(doc._id),
      importRow: doc.importRow,
      branchId: doc.branchId === null ? null : String(doc.branchId),
      isDeleted: doc.isDeleted,
      status: doc.status,
      machineId: doc.machineId === null ? null : String(doc.machineId),
      opsBankLabel: doc.opsBankLabel,
      columns: storedColumns(doc, settings),
    });
  }

  const masterCodesInReach = masters
    .filter((m) => m.isActive && reachedIds.includes(m.branchId))
    .map((m) => m.machineCode);
  const openRows = await atmRegisterEntryRepository.findOpenByCodes([
    ...machineCodes,
    ...masterCodesInReach,
  ]);
  const openByCode = new Map<string, PlanOpenEntry[]>();
  for (const [code, list] of openRows) {
    openByCode.set(
      code,
      list.map((e) => ({
        id: String(e._id),
        branchId: e.branchId === null ? null : String(e.branchId),
        importRow: e.importRow,
      })),
    );
  }

  const forexLabels = await AtmRefLabelModel.find(
    {
      branchId: { $in: reached },
      kind: 'bank',
      name: ATM_NBE_FOREX_LABEL,
      isActive: true,
      isDeleted: false,
    },
    { branchId: 1 },
  )
    .lean<{ branchId: Types.ObjectId }[]>()
    .exec();

  const running = await AtmRegisterImportRunModel.exists({
    state: 'running',
    startedAt: { $gte: new Date(Date.now() - STALE_RUN_MS) },
  }).exec();

  return {
    settings,
    branches,
    masters,
    imported,
    openByCode,
    nbeForexBranchIds: new Set(forexLabels.map((l) => String(l.branchId))),
    runInProgress: running !== null,
    secretStoreAvailable: getSecretStore().available(),
  };
};
