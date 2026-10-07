// The IT inventory the owner sent — «Inventory_Sys_26.xlsx», ten sheets — as the go-live reads it.
//
// The sheet was read and reviewed BEFORE anything was written: every device was given its branch,
// its category and, for the head office, the employee it is with — the sheet's two-part names
// matched against HR by branch and department, and the matches the owner did not confirm left in
// stock. What came out of that review is `assets/it-go-live/inventory-2026-10.json`, and this file
// is the part of the go-live that is pure: the file's shape, the category each device is filed
// under, and how a branch the sheet names is found in the organisation's own list. The writing is
// `inventory.ts`.
//
// NOTHING FROM HR IS IN THE FILE BUT A CODE. A device handed over names its holder by employee
// code; the name, the national ID and the rest are read from HR when the receipt is written, like
// every hand-over's. The sheet's own spelling of the holder rides along as `holder` — it is what
// a device left in stock says it was found with.
import { z } from 'zod';

/** The kinds the sheet holds, each filed under one asset category. */
export const INVENTORY_CATEGORY_KEYS = [
  'desktop',
  'allInOne',
  'screen',
  'laptop',
  'ipPhone',
  'printer',
] as const;
export type InventoryCategoryKey = (typeof INVENTORY_CATEGORY_KEYS)[number];

/** The branches the sheet is spread over, by the names the fleet import already found them by. */
export const INVENTORY_BRANCHES = [
  'المهندسين',
  'طنطا',
  'الإسكندرية',
  'أسيوط',
  'بورسعيد',
  'الشروق',
  'أكتوبر',
] as const;
export type InventoryBranch = (typeof INVENTORY_BRANCHES)[number];

const text = z.string().trim().min(1);

export const InventoryDeviceSchema = z
  .object({
    /** «HQ PC#3» — the sheet and the row the device came from; what the report names it by. */
    key: text,
    category: z.enum(INVENTORY_CATEGORY_KEYS),
    name: text,
    manufacturer: text.nullable(),
    model: text.nullable(),
    /** Null for the one device the sheet gives none, and for the second of a repeated number. */
    serial: text.nullable(),
    branch: z.enum(INVENTORY_BRANCHES),
    /** The employee it is handed over to — only for a head-office device the review settled. */
    holderCode: z
      .string()
      .regex(/^\d{7}$/u)
      .nullable(),
    /** The sheet's own spelling of whoever had it, or of the place it is in. */
    holder: text.nullable(),
    location: text.nullable(),
    accessories: z.array(text),
    storage: text.nullable(),
    notes: text.nullable(),
  })
  .strict();
export type InventoryDevice = z.infer<typeof InventoryDeviceSchema>;

export const InventoryFileSchema = z
  .object({
    source: text,
    devices: z.array(InventoryDeviceSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const keys = new Set<string>();
    const serials = new Set<string>();
    file.devices.forEach((device, index) => {
      if (keys.has(device.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['devices', index, 'key'],
          message: `${device.key} appears twice`,
        });
      }
      keys.add(device.key);
      if (device.serial !== null) {
        if (serials.has(device.serial)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['devices', index, 'serial'],
            message: `serial ${device.serial} appears twice`,
          });
        }
        serials.add(device.serial);
      }
      // Handed over in the head office only: every branch device goes to its branch's stock.
      if (device.holderCode !== null && device.branch !== 'المهندسين') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['devices', index, 'holderCode'],
          message: `${device.key} is a branch device; it is not handed over`,
        });
      }
    });
  });
export type InventoryFile = z.infer<typeof InventoryFileSchema>;

export const parseInventory = (json: unknown): InventoryFile => InventoryFileSchema.parse(json);

/**
 * Arabic folded flat for comparing two spellings of one name: the hamza forms to a bare alef,
 * the diacritics and tatweel dropped, taa marbuta and alef maqsura normalised, case and spacing
 * ignored. «الأسكندرية» and «الاسكندرية», or «لاب توب» and «لابتوب», fold to one key.
 */
export const foldName = (name: string): string =>
  name
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/gu, '')
    .replace(/[آأإٱ]/gu, 'ا')
    .replace(/ة/gu, 'ه')
    .replace(/ى/gu, 'ي')
    .replace(/\s+/gu, '')
    .toLocaleLowerCase('en');

/**
 * Every spelling the organisation's list may give a branch the sheet names. Matched, never
 * created: a branch carries a company code only the company decides, and HR, Gold and every
 * user's scope point at the same list (the fleet import's rule).
 */
const BRANCH_SPELLINGS: Readonly<Record<InventoryBranch, readonly string[]>> = {
  المهندسين: ['المهندسين'],
  طنطا: ['طنطا'],
  الإسكندرية: ['الإسكندرية', 'إسكندرية'],
  أسيوط: ['أسيوط'],
  بورسعيد: ['بورسعيد'],
  // «وصال هو فرع الشروق فعلاً» — the sheet's «Wesal» is the Shorouk branch.
  الشروق: ['الشروق', 'وصال'],
  أكتوبر: ['أكتوبر', '6 أكتوبر', '٦ أكتوبر', 'السادس من أكتوبر'],
};

export interface LiveBranch {
  id: string;
  name: { ar: string; en: string };
  status: 'active' | 'inactive';
}

export type BranchMatch =
  | { kind: 'found'; branch: LiveBranch }
  | { kind: 'missing' }
  | { kind: 'inactive'; branch: LiveBranch }
  | { kind: 'ambiguous'; names: string[] };

/** The live branch each of the sheet's branches is, by any of its spellings. */
export const matchBranches = (
  live: readonly LiveBranch[],
): ReadonlyMap<InventoryBranch, BranchMatch> =>
  new Map(
    INVENTORY_BRANCHES.map((wanted): [InventoryBranch, BranchMatch] => {
      const keys = new Set(BRANCH_SPELLINGS[wanted].map(foldName));
      const hits = live.filter(
        (branch) => keys.has(foldName(branch.name.ar)) || keys.has(foldName(branch.name.en)),
      );
      const [only] = hits;
      if (only === undefined) return [wanted, { kind: 'missing' }];
      if (hits.length > 1)
        return [wanted, { kind: 'ambiguous', names: hits.map((b) => b.name.ar) }];
      return [
        wanted,
        only.status === 'active'
          ? { kind: 'found', branch: only }
          : { kind: 'inactive', branch: only },
      ];
    }),
  );

/**
 * The asset category each kind is filed under: an existing one by any of the names the IT team may
 * already have given it, or a new one by the first name. An all-in-one is filed with the
 * all-in-ones when the register has such a category — the head office's Lenovo ThinkCentre neo
 * 50a is one — and with the desktops otherwise.
 */
export const INVENTORY_CATEGORIES: Readonly<
  Record<
    InventoryCategoryKey,
    { accept: readonly string[]; create: { ar: string; en: string } | null }
  >
> = {
  desktop: {
    accept: ['كمبيوتر مكتبي', 'كمبيوتر', 'كمبيوتر ديسكتوب', 'Desktop'],
    create: { ar: 'كمبيوتر مكتبي', en: 'Desktop computer' },
  },
  allInOne: { accept: ['كمبيوتر All', 'كمبيوتر All in One', 'All in One'], create: null },
  screen: { accept: ['شاشة', 'شاشات', 'Monitor', 'Screen'], create: { ar: 'شاشة', en: 'Monitor' } },
  laptop: { accept: ['لاب توب', 'Laptop'], create: { ar: 'لاب توب', en: 'Laptop' } },
  ipPhone: {
    accept: ['هاتف IP', 'تليفون IP', 'IP Phone'],
    create: { ar: 'هاتف IP', en: 'IP phone' },
  },
  printer: { accept: ['طابعة', 'طابعات', 'Printer'], create: { ar: 'طابعة', en: 'Printer' } },
};

export interface LiveCategory {
  id: string;
  name: { ar: string; en: string };
  isActive: boolean;
}

/**
 * For each kind, the live category it goes under — or null, to be created. An active category is
 * preferred to a retired one of the same name; a retired one is still taken over creating a twin,
 * which the catalog's unique name would refuse anyway.
 */
export const matchCategories = (
  live: readonly LiveCategory[],
): ReadonlyMap<InventoryCategoryKey, LiveCategory | null> =>
  new Map(
    INVENTORY_CATEGORY_KEYS.map((key): [InventoryCategoryKey, LiveCategory | null] => {
      for (const name of INVENTORY_CATEGORIES[key].accept) {
        const fold = foldName(name);
        const hits = live.filter(
          (category) => foldName(category.name.ar) === fold || foldName(category.name.en) === fold,
        );
        const pick = hits.find((category) => category.isActive) ?? hits[0];
        if (pick !== undefined) return [key, pick];
      }
      return [key, null];
    }),
  );
