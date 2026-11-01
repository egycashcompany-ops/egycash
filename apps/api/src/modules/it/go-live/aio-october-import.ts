// The October all-in-ones — the serials the owner sent in «SN ايجي كاش.xlsx» — as the go-live reads
// them. «هبعتلك سيريلات أجهزة عايز أرفعها بنفس مواصفات Lenovo ThinkCentre neo 50a 24 جهاز كمبيوتر
// AIO بس هيكون فى فرع أكتوبر ومش متسلم لحد».
//
// The sheet was read and reviewed with the owner BEFORE anything was written («موافق على كل
// اقتراحاتك، طبّق الأربعة»): the leading «S» the barcode reads marks the field and is not part of
// the serial; the two serials the inventory already registered at the head office (MP30EPDA,
// MP30EPD2) stay as they are; and the one short serial (row 71) is no device of its own — read off
// the device by the owner, it is MP30EPD8, row 62's, scanned again («MP30EPD8 فعلاً»). What
// came out of that review is `assets/it-go-live/aio-october-2026-10.json`, and this file is the
// part of the go-live that is pure: the file's shape, which of the register's devices the owner's
// «بنفس مواصفات» points at, and the category an all-in-one is filed under when the register has no
// such device. The writing is `aio-october.ts`.
//
// NOBODY IS IN THE FILE. «ومش متسلم لحد»: every device goes to the branch's stock, so a row is a
// serial and the sheet's row number, nothing else.
import { z } from 'zod';
import type { ItAssetSpecsSub } from '../assets/asset.model';
import {
  INVENTORY_BRANCHES,
  INVENTORY_CATEGORY_KEYS,
  matchCategories,
  type InventoryCategoryKey,
  type LiveCategory,
} from './inventory-import';

const text = z.string().trim().min(1);

export const AioDeviceSchema = z
  .object({
    /** «SN ايجي كاش صف 1» — the file and the row the serial came from; what the report names it by. */
    key: text,
    serial: text.max(100),
  })
  .strict();
export type AioDevice = z.infer<typeof AioDeviceSchema>;

export const AioOctoberFileSchema = z
  .object({
    source: text,
    // The branches the inventory already found by name — one list, one matcher.
    branch: z.enum(INVENTORY_BRANCHES),
    /**
     * The device the owner named, as the file spells it: the register's device of EXACTLY this
     * name is the one copied, and these fields are only what a copy carries when there is none.
     */
    template: z
      .object({
        name: text,
        manufacturer: text,
        model: text,
        category: z.enum(INVENTORY_CATEGORY_KEYS),
      })
      .strict(),
    devices: z.array(AioDeviceSchema).min(1),
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
      // Without case, as the register is compared: «mp30epf4» is the label's «MP30EPF4».
      const serial = device.serial.toUpperCase();
      if (serials.has(serial)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['devices', index, 'serial'],
          message: `serial ${device.serial} appears twice`,
        });
      }
      serials.add(serial);
    });
  });
export type AioOctoberFile = z.infer<typeof AioOctoberFileSchema>;

export const parseAioOctober = (json: unknown): AioOctoberFile => AioOctoberFileSchema.parse(json);

/** The rows of the acknowledgment's table that hold one text value each. */
const SPEC_TEXT_FIELDS = [
  'processor',
  'memory',
  'systemType',
  'storage',
  'mediaDrive',
  'displayAdapter',
  'graphicsMemory',
] as const;

const typed = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim() !== '';

/** Whether a device's specifications say anything at all — one row of the table is enough. */
export const hasSpecs = (specs: Partial<ItAssetSpecsSub> | null | undefined): boolean =>
  specs != null &&
  (SPEC_TEXT_FIELDS.some((field) => typed(specs[field])) ||
    (specs.networkAdapters ?? []).some((adapter) => typed(adapter)));

/** A device's specifications as a copy of its own — never the same object shared by two assets. */
export const copySpecs = (specs: Partial<ItAssetSpecsSub>): ItAssetSpecsSub => ({
  processor: specs.processor ?? null,
  memory: specs.memory ?? null,
  systemType: specs.systemType ?? null,
  storage: specs.storage ?? null,
  mediaDrive: specs.mediaDrive ?? null,
  displayAdapter: specs.displayAdapter ?? null,
  graphicsMemory: specs.graphicsMemory ?? null,
  networkAdapters: [...(specs.networkAdapters ?? [])],
});

/** What is read of a register device that may be the one the owner named. */
export interface TemplateCandidate {
  specs?: Partial<ItAssetSpecsSub> | null;
  updatedAt?: Date | null;
}

/**
 * «بنفس مواصفات Lenovo ThinkCentre neo 50a 24»: of the register's devices by that name, the one
 * somebody filled the specifications in on — they are what the owner means by «مواصفات» — and the
 * most recently edited of those; when none has any, the most recently edited of all. Two edited at
 * the same moment keep the order they are given in. Null when the register has none.
 */
export const pickTemplate = <T extends TemplateCandidate>(candidates: readonly T[]): T | null => {
  const newestFirst = [...candidates].sort(
    (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
  );
  return newestFirst.find((candidate) => hasSpecs(candidate.specs)) ?? newestFirst[0] ?? null;
};

/**
 * The category the inventory files a kind under (`inventory.ts`): the IT team's own by any of its
 * names, and the desktops' for an all-in-one when the register has no all-in-one category. After
 * the inventory's run the desktops' category is there — it made it when the IT team had none — so
 * null means somebody has since removed both, and the import refuses rather than guess.
 */
export const inventoryCategoryFor = (
  live: readonly LiveCategory[],
  key: InventoryCategoryKey,
): LiveCategory | null => {
  const matched = matchCategories(live);
  return matched.get(key) ?? matched.get('desktop') ?? null;
};
