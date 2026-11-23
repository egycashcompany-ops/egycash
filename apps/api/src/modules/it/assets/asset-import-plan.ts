// The asset register's bulk upload («رفع جماعي»), decided — pure: no database, no request. What
// each line of the sheet comes to, what the preview says about it, and the hash that ties the
// write to the preview that was seen.
//
// «في الأصول عايز زرار Bulk Upload للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول للى هيتضاف
// ويوضح لو فى تكرار أو تضارب مع بيانات موجوده وهكذا» (2026-11-16). The same sheets as the branches'
// custody go-live, so the same rules — decided by THAT planner (`planBranchCustody`), not a copy:
// a line is found by its serial and tag against every live device's serial number and printed tag
// (without case, an all-in-one's «S»+MP twin too); found → only what is empty is filled
// («أكمّل الناقص بس»), a value that differs kept and reported; in stock in another branch → moved
// to the chosen one, its place there cleared («يتنقل لفرع الملف»); held, in maintenance or disposed
// elsewhere → not moved, still filled; not found → registered, its serial number the tag (a Dell's
// service tag is its serial) and its printed tag the other label; a second line for one device →
// the first wins. The owner's two answers: the branch is chosen on the screen — the sheet's name
// «عهدة فرع X» only suggests it — and the reviewer may untick any move.
//
// What the upload adds is the preview: the caller's reach (a device they may not see is reported
// and never named; one they may see but not edit or move is reported with the right missing), the
// category of each «النوع», two doubts that leave a new line unticked, and which lines can be
// written at all. The messages are English, like every API message: the screen words each decision
// itself.
import { createHash } from 'node:crypto';
import {
  IT_ASSET_IMPORT_COLUMNS,
  IT_ASSET_IMPORT_DECISIONS,
  type ItAssetImportDecision,
  type ItAssetImportPreviewDto,
  type ItAssetImportRowDto,
  type ItAssetImportWarning,
  type ItAssetStatus,
} from '@ecms/contracts';
import { BusinessRuleError, StaleDocumentError } from '../../../shared/errors';
import {
  CUSTODY_SPEC_FIELDS,
  filledHistoryNote,
  movedHistoryNote,
  planBranchCustody,
  type CustodyAsset,
  type CustodyDecision,
  type CustodyField,
  type CustodySpecs,
  type PlannedNewLine,
} from '../go-live/branch-custody-import';
import {
  INVENTORY_CATEGORIES,
  INVENTORY_CATEGORY_KEYS,
  foldName,
  matchBranches,
  matchCategories,
  type InventoryCategoryKey,
  type LiveBranch,
  type LiveCategory,
} from '../go-live/inventory-import';
import type { AssetImportLine } from './asset-import-sheet';

/** A device of the register as the upload reads it — the planner's view, with its category. */
export interface ImportRegisterAsset extends CustodyAsset {
  categoryId: string;
}

/** A line handed to the go-live's planner: a `new` one of the chosen branch, with its sheet line. */
export interface ImportPlannedLine extends PlannedNewLine {
  row: number;
  line: AssetImportLine;
}

// ── The line's cells against the register's own limits ─────────────────────────────────────────

/** «column B («اسم الصنف»)» — a cell as a refusal names it; M is the second accessories column. */
const columnOf = (index: number): string =>
  `column ${String.fromCharCode('A'.charCodeAt(0) + index)} («${IT_ASSET_IMPORT_COLUMNS[Math.min(index, IT_ASSET_IMPORT_COLUMNS.length - 1)] ?? ''}»)`;

/**
 * «Dell OptiPlex 7090» by Dell is the model «OptiPlex 7090» — the maker's name is the
 * manufacturer field's, as the go-live registered every device. Only a leading copy of it, and
 * never down to nothing.
 */
export const modelWithoutMaker = (model: string | null, maker: string | null): string | null => {
  if (model === null || maker === null) return model;
  const prefix = `${maker} `.toLocaleLowerCase('en');
  if (!model.toLocaleLowerCase('en').startsWith(prefix)) return model;
  const rest = model.slice(prefix.length).trim();
  return rest === '' ? model : rest;
};

/**
 * Each column's limit — the asset schema's (`assetCore`: a name 200, a serial, tag, maker or model
 * 120; a row of the specifications' table and an accessory 200) and the kind's 100, the most a
 * kind may be when its category is chosen (`ItAssetImportKindCategoriesSchema`).
 */
const LIMITS: readonly {
  index: number;
  max: number;
  values: (line: AssetImportLine) => readonly (string | null)[];
}[] = [
  { index: 0, max: 100, values: (line) => [line.kind] },
  { index: 1, max: 200, values: (line) => [line.name] },
  { index: 2, max: 120, values: (line) => [line.serial] },
  { index: 3, max: 120, values: (line) => [line.manufacturer] },
  { index: 4, max: 120, values: (line) => [modelWithoutMaker(line.model, line.manufacturer)] },
  { index: 5, max: 120, values: (line) => [line.tag] },
  ...CUSTODY_SPEC_FIELDS.map((field, offset) => ({
    index: 6 + offset,
    max: 200,
    values: (line: AssetImportLine) => [line.specs[field]],
  })),
  { index: 11, max: 200, values: (line) => line.accessories },
];

/** A value past its column's limit — the register would refuse to keep it — or null. */
export const invalidCellOf = (line: AssetImportLine): string | null => {
  for (const limit of LIMITS) {
    if (limit.values(line).some((value) => value !== null && value.length > limit.max)) {
      return `${columnOf(limit.index)} is longer than ${String(limit.max)} characters`;
    }
  }
  return null;
};

/**
 * Why a line cannot be written whatever it comes to — no kind (a device is filed by it), no name
 * (a device is registered by it), or a value past its limit — or null. Asked BEFORE planning: such
 * a line takes no part in it, so it never claims a serial or a tag that a later, valid line for
 * the same device would then find taken («مكرر») and could not be ticked.
 */
export const invalidLineOf = (line: AssetImportLine): string | null => {
  if (line.kind === null) return `${columnOf(0)} is empty — every line is filed by its kind`;
  if (line.name === null) return `${columnOf(1)} is empty — every line names its device`;
  return invalidCellOf(line);
};

// ── The branch the sheet's name suggests ───────────────────────────────────────────────────────

/** «عهدة فرع طنطا» — the branches' own name for their sheet («عهده» as often as «عهدة»). */
const SHEET_BRANCH = /^عهد[ةه]\s*فرع\s*(.+)$/u;

/**
 * The branch «عهدة فرع X» names, among `branches` (the active ones the caller may register in):
 * one whose Arabic or English name is X, folded as the go-live folds names — else the go-live's
 * own spellings of its branches (`matchBranches`: «وصال» is the Shorouk branch, «6 أكتوبر»
 * October). Null when none, or more than one, answers: a suggestion is never a guess.
 */
export const suggestedBranchOf = (
  sheetName: string,
  branches: readonly LiveBranch[],
): string | null => {
  const named = SHEET_BRANCH.exec(sheetName.trim())?.[1]?.trim();
  if (named === undefined || named === '') return null;
  const active = branches.filter((branch) => branch.status === 'active');
  const folded = foldName(named);
  const exact = active.filter(
    (branch) => foldName(branch.name.ar) === folded || foldName(branch.name.en) === folded,
  );
  if (exact.length > 0) return exact.length === 1 ? (exact[0]?.id ?? null) : null;
  // Which of the go-live's branches X is a spelling of — asked of the go-live's own matcher, with
  // X as the only "branch" it may find — and then which live branch that one is.
  const spelledAs = [
    ...matchBranches([{ id: named, name: { ar: named, en: named }, status: 'active' }]),
  ].flatMap(([name, match]) => (match.kind === 'found' ? [name] : []));
  const live = matchBranches(active);
  const ids = new Set(
    spelledAs.flatMap((name) => {
      const match = live.get(name);
      return match?.kind === 'found' ? [match.branch.id] : [];
    }),
  );
  return ids.size === 1 ? ([...ids][0] ?? null) : null;
};

// ── Each kind's category ──────────────────────────────────────────────────────────────────────

/** The kinds of the file, in the order they first appear, each with how many lines it has. */
export const kindsOf = (lines: readonly AssetImportLine[]): Map<string, number> => {
  const kinds = new Map<string, number>();
  for (const line of lines) {
    if (line.kind !== null) kinds.set(line.kind, (kinds.get(line.kind) ?? 0) + 1);
  }
  return kinds;
};

const NEO_50A = foldName('neo 50a');

/**
 * Which of the go-live's kinds a kind of the sheet is, by the inventory's names for each
 * («كمبيوتر مكتبي» a desktop, «شاشة» a screen, «طابعة» a printer, «هاتف IP» an IP phone,
 * «لابتوب» a laptop) — and a kind naming the Lenovo «neo 50a» an all-in-one.
 */
const inventoryKeyOf = (kind: string): InventoryCategoryKey | null => {
  const folded = foldName(kind);
  if (folded.includes(NEO_50A)) return 'allInOne';
  return (
    INVENTORY_CATEGORY_KEYS.find((key) =>
      INVENTORY_CATEGORIES[key].accept.some((name) => foldName(name) === folded),
    ) ?? null
  );
};

/**
 * The category each kind is filed under: the one chosen on the screen (`chosen`, checked active by
 * the caller), else the live category named as the kind is (its Arabic or English name, folded),
 * else the go-live's category for that kind of device (`matchCategories`). Only an ACTIVE category
 * — a retired one is no place to file a new device. None → null, and the kind's new lines wait
 * for one to be chosen.
 */
export const kindCategoriesFor = (
  kinds: Iterable<string>,
  live: readonly LiveCategory[],
  chosen: ReadonlyMap<string, string>,
): Map<string, string | null> => {
  const active = live.filter((category) => category.isActive);
  const inventory = matchCategories(active);
  const categories = new Map<string, string | null>();
  for (const kind of kinds) {
    const given = chosen.get(kind);
    if (given !== undefined) {
      categories.set(kind, given);
      continue;
    }
    const folded = foldName(kind);
    const named = active.find(
      (category) => foldName(category.name.ar) === folded || foldName(category.name.en) === folded,
    );
    const key = inventoryKeyOf(kind);
    categories.set(kind, named?.id ?? (key === null ? null : (inventory.get(key)?.id ?? null)));
  }
  return categories;
};

// ── Planning ──────────────────────────────────────────────────────────────────────────────────

/** The single-character edits (Levenshtein) from one label to another — a misread is one or two. */
export const editsBetween = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

/** HP's product number for a build («L8T14AV») — every unit of it carries it: no one device's. */
const PRODUCT_NUMBER = /^[A-Z0-9]{5}AV$/u;

type LineEntry =
  | { line: AssetImportLine; outcome: 'noIdentifier' }
  | { line: AssetImportLine; outcome: 'invalid'; message: string }
  | {
      line: AssetImportLine;
      outcome: 'planned';
      decision: CustodyDecision<ImportPlannedLine>;
      /** A `new` line's: the device of the branch it is a character or two off, if any. */
      near: ImportRegisterAsset | null;
    };

export interface AssetImportPlan {
  branchId: string;
  categories: ReadonlyMap<string, string | null>;
  /** The devices an active maintenance order holds — never moved (`planAssetImport`). */
  maintained: ReadonlySet<string>;
  entries: LineEntry[];
}

/** The line as the go-live's planner reads it: a `new` line of the chosen branch. */
const plannedLineOf = (line: AssetImportLine, branchId: string): ImportPlannedLine => {
  const specs: CustodySpecs = {};
  for (const field of CUSTODY_SPEC_FIELDS) {
    const value = line.specs[field];
    if (value !== null) specs[field] = value;
  }
  return {
    action: 'new',
    branch: branchId,
    row: line.row,
    line,
    serial: line.serial,
    tag: line.tag,
    manufacturer: line.manufacturer,
    model: modelWithoutMaker(line.model, line.manufacturer),
    specs,
    accessories: [...line.accessories],
  };
};

/**
 * What each line comes to, in the sheet's order, against the WHOLE register — every non-deleted
 * device of every branch: a serial is unique across it, so a line is matched against all of it. A
 * line with neither serial nor tag («لو مفيش تاجات فخلاص متضيفهمش») and one that cannot be written
 * (`invalidLineOf`: no kind, no name, a value past its limit) take no part: nothing identifies the
 * first, and the second cannot be written whatever it would come to — so neither takes a device
 * from a later line.
 *
 * `maintained` (optional) — the devices an active maintenance order holds, as read for the plan's
 * candidates (`moveCandidateIds`). Such a device is never moved: opening an order leaves it in
 * stock, but the technician has it, and every other change of branch refuses it. It is held
 * elsewhere — still filled where it lacks something.
 */
export const planAssetImport = (input: {
  lines: readonly AssetImportLine[];
  branchId: string;
  register: readonly ImportRegisterAsset[];
  categories: ReadonlyMap<string, string | null>;
  maintained?: ReadonlySet<string>;
}): AssetImportPlan => {
  const maintained = input.maintained ?? new Set<string>();
  const planned: ImportPlannedLine[] = [];
  const early = new Map<AssetImportLine, LineEntry>();
  for (const line of input.lines) {
    if (line.serial === null && line.tag === null) {
      early.set(line, { line, outcome: 'noIdentifier' });
      continue;
    }
    const invalid = invalidLineOf(line);
    if (invalid !== null) {
      early.set(line, { line, outcome: 'invalid', message: invalid });
      continue;
    }
    planned.push(plannedLineOf(line, input.branchId));
  }

  const decisions = planBranchCustody(
    planned,
    input.register,
    new Map([[input.branchId, input.branchId]]),
    { activeMaintenance: maintained },
  );

  // The devices some line of the file names — found, complete, taken twice or among an ambiguous
  // line's candidates. A new line near one of THOSE is not a misread of it: its own line is there.
  const byCode = new Map(input.register.map((asset) => [asset.assetCode, asset]));
  const named = new Set<string>();
  for (const decision of decisions) {
    if (decision.kind === 'found' || decision.kind === 'complete') named.add(decision.asset.id);
    if (decision.kind === 'duplicateTarget' && decision.asset !== null) {
      named.add(decision.asset.id);
    }
    if (decision.kind === 'ambiguous') {
      for (const code of decision.assetCodes) {
        const asset = byCode.get(code);
        if (asset !== undefined) named.add(asset.id);
      }
    }
  }
  const unlisted = input.register.filter(
    (asset) =>
      asset.branchId === input.branchId &&
      asset.serialNumber !== null &&
      asset.serialNumber.trim() !== '' &&
      !named.has(asset.id),
  );

  /**
   * «nearSerial» — a new line one or two characters off the serial of a device of the CHOSEN branch
   * and the same category that no line of the file names: most likely that very device with its
   * label misread, so registering it could count one device twice (the go-live's own review found
   * three such screens). The closest, the register's first on a tie.
   */
  const nearOf = (serialNumber: string, categoryId: string | null): ImportRegisterAsset | null => {
    if (categoryId === null) return null;
    const label = serialNumber.toUpperCase();
    let best: { asset: ImportRegisterAsset; edits: number } | null = null;
    for (const asset of unlisted) {
      if (asset.categoryId !== categoryId) continue;
      const edits = editsBetween(label, (asset.serialNumber ?? '').toUpperCase());
      if (edits < 1 || edits > 2) continue;
      if (best === null || edits < best.edits) best = { asset, edits };
    }
    return best?.asset ?? null;
  };

  const byLine = new Map(decisions.map((decision) => [decision.row.line, decision]));
  const entries = input.lines.map((line): LineEntry => {
    const left = early.get(line);
    if (left !== undefined) return left;
    const decision = byLine.get(line);
    if (decision === undefined) throw new Error(`row ${String(line.row)} was not planned`);
    const near =
      decision.kind === 'create'
        ? nearOf(
            decision.serialNumber,
            line.kind === null ? null : (input.categories.get(line.kind) ?? null),
          )
        : null;
    return { line, outcome: 'planned', decision, near };
  });
  return { branchId: input.branchId, categories: input.categories, maintained, entries };
};

/**
 * The devices the plan would move — the only ones an active maintenance order can change anything
 * for, so the only ones asked about. Made again with the orders found (`maintained`), the plan
 * holds those back and decides everything else exactly as before: the same lines find the same
 * devices.
 */
export const moveCandidateIds = (plan: AssetImportPlan): string[] =>
  plan.entries.flatMap((entry) =>
    entry.outcome === 'planned' && entry.decision.kind === 'found' && entry.decision.move !== null
      ? [entry.decision.asset.id]
      : [],
  );

/**
 * The register's devices the plan touches or points at — the ones whose reach the caller is asked
 * about (`AssetImportScope`), and nothing else.
 */
export const plannedAssetIds = (plan: AssetImportPlan): string[] => {
  const ids = new Set<string>();
  for (const entry of plan.entries) {
    if (entry.outcome !== 'planned') continue;
    const { decision } = entry;
    if (decision.kind === 'found' || decision.kind === 'complete') ids.add(decision.asset.id);
    if (decision.kind === 'duplicateTarget' && decision.asset !== null) ids.add(decision.asset.id);
    if (entry.near !== null) ids.add(entry.near.id);
  }
  return [...ids];
};

// ── The preview's rows ────────────────────────────────────────────────────────────────────────

/**
 * Where the caller's grants reach, for the devices the plan touches: what they may see
 * (`itAsset.view`), fill (`itAsset.edit`) and move (`itAsset.assign`) — each asked of the
 * register under that grant's scope — and whether `itAsset.assign` reaches the chosen branch,
 * where a move lands.
 */
export interface AssetImportScope {
  visible: ReadonlySet<string>;
  editable: ReadonlySet<string>;
  assignable: ReadonlySet<string>;
  assignReachesBranch: boolean;
}

export interface ImportRow {
  dto: ItAssetImportRowDto;
  /** What a ticked row writes: the planner's decision, for a `new` line or a device found. */
  decision: CustodyDecision<ImportPlannedLine> | null;
  /** The plan's own values the hash is taken over — a device the caller may not see included. */
  hashed: readonly unknown[];
}

const assetRef = (asset: CustodyAsset): NonNullable<ItAssetImportRowDto['asset']> => ({
  id: asset.id,
  assetCode: asset.assetCode,
  branchId: asset.branchId,
  status: asset.status as ItAssetStatus,
});

const NOT_VISIBLE = 'the register holds it where itAsset.view does not reach';
const HELD_BY_ORDER = 'an open maintenance order holds it — it is not moved';

/** One line of the preview. */
const rowOf = (entry: LineEntry, plan: AssetImportPlan, scope: AssetImportScope): ImportRow => {
  const { line } = entry;
  const blank: ItAssetImportRowDto = {
    row: line.row,
    kind: line.kind,
    name: line.name,
    serial: line.serial,
    tag: line.tag,
    manufacturer: line.manufacturer,
    model: line.model,
    decision: 'invalid',
    warnings: [],
    asset: null,
    serialNumber: null,
    externalTag: null,
    categoryId: null,
    fills: [],
    kept: [],
    fromBranchId: null,
    firstRow: null,
    near: null,
    message: null,
    selectable: false,
    selected: false,
  };
  const row = (
    over: Partial<ItAssetImportRowDto> & { decision: ItAssetImportDecision },
    internal: {
      assetId?: string | null;
      fills?: readonly string[];
      fromBranchId?: string | null;
      decision?: CustodyDecision<ImportPlannedLine> | null;
    } = {},
  ): ImportRow => {
    const dto: ItAssetImportRowDto = { ...blank, ...over };
    // Ticked when the preview opens only when it can be written and nothing about it is in doubt.
    dto.selected = dto.selectable && dto.warnings.length === 0;
    return {
      dto,
      decision: dto.selectable ? (internal.decision ?? null) : null,
      hashed: [
        dto.row,
        dto.decision,
        internal.assetId ?? dto.asset?.id ?? null,
        internal.fills ?? dto.fills,
        internal.fromBranchId ?? dto.fromBranchId,
        dto.serialNumber,
        dto.externalTag,
        dto.categoryId,
        dto.selectable,
      ],
    };
  };

  if (entry.outcome === 'noIdentifier') return row({ decision: 'noIdentifier' });
  if (entry.outcome === 'invalid') return row({ decision: 'invalid', message: entry.message });

  const { decision } = entry;
  switch (decision.kind) {
    case 'create': {
      const categoryId = line.kind === null ? null : (plan.categories.get(line.kind) ?? null);
      const registered = {
        serialNumber: decision.serialNumber,
        externalTag: decision.externalTag,
        categoryId,
      };
      // A line with no kind or name never gets here: `invalidLineOf` kept it out of the plan.
      if (categoryId === null) return row({ decision: 'unknownKind', ...registered });
      const warnings: ItAssetImportWarning[] = [];
      if (entry.near !== null) warnings.push('nearSerial');
      if (
        line.serial === null &&
        line.tag !== null &&
        PRODUCT_NUMBER.test(line.tag.toUpperCase())
      ) {
        warnings.push('productNumber');
      }
      return row(
        {
          decision: 'new',
          ...registered,
          warnings,
          near:
            entry.near !== null && scope.visible.has(entry.near.id)
              ? { assetCode: entry.near.assetCode, serialNumber: entry.near.serialNumber ?? '' }
              : null,
          selectable: true,
        },
        { decision },
      );
    }
    case 'duplicateTarget': {
      const asset = decision.asset;
      return row(
        {
          decision: 'duplicateInFile',
          asset: asset !== null && scope.visible.has(asset.id) ? assetRef(asset) : null,
          firstRow: decision.first.row,
        },
        { assetId: asset?.id ?? null },
      );
    }
    case 'ambiguous':
      // Its candidates may be beyond the caller's reach: counted, never named.
      return row({
        decision: 'ambiguous',
        message: `${String(decision.assetCodes.length)} devices on the register answer to its serial or tag`,
      });
    case 'complete':
    case 'found': {
      const { asset } = decision;
      const fills = decision.kind === 'found' ? decision.fields : [];
      const move = decision.kind === 'found' ? decision.move : null;
      const notMoved = decision.kind === 'found' ? decision.notMoved : null;
      const fromBranchId = move?.fromBranchId ?? notMoved?.branchId ?? null;
      const internal = { assetId: asset.id, fills, fromBranchId };
      // A device the caller may not see: reported, never named — no code, no branch, no values.
      if (!scope.visible.has(asset.id)) {
        return row({ decision: 'outOfScope', message: NOT_VISIBLE }, internal);
      }
      const seen = {
        asset: assetRef(asset),
        fills: [...fills],
        kept: decision.kept.map((value) => ({
          field: value.field,
          register: value.register,
          sheet: value.sheet,
        })),
        fromBranchId,
      };
      if (decision.kind === 'complete') return row({ decision: 'complete', ...seen }, internal);

      // What the write needs: a fill the asset within `itAsset.edit`; a move the asset within
      // `itAsset.assign` AND the chosen branch reachable by it — custody's own test for a move.
      const missing: string[] = [];
      if (fills.length > 0 && !scope.editable.has(asset.id)) {
        missing.push('itAsset.edit does not reach this asset');
      }
      if (move !== null && !scope.assignable.has(asset.id)) {
        missing.push('itAsset.assign does not reach this asset');
      }
      if (move !== null && !scope.assignReachesBranch) {
        missing.push('itAsset.assign does not reach the branch chosen');
      }
      if (missing.length > 0) {
        return row({ decision: 'outOfScope', ...seen, message: missing.join('; ') }, internal);
      }
      if (move !== null)
        return row({ decision: 'move', ...seen, selectable: true }, { ...internal, decision });
      if (notMoved !== null) {
        // Held, under maintenance (its status, or an open order that left it in stock) or disposed
        // there: custody moves it, never this upload. Written only for what it lacks — with
        // nothing to fill there is nothing to write.
        return row(
          {
            decision: 'heldElsewhere',
            ...seen,
            message: plan.maintained.has(asset.id) ? HELD_BY_ORDER : null,
            selectable: fills.length > 0,
          },
          { ...internal, decision },
        );
      }
      return row({ decision: 'fill', ...seen, selectable: true }, { ...internal, decision });
    }
    default:
      // Only `new` lines are planned: nothing is skipped by a review, nothing was found by one.
      throw new Error(`row ${String(line.row)}: unexpected ${decision.kind}`);
  }
};

/** Every line of the preview, in the sheet's order. */
export const importRowsOf = (plan: AssetImportPlan, scope: AssetImportScope): ImportRow[] =>
  plan.entries.map((entry) => rowOf(entry, plan, scope));

/** How many lines each decision has — every decision named, the empty ones as 0. */
export const countsOf = (rows: readonly ImportRow[]): Record<ItAssetImportDecision, number> => {
  const counts = Object.fromEntries(
    IT_ASSET_IMPORT_DECISIONS.map((decision) => [decision, 0]),
  ) as Record<ItAssetImportDecision, number>;
  for (const { dto } of rows) counts[dto.decision] += 1;
  return counts;
};

/** sha256, hex — of the uploaded bytes, and of the plan. */
export const sha256Of = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

/**
 * The plan the preview showed, as one hash: every row's decision, its device, what it fills, where
 * it moves from, what it registers, its category and whether it can be written — and the branch.
 * Taken again at apply by this same function over a plan made again against the live register: a
 * device registered, moved, filled or put out of reach in between changes it, and the write is
 * refused rather than writing something the reviewer did not see.
 */
export const planHashOf = (branchId: string, rows: readonly ImportRow[]): string =>
  sha256Of(JSON.stringify([branchId, rows.map((row) => row.hashed)]));

export const assetImportPreview = (input: {
  fileSha256: string;
  sheetName: string;
  suggestedBranchId: string | null;
  plan: AssetImportPlan;
  lines: readonly AssetImportLine[];
  rows: readonly ImportRow[];
}): ItAssetImportPreviewDto => ({
  fileSha256: input.fileSha256,
  planHash: planHashOf(input.plan.branchId, input.rows),
  sheetName: input.sheetName,
  branchId: input.plan.branchId,
  suggestedBranchId: input.suggestedBranchId,
  kinds: [...kindsOf(input.lines)].map(([kind, rows]) => ({
    kind,
    categoryId: input.plan.categories.get(kind) ?? null,
    rows,
  })),
  rows: input.rows.map((row) => row.dto),
  counts: countsOf(input.rows),
});

// ── The words the register keeps ──────────────────────────────────────────────────────────────

/** The longest upload name the notes repeat — a name, not a paragraph. */
const FILE_NAME_MAX = 120;

/** The upload's own name, as the notes give it: whitespace collapsed, trimmed, cut to a sane length. */
export const importFileName = (raw: string): string => {
  const name = raw.replace(/\s+/gu, ' ').trim();
  return name.length <= FILE_NAME_MAX ? name : `${name.slice(0, FILE_NAME_MAX - 1).trimEnd()}…`;
};

/**
 * What the asset and its history say of the upload — the go-live's words with the upload's source:
 * a new asset's notes «من ملف «عهدة فرع طنطا.xlsx» — رفع جماعي»; a fill's entry «أُضيفت من ملف «…» —
 * رفع جماعي: المعالج، المشتملات»; a move's «نُقل إلى فرع طنطا حسب ملف «…» — رفع جماعي» (and the place
 * it left, when it had one). `branchName` is the chosen branch's — «فرع» is the sentence's own word.
 */
export const importWords = (fileName: string, branchName: string) => {
  const name = importFileName(fileName);
  const branch = branchName.trim().replace(/^فرع\s+/u, '');
  return {
    notes: `من ملف «${name}» — رفع جماعي`,
    updated: (fields: readonly CustodyField[]): string =>
      filledHistoryNote(`من ملف «${name}» — رفع جماعي`, fields),
    transferred: (location: string | null): string =>
      movedHistoryNote(branch, `ملف «${name}» — رفع جماعي`, location),
  };
};

/**
 * The rows an apply writes — refused, nothing written, unless it is the preview that was seen:
 * the same file (409), the same plan made again against the live register (409 — «the register
 * changed since the preview»), and every row asked for a line of the file that can be written
 * (422). In the sheet's order, each once.
 */
export const rowsToWrite = (
  rows: readonly ImportRow[],
  seen: { fileSha256: string; planHash: string },
  now: { fileSha256: string; planHash: string },
  wanted: readonly number[],
): ImportRow[] => {
  if (seen.fileSha256 !== now.fileSha256) {
    throw new StaleDocumentError('the file is not the one previewed — preview it again');
  }
  if (seen.planHash !== now.planHash) {
    throw new StaleDocumentError('the register changed since the preview — preview again');
  }
  const byRow = new Map(rows.map((row) => [row.dto.row, row]));
  const asked = [...new Set(wanted)];
  const absent = asked.filter((row) => !byRow.has(row));
  if (absent.length > 0) {
    throw new BusinessRuleError(`row(s) ${absent.join(', ')} are not lines of the file`);
  }
  const fixed = asked.filter((row) => byRow.get(row)?.dto.selectable !== true);
  if (fixed.length > 0) {
    throw new BusinessRuleError(`row(s) ${fixed.join(', ')} cannot be written`);
  }
  const chosen = new Set(asked);
  return rows.filter((row) => chosen.has(row.dto.row));
};
