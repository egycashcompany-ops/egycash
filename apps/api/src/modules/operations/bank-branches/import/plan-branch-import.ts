// What a bank's branch sheet comes to against what the bank and «المناطق» hold (Round 29) — pure,
// for its spec. The rules are the owner's (packages/contracts/src/modules/operations-branch-import.ts
// has them in his words); how they meet, precisely:
//
// ROWS, in the sheet's order. A row with no name, or whose name cell holds a date, is a problem.
// Its name is matched on `operationsBranchNameKey` (tidied, Latin without case): a second row of the
// same name is a problem (`duplicateName`); a name two held branches share is a problem
// (`ambiguousName`); one held branch is that branch (update or unchanged); none is a new branch,
// which needs a code (`noCode`).
//
// AREAS. The sheet's Arabic and English area (an only area in Latin letters stands for both; an
// English cell in Arabic letters is the Arabic name, never an English one). It is
// the area «المناطق» holds whose Arabic name folds (`foldOperationsAreaName`) to the sheet's, else
// whose English name equals the sheet's without case — written in that area's own spelling, its
// empty English name filled from the sheet. Else it is a new area, created once, and later rows
// naming it find it as they would a held one. It goes into both «منطقة العمليات» and «منطقة
// الحسابات»; a row with no area leaves a held branch's areas as they are.
//
// CODES — «ضيف رقم بعد الكود». The codes of the bank's branches the sheet does not name are taken.
// Pass 1: a held branch that already has the sheet's code (or the sheet gives it none) keeps it;
// then one that has the sheet's code with a suffix («116-3» for «116») keeps that, while «116» is
// taken. Pass 2, in the sheet's order: every other row takes the first of «code», «code-2»,
// «code-3», … not taken yet. So the first row of a code keeps it, a held branch keeps its own, a
// branch the sheet does not name is never touched, and a code a held branch is leaving is free for
// another row (that edit is written through a code of its own first — `viaTemp`: two codes can
// swap). Every code the import gives is its row's code or that code with a suffix, so the sheet
// read again after its import plans nothing new (its spec pins it).
import {
  OPERATIONS_BRANCH_IMPORT_FIELDS,
  foldOperationsAreaName,
  operationsBranchNameKey,
  suffixedOperationsBranchCode,
  tidyOperationsBranchName,
  type OperationsBranchImportCountsDto,
  type OperationsBranchImportFilledAreaDto,
  type OperationsBranchImportNewAreaDto,
  type OperationsBranchImportProblem,
  type OperationsBranchImportRowDto,
  type OperationsBranchImportValuesDto,
} from '@ecms/contracts';
import { type BranchSheetRow } from './read-branch-sheet';

/** A branch of the bank as it is held (every live one — stopped ones too). */
export interface HeldBranch {
  id: string;
  name: string;
  code: string;
  opsAreaName: string | null;
  financeAreaName: string | null;
  location: {
    addressLine: string | null;
    coordinates: { lat: number; lng: number } | null;
  } | null;
  isActive: boolean;
}

/** An area «المناطق» holds (every live one — stopped ones too: the name is unique among them). */
export interface HeldArea {
  id: string;
  name: string;
  nameEn: string | null;
}

export interface BranchCreate {
  row: number;
  name: string;
  code: string;
  areaName: string | null;
  address: string | null;
}

export interface BranchUpdate {
  row: number;
  branchId: string;
  /**
   * The new code is one another branch of the bank holds NOW, leaving it in this same import (a
   * code freed, two codes swapped): the write passes through a code of its own first, so no two
   * writes meet on the bank's unique code.
   */
  viaTemp: boolean;
  set: {
    code?: string;
    opsAreaName?: string;
    financeAreaName?: string;
    location?: {
      addressLine: string;
      coordinates: { lat: number; lng: number } | null;
    };
  };
}

export interface AreaCreate {
  name: string;
  nameEn: string | null;
}

export interface BranchImportPlan {
  rows: OperationsBranchImportRowDto[];
  newAreas: OperationsBranchImportNewAreaDto[];
  filledAreas: OperationsBranchImportFilledAreaDto[];
  counts: OperationsBranchImportCountsDto;
  /** The writes, in the order they are made: areas, then branches. */
  areaCreates: AreaCreate[];
  branchCreates: BranchCreate[];
  branchUpdates: BranchUpdate[];
}

/** An area name as matched in English: tidied, without case. */
const englishKey = (text: string): string => tidyOperationsBranchName(text).toLocaleLowerCase('en');

const ARABIC_LETTER = /\p{Script=Arabic}/u;
const LATIN_LETTER = /[A-Za-z]/u;

/** The row's area as the import writes it, before it is matched. */
const sheetAreaOf = (
  row: BranchSheetRow,
): { ar: string; en: string | null; latinOnly: boolean } | null => {
  let { areaAr, areaEn } = row;
  // An English cell in Arabic letters is no English name («فى خانة الانجليزى اكتبها انجليزى»): it
  // is the Arabic one where the sheet gives none, and is dropped beside one it gives.
  if (areaEn !== null && ARABIC_LETTER.test(areaEn) && !LATIN_LETTER.test(areaEn)) {
    areaAr ??= areaEn;
    areaEn = null;
  }
  if (areaAr === null && areaEn === null) return null;
  // Only the English: it stands for the Arabic too.
  if (areaAr === null) return { ar: areaEn as string, en: areaEn, latinOnly: true };
  // An «المنطقة» in Latin letters, with no English beside it: it is the English name.
  if (areaEn === null && !ARABIC_LETTER.test(areaAr) && LATIN_LETTER.test(areaAr)) {
    return { ar: areaAr, en: areaAr, latinOnly: true };
  }
  return { ar: areaAr, en: areaEn, latinOnly: false };
};

interface AreaEntry {
  /** The held area's id; null for one this import creates. */
  id: string | null;
  name: string;
  nameEn: string | null;
  latinOnly: boolean;
  rows: number;
}

/** The areas, held and planned, and how a sheet's area finds one. */
const areaBook = (held: readonly HeldArea[]) => {
  const entries: AreaEntry[] = held.map((area) => ({
    id: area.id,
    name: area.name,
    nameEn: area.nameEn,
    latinOnly: false,
    rows: 0,
  }));
  const byFold = new Map<string, AreaEntry>();
  const byEnglish = new Map<string, AreaEntry>();
  const index = (entry: AreaEntry): void => {
    const folded = foldOperationsAreaName(entry.name);
    if (folded !== '' && !byFold.has(folded)) byFold.set(folded, entry);
    if (entry.nameEn !== null) {
      const key = englishKey(entry.nameEn);
      if (key !== '' && !byEnglish.has(key)) byEnglish.set(key, entry);
    }
  };
  entries.forEach(index);
  const filled = new Map<string, OperationsBranchImportFilledAreaDto>();
  const created: AreaEntry[] = [];

  /** The area a row writes: found, filled or created. */
  const resolve = (area: { ar: string; en: string | null; latinOnly: boolean }) => {
    const folded = foldOperationsAreaName(area.ar);
    const found =
      (folded === '' ? undefined : byFold.get(folded)) ??
      (area.en === null ? undefined : byEnglish.get(englishKey(area.en)));
    if (found !== undefined) {
      found.rows += 1;
      if (found.nameEn === null && area.en !== null) {
        found.nameEn = area.en;
        index(found);
        if (found.id !== null) {
          filled.set(found.id, { id: found.id, name: found.name, nameEn: area.en });
        }
      }
      return { name: found.name, isNew: found.id === null };
    }
    const entry: AreaEntry = {
      id: null,
      name: area.ar,
      nameEn: area.en,
      latinOnly: area.latinOnly,
      rows: 1,
    };
    entries.push(entry);
    created.push(entry);
    index(entry);
    return { name: entry.name, isNew: true };
  };
  return { resolve, filled, created };
};

interface Target {
  /** Index into the row DTOs. */
  at: number;
  sheet: BranchSheetRow;
  held: HeldBranch | null;
  areaName: string | null;
  /** The base the code is taken from: the sheet's, or the held branch's when the sheet has none. */
  base: string;
  code: string | null;
}

/** `code` is `base`, or `base` with a suffix the import gives («116-2», «116-3», …). */
const isOfBase = (code: string, base: string): boolean =>
  code === base ||
  (code.startsWith(`${base}-`) && /^(?:[2-9]|[1-9]\d+)$/u.test(code.slice(base.length + 1)));

const addressOf = (branch: HeldBranch): string | null => branch.location?.addressLine ?? null;

const valuesOf = (branch: HeldBranch): OperationsBranchImportValuesDto => ({
  code: branch.code,
  opsAreaName: branch.opsAreaName,
  financeAreaName: branch.financeAreaName,
  address: addressOf(branch),
});

export const planBranchImport = (
  sheetRows: readonly BranchSheetRow[],
  branches: readonly HeldBranch[],
  areas: readonly HeldArea[],
): BranchImportPlan => {
  const heldByName = new Map<string, HeldBranch[]>();
  for (const branch of branches) {
    const key = operationsBranchNameKey(branch.name);
    heldByName.set(key, [...(heldByName.get(key) ?? []), branch]);
  }
  const book = areaBook(areas);

  const rows: OperationsBranchImportRowDto[] = [];
  const targets: Target[] = [];
  const seenNames = new Set<string>();
  for (const sheet of sheetRows) {
    const area = sheetAreaOf(sheet);
    const dto: OperationsBranchImportRowDto = {
      row: sheet.row,
      name: sheet.name,
      sheetCode: sheet.code,
      sheetArea: { ar: sheet.areaAr, en: sheet.areaEn },
      sheetAddress: sheet.address,
      outcome: 'problem',
      problem: null,
      branchId: null,
      inactive: false,
      before: null,
      after: null,
      changes: [],
      codeSuffixed: false,
      areaLatinOnly: area?.latinOnly ?? false,
      areaIsNew: false,
    };
    rows.push(dto);
    const refuse = (problem: OperationsBranchImportProblem): void => {
      dto.problem = problem;
    };
    if (sheet.nameIsDate) {
      refuse('nameIsDate');
      continue;
    }
    if (sheet.name === null) {
      refuse('noName');
      continue;
    }
    const key = operationsBranchNameKey(sheet.name);
    if (seenNames.has(key)) {
      refuse('duplicateName');
      continue;
    }
    seenNames.add(key);
    const held = heldByName.get(key) ?? [];
    if (held.length > 1) {
      refuse('ambiguousName');
      continue;
    }
    const branch = held[0] ?? null;
    if (branch === null && sheet.code === null) {
      refuse('noCode');
      continue;
    }
    const resolved = area === null ? null : book.resolve(area);
    dto.areaIsNew = resolved?.isNew ?? false;
    targets.push({
      at: rows.length - 1,
      sheet,
      held: branch,
      areaName: resolved?.name ?? null,
      base: sheet.code ?? (branch as HeldBranch).code,
      code: null,
    });
  }

  // ── Codes ────────────────────────────────────────────────────────────────────────────────────
  // Taken from the start: the codes of the bank's branches the sheet does not name.
  const named = new Set(
    targets.flatMap((target) => (target.held === null ? [] : [target.held.id])),
  );
  const taken = new Set(
    branches.filter((branch) => !named.has(branch.id)).map((branch) => branch.code),
  );
  // Pass 1 — a held branch that already has the sheet's code keeps it…
  for (const target of targets) {
    if (target.held !== null && target.held.code === target.base) {
      target.code = target.base;
      taken.add(target.base);
    }
  }
  // …and one with the sheet's code with a suffix keeps that while the code itself is taken (were it
  // free, the sheet's own code is the branch's — pass 2 gives it).
  for (const target of targets) {
    if (target.held === null || target.code !== null || !taken.has(target.base)) continue;
    if (isOfBase(target.held.code, target.base)) {
      target.code = target.held.code;
      taken.add(target.held.code);
    }
  }
  // Pass 2 — every other row, in the sheet's order: the first free of «code», «code-2», … A code a
  // held branch of pass 2 has now is free for the others: that branch is leaving it.
  for (const target of targets) {
    if (target.code !== null) continue;
    let code = target.base;
    for (let n = 2; taken.has(code); n += 1) code = suffixedOperationsBranchCode(target.base, n);
    target.code = code;
    taken.add(code);
  }
  const holderOf = new Map(branches.map((branch) => [branch.code, branch.id]));

  // ── Outcomes and writes ──────────────────────────────────────────────────────────────────────
  const branchCreates: BranchCreate[] = [];
  const branchUpdates: BranchUpdate[] = [];
  for (const target of targets) {
    const dto = rows[target.at] as OperationsBranchImportRowDto;
    const code = target.code as string;
    dto.codeSuffixed = target.sheet.code !== null && code !== target.sheet.code;
    if (target.held === null) {
      dto.outcome = 'new';
      dto.after = {
        code,
        opsAreaName: target.areaName,
        financeAreaName: target.areaName,
        address: target.sheet.address,
      };
      branchCreates.push({
        row: target.sheet.row,
        name: target.sheet.name as string,
        code,
        areaName: target.areaName,
        address: target.sheet.address,
      });
      continue;
    }
    const held = target.held;
    const before = valuesOf(held);
    const after: OperationsBranchImportValuesDto = {
      code,
      // The sheet's empty area never wipes what is held.
      opsAreaName: target.areaName ?? held.opsAreaName,
      financeAreaName: target.areaName ?? held.financeAreaName,
      // An address only where the branch has none.
      address: before.address ?? target.sheet.address,
    };
    const changes = OPERATIONS_BRANCH_IMPORT_FIELDS.filter(
      (field) => before[field] !== after[field],
    );
    dto.name = held.name;
    dto.branchId = held.id;
    dto.inactive = !held.isActive;
    dto.before = before;
    dto.after = after;
    dto.changes = changes;
    dto.outcome = changes.length > 0 ? 'update' : 'unchanged';
    if (changes.length === 0) continue;
    const set: BranchUpdate['set'] = {};
    if (changes.includes('code')) set.code = code;
    if (changes.includes('opsAreaName')) set.opsAreaName = after.opsAreaName as string;
    if (changes.includes('financeAreaName')) set.financeAreaName = after.financeAreaName as string;
    if (changes.includes('address')) {
      set.location = {
        addressLine: after.address as string,
        coordinates: held.location?.coordinates ?? null,
      };
    }
    const holder = set.code === undefined ? undefined : holderOf.get(set.code);
    branchUpdates.push({
      row: target.sheet.row,
      branchId: held.id,
      viaTemp: holder !== undefined && holder !== held.id,
      set,
    });
  }

  const count = (outcome: OperationsBranchImportRowDto['outcome']): number =>
    rows.filter((row) => row.outcome === outcome).length;
  const newAreas = book.created.map((entry) => ({
    name: entry.name,
    nameEn: entry.nameEn,
    rows: entry.rows,
    latinOnly: entry.latinOnly,
  }));
  const filledAreas = [...book.filled.values()];
  return {
    rows,
    newAreas,
    filledAreas,
    counts: {
      rows: rows.length,
      new: count('new'),
      update: count('update'),
      unchanged: count('unchanged'),
      problem: count('problem'),
      suffixed: rows.filter((row) => row.codeSuffixed).length,
      areasNew: newAreas.length,
      areasFilled: filledAreas.length,
    },
    areaCreates: newAreas.map(({ name, nameEn }) => ({ name, nameEn })),
    branchCreates,
    branchUpdates,
  };
};
