// The branches' custody — four sheets, one per branch — as the go-live reads them. «هبعتلك عهده
// الأفرع وعايزك تضيفهم مره واحده كل فرع فى فرعه فى الـ IT شوف الأول لو فى مشاكل .. أو تكرار جوا
// الفايلات .. أو بين البيانات اللى فى الفايلات دى واللى موجود أصلاً على النظام».
//
// The sheets were read and reviewed against the register BEFORE anything was written, and the
// owner decided what each kind of line becomes:
//   · a device the register holds under ANOTHER branch: «انقلهم لفرع الملف» — moved to the sheet's;
//   · a repeated line: two lines are two devices when their tags differ; «لو مفيش تاجات فخلاص
//     متضيفهمش» — a line with neither serial nor tag, or repeating another line's serial, is left
//     out (`skip`);
//   · the two Tanta printers whose serials differ by one character are «طابعتين مختلفتين» — both
//     are registered;
//   · a line whose serial the October inventory found TWICE — it gave the serial to one device and
//     registered the other without it, its notes naming the serial — is left out (`skip`) and
//     reported: which of the two the sheet means is not known until somebody reads the label;
//   · a device the register already holds: «أكمّل الناقص بس» — only what is EMPTY is filled; a
//     value already on the register is kept, and reported where the sheet says otherwise.
// What came out of that review is `assets/it-go-live/branch-custody-2026-11.json`, and this file is
// the part of the go-live that is pure: the file's shape, the device each line is found on, what is
// filled, moved or registered, and the words the asset and its history say it with. The writing is
// `branch-custody.ts`.
//
// NOBODY IS IN THE FILE. The sheets say whose desk a device is on; none of it travels — a line is
// its sheet and row, the device's identifiers, kind and specifications, and what the review decided.
import { z } from 'zod';
import { ItAssetAccessoriesSchema } from '@ecms/contracts';
import type { ItAssetSpecsSub } from '../assets/asset.model';
import { copySpecs } from './aio-october-import';
import { sameSpec } from './asset-specs-import';
import {
  INVENTORY_BRANCHES,
  INVENTORY_CATEGORY_KEYS,
  matchCategories,
  type InventoryBranch,
  type InventoryCategoryKey,
  type LiveCategory,
} from './inventory-import';

/** The rows of the acknowledgment's table the sheets fill — and only these. */
export const CUSTODY_SPEC_FIELDS = [
  'processor',
  'memory',
  'systemType',
  'storage',
  'displayAdapter',
] as const;
export type CustodySpecField = (typeof CUSTODY_SPEC_FIELDS)[number];

/**
 * Everything this step may fill on a device the register holds, by the names its history and its
 * audit rows give them — `specs.processor` as the asset-specs step already writes it.
 */
export const CUSTODY_FIELDS = [
  ...CUSTODY_SPEC_FIELDS.map((field) => `specs.${field}` as const),
  'accessories',
  'externalTag',
  'manufacturer',
  'model',
] as const;
export type CustodyField = (typeof CUSTODY_FIELDS)[number];

/** Each field by the label the asset screen gives it (`it.assets.specs.*`, `it.assets.fields.*`). */
export const CUSTODY_FIELD_LABELS: Readonly<Record<CustodyField, string>> = {
  'specs.processor': 'المعالج',
  'specs.memory': 'إجمالي ذاكرة النظام',
  'specs.systemType': 'نوع النظام',
  'specs.storage': 'إجمالي سعة الأقراص الصلبة',
  'specs.displayAdapter': 'نوع محوّل العرض',
  accessories: 'المشتملات',
  externalTag: 'الملصق المطبوع',
  manufacturer: 'الشركة المصنِّعة',
  model: 'الموديل',
};

const text = z.string().trim().min(1);
/** The register's own limit for a serial or a printed tag. */
const identifier = text.max(120);
/** The register's own limit for one row of the table. */
const specValue = text.max(200);

export const CustodySpecsSchema = z
  .object({
    processor: specValue.optional(),
    memory: specValue.optional(),
    systemType: specValue.optional(),
    storage: specValue.optional(),
    displayAdapter: specValue.optional(),
  })
  .strict();
export type CustodySpecs = z.infer<typeof CustodySpecsSchema>;

const rowBase = {
  /** «عهدة فرع بورسعيد» — the sheet the line is on; with `row`, what the report names it by. */
  sheet: text.max(100),
  /** The sheet's own row number — its first is the header. */
  row: z.number().int().min(2),
  branch: z.enum(INVENTORY_BRANCHES),
  /** The sheet's word for the device — «كمبيوتر مكتبي», «شاشة», «هاتف IP», «طابعة», «لابتوب». */
  kind: text.max(100),
  serial: identifier.nullable(),
  /** The tag column: a Dell's service tag, which the register keeps as its serial. */
  tag: identifier.nullable(),
};

/** What the sheet adds to a device the register holds. */
const additions = {
  specs: CustodySpecsSchema,
  accessories: ItAssetAccessoriesSchema,
};

export const CustodyFillRowSchema = z
  .object({
    ...rowBase,
    action: z.literal('fill'),
    /** The register's serial the review found the line under — the line's serial or its tag. */
    registerSerial: identifier,
    ...additions,
  })
  .strict();

export const CustodyMoveRowSchema = z
  .object({
    ...rowBase,
    action: z.literal('move'),
    registerSerial: identifier,
    /** «انقلهم لفرع الملف» — the branch the register held it under when the sheets were reviewed. */
    fromBranch: z.enum(INVENTORY_BRANCHES),
    ...additions,
  })
  .strict();

export const CustodyNewRowSchema = z
  .object({
    ...rowBase,
    action: z.literal('new'),
    category: z.enum(INVENTORY_CATEGORY_KEYS),
    name: text.max(200),
    manufacturer: text.max(120).nullable(),
    model: text.max(120).nullable(),
    /** What the sheet says that is no field of the register — «رقم الهاتف في الملف: 2007». */
    note: text.max(500).nullable(),
    ...additions,
  })
  .strict();

/**
 * Why the review left a line out:
 *   · `repeatedSerial` — the line repeats another line's serial;
 *   · `noSerialOrTag` — nothing identifies it: «لو مفيش تاجات فخلاص متضيفهمش»;
 *   · `serialDisputed` — the October inventory found its serial TWICE: it gave the serial to one
 *     device and registered the other without it, its notes naming the serial. Which of the two
 *     the sheet means is not known until somebody reads the label — the sheet's may be the
 *     serial-less one, wherever it is — so nothing is moved or filled on a guess: the line is
 *     left out and reported;
 *   · `nearSerial` — its label is a character or two off the serial of a device the register
 *     holds in the same branch that the sheet does not otherwise list: most likely that very
 *     device with its label misread, so registering it as new could count one device twice. The
 *     owner reads the label;
 *   · `notASerial` — its only label is not a serial at all: HP's product number for the model
 *     («…AV»), which every unit of that build carries, so it identifies no one device. The owner
 *     reads the S/N label.
 */
export const CUSTODY_SKIP_REASONS = [
  'repeatedSerial',
  'noSerialOrTag',
  'serialDisputed',
  'nearSerial',
  'notASerial',
] as const;

export const CustodySkipRowSchema = z
  .object({
    ...rowBase,
    action: z.literal('skip'),
    reason: z.enum(CUSTODY_SKIP_REASONS),
  })
  .strict();

export const CustodyRowSchema = z.discriminatedUnion('action', [
  CustodyFillRowSchema,
  CustodyMoveRowSchema,
  CustodyNewRowSchema,
  CustodySkipRowSchema,
]);
export type CustodyRow = z.infer<typeof CustodyRowSchema>;
export type CustodyFillRow = z.infer<typeof CustodyFillRowSchema>;
export type CustodyMoveRow = z.infer<typeof CustodyMoveRowSchema>;
export type CustodyNewRow = z.infer<typeof CustodyNewRowSchema>;
export type CustodySkipRow = z.infer<typeof CustodySkipRowSchema>;
/** A line something is done for — every line the review did not leave out. */
export type CustodyLiveRow = Exclude<CustodyRow, CustodySkipRow>;

/** Two spellings of one serial or tag — the register compares them without case. */
const sameIdentifier = (a: string, b: string): boolean =>
  a.trim().toUpperCase() === b.trim().toUpperCase();

export const BranchCustodyFileSchema = z
  .object({
    source: text,
    devices: z.array(CustodyRowSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const lines = new Set<string>();
    file.devices.forEach((row, index) => {
      const issue = (field: string, message: string): void => {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['devices', index, field], message });
      };
      const line = `${row.sheet} ${row.row}`;
      if (lines.has(line)) issue('row', `${line} appears twice`);
      lines.add(line);
      // The notes name the sheet as the owner's file for that branch — so it must be that one.
      if (row.sheet !== `عهدة فرع ${row.branch}`) {
        issue('sheet', `${line} is not ${row.branch}'s sheet`);
      }
      if (row.action === 'skip') {
        if (row.reason === 'noSerialOrTag' && (row.serial !== null || row.tag !== null)) {
          issue('reason', `${line} has an identifier`);
        }
        // A disputed serial is reported for the owner to read off the labels — so it is there.
        if (row.reason === 'serialDisputed' && row.serial === null && row.tag === null) {
          issue('reason', `${line} disputes no serial`);
        }
        // A label read near another device's serial is the one the owner is to read again.
        if (row.reason === 'nearSerial' && row.serial === null && row.tag === null) {
          issue('reason', `${line} carries no label near another serial`);
        }
        // The product number sits in the tag column, and the line has no serial — had it one,
        // that would identify the device and the line would not be left out for its tag.
        if (row.reason === 'notASerial' && (row.serial !== null || row.tag === null)) {
          issue('reason', `${line} is not a product number in place of a serial`);
        }
        return;
      }
      // «لو مفيش تاجات فخلاص متضيفهمش» — a line nothing identifies is never written.
      if (row.serial === null && row.tag === null) issue('serial', `${line} has no serial or tag`);
      if (row.action === 'new') return;
      if (
        ![row.serial, row.tag].some((id) => id !== null && sameIdentifier(id, row.registerSerial))
      ) {
        issue('registerSerial', `${line}: ${row.registerSerial} is neither its serial nor its tag`);
      }
      if (row.action === 'move' && row.fromBranch === row.branch) {
        issue('fromBranch', `${line} is moved to the branch it is in`);
      }
    });
  });
export type BranchCustodyFile = z.infer<typeof BranchCustodyFileSchema>;

export const parseBranchCustody = (json: unknown): BranchCustodyFile =>
  BranchCustodyFileSchema.parse(json);

/** The line's serial and tag, as written, the ones it has. */
const identifiersOf = (row: Pick<CustodyRow, 'serial' | 'tag'>): string[] =>
  [row.tag, row.serial].filter((id): id is string => id !== null);

/**
 * The serial a NEW asset is registered under: the tag where the line has one, its serial
 * otherwise — the register's own convention since the October inventory, where a Dell's service
 * tag IS its serial number.
 */
export const newSerialOf = (row: Pick<CustodyNewRow, 'serial' | 'tag'>): string => {
  const serial = row.tag ?? row.serial;
  // The file's schema refuses such a line; this only keeps the type honest.
  if (serial === null) {
    throw new Error('a line with neither a serial nor a tag is never registered');
  }
  return serial;
};

/**
 * The line's OTHER identifier — its serial when the asset's serial number is its tag, its tag when
 * it is its serial — or null when there is none, when the two are one, or when the line names
 * neither as the asset's serial (then which one is "other" is a guess, and nothing is guessed).
 * It is the asset's `externalTag`: «ملصق أو باركود مطبوع بالفعل على الجهاز» — a Dell screen's
 * «CN-0…» label beside its service tag.
 */
export const otherIdentifierOf = (
  row: Pick<CustodyRow, 'serial' | 'tag'>,
  serialNumber: string | null,
): string | null => {
  if (serialNumber === null) return null;
  const ids = identifiersOf(row);
  if (!ids.some((id) => sameIdentifier(id, serialNumber))) return null;
  return ids.find((id) => !sameIdentifier(id, serialNumber)) ?? null;
};

/** What the plan needs to know of a device on the register. */
export interface CustodyAsset {
  id: string;
  assetCode: string;
  serialNumber: string | null;
  externalTag: string | null;
  branchId: string;
  status: string;
  currentAssignmentId: string | null;
  specs?: Partial<ItAssetSpecsSub> | null;
  accessories?: readonly string[] | null;
  manufacturer: string | null;
  model: string | null;
  /** A place inside its branch — «مخزن IT» — which a move leaves behind. */
  location: string | null;
}

/** What is filled on a device — only fields it has no value for. */
export interface CustodyFill {
  specs?: Partial<Record<CustodySpecField, string>>;
  accessories?: string[];
  externalTag?: string;
  manufacturer?: string;
  model?: string;
}

/** A value already on the register that the sheet disagrees with — kept, and reported. */
export interface KeptCustodyValue {
  field: CustodyField;
  register: string;
  /** What the sheet says. */
  sheet: string;
}

export type CustodyDecision =
  | { kind: 'skipped'; row: CustodySkipRow; reason: CustodySkipRow['reason'] }
  /** Two devices or more answer to the line's identifiers: neither is guessed at. */
  | { kind: 'ambiguous'; row: CustodyLiveRow; assetCodes: string[] }
  /** A line the review found on the register that is no longer there — nothing is registered. */
  | { kind: 'notFound'; row: CustodyFillRow | CustodyMoveRow }
  | {
      kind: 'create';
      row: CustodyNewRow;
      serialNumber: string;
      externalTag: string | null;
      branchId: string;
    }
  /** A second line for a device an earlier line already took — the first wins. */
  | {
      kind: 'duplicateTarget';
      row: CustodyLiveRow;
      asset: CustodyAsset | null;
      first: CustodyLiveRow;
    }
  | {
      kind: 'found';
      row: CustodyLiveRow;
      asset: CustodyAsset;
      fill: CustodyFill;
      /** The fields `fill` fills, in the order the history names them. */
      fields: CustodyField[];
      kept: KeptCustodyValue[];
      /**
       * «كل فرع فى فرعه» — in stock elsewhere: moved to the sheet's branch. `location` is the place
       * the device had in the branch it leaves — the head office's «مخزن IT» is no place in Tanta —
       * which the move clears; null when it had none.
       */
      move: { fromBranchId: string; toBranchId: string; location: string | null } | null;
      /** Held, under maintenance or disposed elsewhere: custody moves it, never this step. */
      notMoved: { status: string; branchId: string } | null;
      /** A `new` line the register holds since the review: treated as found, and said so. */
      alreadyRegistered: boolean;
    }
  /** Found, in its branch, with nothing to fill — left exactly as it is. */
  | {
      kind: 'complete';
      row: CustodyLiveRow;
      asset: CustodyAsset;
      kept: KeptCustodyValue[];
      alreadyRegistered: boolean;
    };

const typed = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** One list of accessories as another — order, case and spacing aside. */
const sameAccessories = (a: readonly string[], b: readonly string[]): boolean => {
  const fold = (items: readonly string[]) =>
    items.map((item) => item.replace(/\s+/gu, '').toLocaleLowerCase('en')).sort();
  const [left, right] = [fold(a), fold(b)];
  return left.length === right.length && left.every((item, index) => item === right[index]);
};

/** The fields a fill fills, in the order of `CUSTODY_FIELDS`. */
const fieldsOf = (fill: CustodyFill): CustodyField[] =>
  CUSTODY_FIELDS.filter((field) =>
    field.startsWith('specs.')
      ? fill.specs?.[field.slice('specs.'.length) as CustodySpecField] !== undefined
      : fill[field as Exclude<CustodyField, `specs.${string}`>] !== undefined,
  );

/**
 * An October all-in-one's serial — «MP30EPE1», eight characters. Its barcode reads it with a
 * leading «S» that is not part of the serial, and the October step takes «S»+serial on the
 * register for the same device (`aio-october.ts`): one the IT team scanned in by its barcode.
 * Only a serial of this shape has that twin — no other identifier grows an «S».
 */
const BARCODE_S_SERIAL = /^MP[0-9A-Z]{6}$/u;

/**
 * What happens to each line, in the file's order.
 *
 * A line is found by everything it is known by — the register's serial the review matched, its
 * serial and its tag — against every live device's serial number AND printed tag, without case;
 * an all-in-one's «MP30EP…» serial also against a serial number of «S» and that serial, its
 * barcode's spelling (`BARCODE_S_SERIAL`). One device: «أكمّل الناقص بس» — what it has no value
 * for is filled, what it has is kept (and reported where the sheet disagrees); and
 * «كل فرع فى فرعه» — a device in stock in another branch is moved to the sheet's, whatever the
 * review planned for the line, leaving behind the place it had there (`move.location`), while a
 * device somebody holds stays where its custody put it, its place with it, reported. No device: a
 * `new` line is registered; a line the review found on the register is reported, never
 * registered — it carries no name or category.
 */
export const planBranchCustody = (
  rows: readonly CustodyRow[],
  register: readonly CustodyAsset[],
  branchIds: ReadonlyMap<InventoryBranch, string>,
): CustodyDecision[] => {
  const key = (id: string): string => id.trim().toUpperCase();
  const byIdentifier = new Map<string, CustodyAsset[]>();
  const bySerialNumber = new Map<string, CustodyAsset[]>();
  for (const asset of register) {
    for (const id of [asset.serialNumber, asset.externalTag]) {
      if (!typed(id)) continue;
      const hits = byIdentifier.get(key(id)) ?? [];
      if (!hits.includes(asset)) hits.push(asset);
      byIdentifier.set(key(id), hits);
    }
    if (typed(asset.serialNumber)) {
      const id = key(asset.serialNumber);
      bySerialNumber.set(id, [...(bySerialNumber.get(id) ?? []), asset]);
    }
  }
  /** The devices a key answers to — an all-in-one's serial under its barcode's «S» too. */
  const answering = (id: string): CustodyAsset[] => [
    ...(byIdentifier.get(id) ?? []),
    ...(BARCODE_S_SERIAL.test(id) ? (bySerialNumber.get(`S${id}`) ?? []) : []),
  ];
  // How many of the file's lines name each identifier: a tag another line names is that line's.
  const named = new Map<string, number>();
  for (const row of rows) {
    if (row.action === 'skip') continue;
    for (const id of new Set(identifiersOf(row).map(key))) named.set(id, (named.get(id) ?? 0) + 1);
  }
  const targeted = new Map<string, CustodyLiveRow>();
  const registering = new Map<string, CustodyLiveRow>();

  return rows.map((row): CustodyDecision => {
    if (row.action === 'skip') return { kind: 'skipped', row, reason: row.reason };
    const toBranchId = branchIds.get(row.branch);
    if (toBranchId === undefined) throw new Error(`no live branch for ${row.branch}`);

    const keys = [
      ...new Set(
        [row.action === 'new' ? null : row.registerSerial, row.serial, row.tag].flatMap((id) =>
          id === null ? [] : [key(id)],
        ),
      ),
    ];
    const candidates = [...new Set(keys.flatMap(answering))];
    if (candidates.length > 1) {
      return { kind: 'ambiguous', row, assetCodes: candidates.map((asset) => asset.assetCode) };
    }
    const [asset] = candidates;

    if (asset === undefined) {
      if (row.action !== 'new') return { kind: 'notFound', row };
      // Two lines registering one device — by its serial or by its other label — make one asset.
      const first = keys.map((id) => registering.get(id)).find((hit) => hit !== undefined);
      if (first !== undefined) return { kind: 'duplicateTarget', row, asset: null, first };
      const serialNumber = newSerialOf(row);
      const externalTag = otherIdentifierOf(row, serialNumber);
      for (const id of keys) registering.set(id, row);
      return { kind: 'create', row, serialNumber, externalTag, branchId: toBranchId };
    }

    const first = targeted.get(asset.id);
    if (first !== undefined) return { kind: 'duplicateTarget', row, asset, first };
    targeted.set(asset.id, row);

    const fill: CustodyFill = {};
    const kept: KeptCustodyValue[] = [];
    const keep = (field: CustodyField, register: string, sheet: string): void => {
      kept.push({ field, register, sheet });
    };

    const specs: Partial<Record<CustodySpecField, string>> = {};
    for (const field of CUSTODY_SPEC_FIELDS) {
      const value = row.specs[field];
      if (value === undefined) continue;
      const current = asset.specs?.[field];
      if (!typed(current)) specs[field] = value;
      else if (!sameSpec(current, value)) keep(`specs.${field}`, current, value);
    }
    if (Object.keys(specs).length > 0) fill.specs = specs;

    const accessories = asset.accessories ?? [];
    if (row.accessories.length > 0) {
      if (accessories.length === 0) fill.accessories = [...row.accessories];
      else if (!sameAccessories(accessories, row.accessories)) {
        keep('accessories', accessories.join(', '), row.accessories.join(', '));
      }
    }

    // The label printed on the device, when the line has one beside the asset's serial — never one
    // another device answers to, on the register or on another line of the file.
    const other = otherIdentifierOf(row, asset.serialNumber);
    if (other !== null) {
      if (typed(asset.externalTag)) {
        if (!sameIdentifier(asset.externalTag, other)) {
          keep('externalTag', asset.externalTag, other);
        }
      } else if (!byIdentifier.has(key(other)) && (named.get(key(other)) ?? 0) <= 1) {
        fill.externalTag = other;
      }
    }

    // Only a `new` line carries them: a device the IT team registered by hand since the review.
    if (row.action === 'new') {
      for (const field of ['manufacturer', 'model'] as const) {
        const value = row[field];
        if (value === null) continue;
        const current = asset[field];
        if (!typed(current)) fill[field] = value;
        else if (!sameSpec(current, value)) keep(field, current, value);
      }
    }

    let move: FoundCustodyDecision['move'] = null;
    let notMoved: { status: string; branchId: string } | null = null;
    if (asset.branchId !== toBranchId) {
      if (asset.status === 'inStock' && asset.currentAssignmentId === null) {
        // Its place names somewhere inside the branch it leaves, so it does not travel with it. A
        // device that stays — held elsewhere, or already in its branch — keeps its own.
        const location = typed(asset.location) ? asset.location : null;
        move = { fromBranchId: asset.branchId, toBranchId, location };
      } else {
        notMoved = { status: asset.status, branchId: asset.branchId };
      }
    }

    const fields = fieldsOf(fill);
    const alreadyRegistered = row.action === 'new';
    if (fields.length === 0 && move === null && notMoved === null) {
      return { kind: 'complete', row, asset, kept, alreadyRegistered };
    }
    return { kind: 'found', row, asset, fill, fields, kept, move, notMoved, alreadyRegistered };
  });
};

export type FoundCustodyDecision = Extract<CustodyDecision, { kind: 'found' }>;

/**
 * Whether a decision writes the device it found: only when there is a field to fill or a move.
 * A device somebody holds in another branch with nothing it lacks is `found` — its `notMoved` is
 * reported — but there is nothing to write on it: an update would still take its last editor
 * away and its version up, for no change. It is the production case — the head office's held
 * devices on a branch's sheet — so it is a rule of its own, not the writer's aside.
 */
export const writesAsset = (decision: CustodyDecision): decision is FoundCustodyDecision =>
  decision.kind === 'found' && (decision.fields.length > 0 || decision.move !== null);

/** The values a field holds — on the register's device, or after the fill. */
export interface CustodyValues {
  specs?: Partial<ItAssetSpecsSub> | null;
  accessories?: readonly string[] | null;
  externalTag?: string | null;
  manufacturer?: string | null;
  model?: string | null;
}

/** One field's value, as the audit row records it. */
export const custodyValueOf = (values: CustodyValues, field: CustodyField): unknown => {
  if (field.startsWith('specs.')) {
    return values.specs?.[field.slice('specs.'.length) as CustodySpecField] ?? null;
  }
  if (field === 'accessories') return [...(values.accessories ?? [])];
  return values[field as 'externalTag' | 'manufacturer' | 'model'] ?? null;
};

/** What the write sets on a device — `specs` as a whole: its own rows kept, the empty ones filled. */
export interface CustodySet {
  specs?: ItAssetSpecsSub;
  accessories?: string[];
  externalTag?: string;
  manufacturer?: string;
  model?: string;
}

export const custodySet = (asset: Pick<CustodyAsset, 'specs'>, fill: CustodyFill): CustodySet => ({
  // A device with no table gets the whole table, every row it has no value for empty.
  ...(fill.specs === undefined
    ? {}
    : { specs: { ...copySpecs(asset.specs ?? {}), ...fill.specs } }),
  ...(fill.accessories === undefined ? {} : { accessories: [...fill.accessories] }),
  ...(fill.externalTag === undefined ? {} : { externalTag: fill.externalTag }),
  ...(fill.manufacturer === undefined ? {} : { manufacturer: fill.manufacturer }),
  ...(fill.model === undefined ? {} : { model: fill.model }),
});

/**
 * The live category each new line's kind is filed under — its OWN, by any of the names the
 * inventory accepts for it (`matchCategories`) — and the kinds that have none. A kind with no
 * category of its own is never filed under another: the October all-in-ones fall back to the
 * desktops (`inventoryCategoryFor`), but a phone, a screen, a printer or a laptop filed as a
 * desktop would sit wrongly on the register with nobody told. So any kind missing refuses the
 * whole run — nothing written, and the next boot tries again — an all-in-one included, since no
 * line of these sheets is one.
 */
export const custodyCategoriesFor = (
  live: readonly LiveCategory[],
  keys: Iterable<InventoryCategoryKey>,
): { categories: Map<InventoryCategoryKey, LiveCategory>; missing: InventoryCategoryKey[] } => {
  const matched = matchCategories(live);
  const categories = new Map<InventoryCategoryKey, LiveCategory>();
  const missing: InventoryCategoryKey[] = [];
  for (const key of new Set(keys)) {
    const category = matched.get(key) ?? null;
    if (category === null) missing.push(key);
    else categories.set(key, category);
  }
  return { categories, missing };
};

/** A new asset's table — the whole table when the line has any row of it, none otherwise. */
export const newAssetSpecs = (specs: CustodySpecs): ItAssetSpecsSub | null =>
  CUSTODY_SPEC_FIELDS.every((field) => specs[field] === undefined)
    ? null
    : copySpecs({
        processor: specs.processor ?? null,
        memory: specs.memory ?? null,
        systemType: specs.systemType ?? null,
        storage: specs.storage ?? null,
        displayAdapter: specs.displayAdapter ?? null,
      });

/** When the owner sent the sheets. */
const SENT = 'نوفمبر 2026';

/** «من ملف «عهدة فرع بورسعيد» — نوفمبر 2026» — the owner's own name for the sheet. */
export const custodySource = (row: Pick<CustodyRow, 'sheet'>): string =>
  `من ملف «${row.sheet}» — ${SENT}`;

/** A new asset's notes: where it came from, and what its line says that no field holds. */
export const newAssetNotes = (row: Pick<CustodyNewRow, 'sheet' | 'note'>): string =>
  row.note === null ? custodySource(row) : `${custodySource(row)}\n${row.note}`;

/** «أُضيفت من ملف «عهدة فرع طنطا» — نوفمبر 2026: المعالج، المشتملات» — what this step filled. */
export const updatedHistoryNote = (
  row: Pick<CustodyRow, 'sheet'>,
  fields: readonly CustodyField[],
): string =>
  `أُضيفت ${custodySource(row)}: ${fields.map((field) => CUSTODY_FIELD_LABELS[field]).join('، ')}`;

/**
 * «نُقل إلى فرع الشروق حسب ملف «عهدة فرع الشروق» — نوفمبر 2026» — and, when the device had a place
 * in the branch it left, that the place was cleared: «… — وأُزيل الموقع السابق «مخزن IT»».
 */
export const transferredHistoryNote = (
  row: Pick<CustodyRow, 'sheet' | 'branch'>,
  location: string | null,
): string => {
  const moved = `نُقل إلى فرع ${row.branch} حسب ملف «${row.sheet}» — ${SENT}`;
  return location === null ? moved : `${moved} — وأُزيل الموقع السابق «${location}»`;
};

/** Where a line is in the owner's sheets — what every entry of the report starts with. */
export interface CustodyLine {
  sheet: string;
  row: number;
  serial: string | null;
  tag: string | null;
}

const lineOf = (row: CustodyRow): CustodyLine => ({
  sheet: row.sheet,
  row: row.row,
  serial: row.serial,
  tag: row.tag,
});

/** What the run did, line by line — kept on the run row, because the owner cannot read the log. */
export interface BranchCustodyReport {
  rows: number;
  created: (CustodyLine & {
    assetCode: string;
    serialNumber: string;
    externalTag: string | null;
    branch: string;
  })[];
  /** Devices each field was filled on. */
  filled: Record<CustodyField, number>;
  filledAssets: (CustodyLine & { assetCode: string; fields: CustodyField[] })[];
  /** `location`: the place the device had in the branch it left — cleared by the move — or null. */
  moved: (CustodyLine & {
    assetCode: string;
    from: string;
    to: string;
    location: string | null;
  })[];
  notMoved: (CustodyLine & { assetCode: string; status: string; branch: string })[];
  kept: (CustodyLine & {
    assetCode: string;
    field: CustodyField;
    register: string;
    sheetValue: string;
  })[];
  notFound: (CustodyLine & { registerSerial: string })[];
  ambiguous: (CustodyLine & { assetCodes: string[] })[];
  alreadyRegistered: (CustodyLine & { assetCode: string })[];
  duplicateTarget: (CustodyLine & {
    assetCode: string | null;
    first: { sheet: string; row: number };
  })[];
  skipped: (CustodyLine & { reason: CustodySkipRow['reason'] })[];
  complete: (CustodyLine & { assetCode: string })[];
}

/**
 * The plan as the owner reads it: every line that did something, or did not, by sheet and row.
 * `createdCodes` are the new assets' codes in the order of the `create` decisions; `branchName`
 * names a branch by its id.
 */
export const reportBranchCustody = (
  decisions: readonly CustodyDecision[],
  createdCodes: readonly string[],
  branchName: (id: string) => string,
): BranchCustodyReport => {
  const creates = decisions.flatMap((d) => (d.kind === 'create' ? [d] : []));
  const codeOf = new Map<CustodyRow, string | null>(
    creates.map((d, index) => [d.row, createdCodes[index] ?? null]),
  );
  const found = decisions.flatMap((d) => (d.kind === 'found' ? [d] : []));
  const resolved = decisions.flatMap((d) =>
    d.kind === 'found' || d.kind === 'complete' ? [d] : [],
  );
  const filledAssets = found
    .filter((d) => d.fields.length > 0)
    .map((d) => ({ ...lineOf(d.row), assetCode: d.asset.assetCode, fields: d.fields }));
  return {
    rows: decisions.length,
    created: creates.map((d) => ({
      ...lineOf(d.row),
      assetCode: codeOf.get(d.row) ?? '',
      serialNumber: d.serialNumber,
      externalTag: d.externalTag,
      branch: branchName(d.branchId),
    })),
    filled: Object.fromEntries(
      CUSTODY_FIELDS.map((field) => [
        field,
        filledAssets.filter((entry) => entry.fields.includes(field)).length,
      ]),
    ) as Record<CustodyField, number>,
    filledAssets,
    moved: found.flatMap((d) =>
      d.move === null
        ? []
        : [
            {
              ...lineOf(d.row),
              assetCode: d.asset.assetCode,
              from: branchName(d.move.fromBranchId),
              to: branchName(d.move.toBranchId),
              location: d.move.location,
            },
          ],
    ),
    notMoved: found.flatMap((d) =>
      d.notMoved === null
        ? []
        : [
            {
              ...lineOf(d.row),
              assetCode: d.asset.assetCode,
              status: d.notMoved.status,
              branch: branchName(d.notMoved.branchId),
            },
          ],
    ),
    kept: resolved.flatMap((d) =>
      d.kept.map((value) => ({
        ...lineOf(d.row),
        assetCode: d.asset.assetCode,
        field: value.field,
        register: value.register,
        sheetValue: value.sheet,
      })),
    ),
    notFound: decisions.flatMap((d) =>
      d.kind === 'notFound' ? [{ ...lineOf(d.row), registerSerial: d.row.registerSerial }] : [],
    ),
    ambiguous: decisions.flatMap((d) =>
      d.kind === 'ambiguous' ? [{ ...lineOf(d.row), assetCodes: d.assetCodes }] : [],
    ),
    alreadyRegistered: resolved
      .filter((d) => d.alreadyRegistered)
      .map((d) => ({ ...lineOf(d.row), assetCode: d.asset.assetCode })),
    duplicateTarget: decisions.flatMap((d) =>
      d.kind === 'duplicateTarget'
        ? [
            {
              ...lineOf(d.row),
              assetCode: d.asset?.assetCode ?? codeOf.get(d.first) ?? null,
              first: { sheet: d.first.sheet, row: d.first.row },
            },
          ]
        : [],
    ),
    skipped: decisions.flatMap((d) =>
      d.kind === 'skipped' ? [{ ...lineOf(d.row), reason: d.reason }] : [],
    ),
    complete: decisions.flatMap((d) =>
      d.kind === 'complete' ? [{ ...lineOf(d.row), assetCode: d.asset.assetCode }] : [],
    ),
  };
};
