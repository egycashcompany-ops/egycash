// The devices' specifications the IT team keeps in «جرد الأجهزة.xlsx» — processor, memory and
// storage by serial — as the go-live reads them. «وهبعتلك ملف تانى أسمه (جرد الأجهزة) هنشوف فيه
// الـ سيريال بتاع الجهاز وتاخد بيانات الرام والبروسيسور والهارد وتزودها على السيستم».
//
// The sheet was read and reviewed with the owner BEFORE anything was written («موافق على كل
// اقتراحاتك، طبّق الأربعة»): four serials the sheet mistyped are looked for under the register's
// spelling (`registerSerial`), one with no match and the two «Laptop» rows are left out, and each
// value is written one way («Intel Core i7», «8 GB», «SSD») where the sheet had several («Core I7»,
// «8 Giga»). What came out of that review is `assets/it-go-live/asset-specs-2026-10.json`, and this
// file is the part of the go-live that is pure: the file's shape, the device each row is found on,
// and what is added to it. The writing is `asset-specs.ts`.
//
// NOTHING BUT THE DEVICE IS IN THE FILE. The sheet also says whose desk and which department; none
// of it travels — a row is a serial and three values, which is all «تزودها» asks for.
import { z } from 'zod';
import type { ItAssetSpecsSub } from '../assets/asset.model';

/** The rows of the acknowledgment's table the sheet fills — and only these. */
export const SHEET_SPEC_FIELDS = ['processor', 'memory', 'storage'] as const;
export type SheetSpecField = (typeof SHEET_SPEC_FIELDS)[number];

const text = z.string().trim().min(1);
/** The register's own limit for one row of the table. */
const specValue = text.max(200);

export const AssetSpecsRowSchema = z
  .object({
    /** «جرد الأجهزة صف 2» — the file and the row; what the report names it by. */
    key: text,
    /** The serial as the sheet writes it. */
    serial: text.max(100),
    /** The register's spelling of a serial the sheet mistyped — the one looked for; null when the sheet's is. */
    registerSerial: text.max(100).nullable(),
    processor: specValue,
    memory: specValue,
    storage: specValue,
  })
  .strict();
export type AssetSpecsRow = z.infer<typeof AssetSpecsRowSchema>;

/** The serial the register is searched for: its own spelling where the sheet mistyped it. */
export const targetSerial = (row: AssetSpecsRow): string => row.registerSerial ?? row.serial;

export const AssetSpecsFileSchema = z
  .object({
    source: text,
    devices: z.array(AssetSpecsRowSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const keys = new Set<string>();
    const targets = new Set<string>();
    file.devices.forEach((row, index) => {
      const issue = (field: keyof AssetSpecsRow, message: string): void => {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['devices', index, field], message });
      };
      if (keys.has(row.key)) issue('key', `${row.key} appears twice`);
      keys.add(row.key);
      // One row per device: two rows for one serial would leave which one wins to the order.
      const target = targetSerial(row).toUpperCase();
      if (targets.has(target)) issue('serial', `${targetSerial(row)} appears twice`);
      targets.add(target);
      if (
        row.registerSerial !== null &&
        row.registerSerial.toUpperCase() === row.serial.toUpperCase()
      ) {
        issue('registerSerial', `${row.key}: a correction that changes nothing`);
      }
    });
  });
export type AssetSpecsFile = z.infer<typeof AssetSpecsFileSchema>;

export const parseAssetSpecs = (json: unknown): AssetSpecsFile => AssetSpecsFileSchema.parse(json);

/** What the plan needs to know of a device on the register. */
export interface RegisterDevice {
  id: string;
  assetCode: string;
  serialNumber: string;
  specs?: Partial<ItAssetSpecsSub> | null;
}

/** A value somebody already typed that the sheet disagrees with — kept, and reported. */
export interface KeptValue {
  key: string;
  assetCode: string;
  field: SheetSpecField;
  kept: string;
  sheet: string;
}

export type SpecsDecision =
  | { kind: 'notFound'; row: AssetSpecsRow }
  /** Two devices whose serials differ only in case: neither is guessed at. */
  | { kind: 'ambiguous'; row: AssetSpecsRow; assetCodes: string[] }
  | {
      kind: 'found';
      row: AssetSpecsRow;
      device: RegisterDevice;
      /** The rows the device has no value for, and the sheet's value for each. */
      fill: Partial<Record<SheetSpecField, string>>;
      kept: KeptValue[];
    };

const typed = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** Two spellings of one value — «8GB» and «8 GB», «intel core i7» and «Intel Core i7». */
export const sameSpec = (a: string, b: string): boolean =>
  a.replace(/\s+/gu, '').toLocaleLowerCase('en') === b.replace(/\s+/gu, '').toLocaleLowerCase('en');

/**
 * What happens to each row. «وتزودها» — ADDED: a row of the table the device has no value for gets
 * the sheet's; a value somebody typed is the IT team's own and stays, reported when the sheet says
 * otherwise. The device is found by serial without case, as the inventory compares.
 */
export const planAssetSpecs = (
  rows: readonly AssetSpecsRow[],
  devices: readonly RegisterDevice[],
): SpecsDecision[] => {
  const bySerial = new Map<string, RegisterDevice[]>();
  for (const device of devices) {
    const serial = device.serialNumber.toUpperCase();
    bySerial.set(serial, [...(bySerial.get(serial) ?? []), device]);
  }
  return rows.map((row): SpecsDecision => {
    const hits = bySerial.get(targetSerial(row).toUpperCase()) ?? [];
    const [device] = hits;
    if (device === undefined) return { kind: 'notFound', row };
    if (hits.length > 1) {
      return { kind: 'ambiguous', row, assetCodes: hits.map((hit) => hit.assetCode) };
    }
    const fill: Partial<Record<SheetSpecField, string>> = {};
    const kept: KeptValue[] = [];
    for (const field of SHEET_SPEC_FIELDS) {
      const current = device.specs?.[field];
      if (!typed(current)) fill[field] = row[field];
      else if (!sameSpec(current, row[field])) {
        kept.push({
          key: row.key,
          assetCode: device.assetCode,
          field,
          kept: current,
          sheet: row[field],
        });
      }
    }
    return { kind: 'found', row, device, fill, kept };
  });
};

/**
 * The device's specifications with the sheet's values added — every other row of the table exactly
 * as it was, and the whole table made when the device had none.
 */
export const filledSpecs = (
  current: Partial<ItAssetSpecsSub> | null | undefined,
  fill: Partial<Record<SheetSpecField, string>>,
): ItAssetSpecsSub => ({
  processor: fill.processor ?? current?.processor ?? null,
  memory: fill.memory ?? current?.memory ?? null,
  systemType: current?.systemType ?? null,
  storage: fill.storage ?? current?.storage ?? null,
  mediaDrive: current?.mediaDrive ?? null,
  displayAdapter: current?.displayAdapter ?? null,
  graphicsMemory: current?.graphicsMemory ?? null,
  networkAdapters: [...(current?.networkAdapters ?? [])],
});
