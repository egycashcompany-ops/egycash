// The consumables the IT team holds today — the «إجمالي» row of the owner's «جرد الأجهزة.xlsx» — as
// the go-live reads it. «دخّل الأرصدة».
//
// The sheet was read and reviewed with the owner BEFORE anything was written: each consumable it
// counts was given a plain name, the type it is filed under (a code of
// `consumable-type-defaults.ts`) and its unit. What came out of that review is
// `assets/it-go-live/consumables-opening-2026-10.json`, and this file is the part of the go-live that
// is pure: the file's shape, the rules a reviewed row keeps, and how a row finds the item the store
// may already keep. The writing is `consumables-opening.ts`.
//
// ONE STORE. «Each branch keeps its own stock» (the plan the owner approved), and the sheet counts
// one of them: the file names its branch once, from the list the IT go-live already finds by name.
import { z } from 'zod';
import { CreateItConsumableSchema, ReceiveItConsumableSchema } from '@ecms/contracts';
import { IT_CONSUMABLE_TYPE_CODES } from './consumable-type-defaults';
import { INVENTORY_BRANCHES, foldName } from './inventory-import';

const text = z.string().trim().min(1);

// The register's own limits, taken from the contracts rather than restated: a row the screen would
// refuse is a row the go-live refuses too.
export const ConsumableOpeningItemSchema = z
  .object({
    /** «جرد الأجهزة — Mouse» — the sheet and the column it came from; what the report names it by. */
    key: text,
    /** The item's name in the store — one stock per name in a store. */
    name: CreateItConsumableSchema.shape.name,
    /** The type it is filed under, by code. */
    type: z.enum(IT_CONSUMABLE_TYPE_CODES),
    /** «قطعة». */
    unit: CreateItConsumableSchema.shape.unit,
    /** What the store holds — received once, as the item's opening delivery. */
    qty: ReceiveItConsumableSchema.shape.qty,
  })
  .strict();
export type ConsumableOpeningItem = z.infer<typeof ConsumableOpeningItemSchema>;

export const ConsumablesOpeningFileSchema = z
  .object({
    /** Where the counts came from — the note of every opening movement, so the ledger says. */
    source: ReceiveItConsumableSchema.shape.notes.unwrap().min(1),
    /** The store the counts are in. */
    branch: z.enum(INVENTORY_BRANCHES),
    items: z.array(ConsumableOpeningItemSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const issue = (index: number, field: keyof ConsumableOpeningItem, message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', index, field], message });
    };
    const keys = new Set<string>();
    const names = new Set<string>();
    file.items.forEach((item, index) => {
      if (keys.has(item.key)) issue(index, 'key', `${item.key} appears twice`);
      keys.add(item.key);
      // One stock per item per store — the register's unique name, held before the database is
      // asked, and folded: «Mouse» and «mouse» are one item, never two counts of it.
      const name = foldName(item.name);
      if (names.has(name)) issue(index, 'name', `${item.name} appears twice`);
      names.add(name);
    });
  });
export type ConsumablesOpeningFile = z.infer<typeof ConsumablesOpeningFileSchema>;

export const parseConsumablesOpening = (json: unknown): ConsumablesOpeningFile =>
  ConsumablesOpeningFileSchema.parse(json);

/** An item the store keeps now, as the go-live compares it. */
export interface LiveStoreItem {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

/**
 * The item of each row's name the store already keeps — or null, for an item to add. By the exact
 * name first, then folded (case, spacing, the Arabic letter forms), the earliest added first
 * (`live` comes oldest first).
 *
 * Such an item IS the row's item: the count is received into it, never added beside it. The
 * register keeps one stock per name in a store, and a second «Mouse» would split the shelf's count
 * in two with nobody able to say which half is right.
 */
export const matchStoreItems = (
  items: readonly ConsumableOpeningItem[],
  live: readonly LiveStoreItem[],
): ReadonlyMap<string, LiveStoreItem | null> =>
  new Map(
    items.map((item): [string, LiveStoreItem | null] => [
      item.key,
      live.find((row) => row.name === item.name) ??
        live.find((row) => foldName(row.name) === foldName(item.name)) ??
        null,
    ]),
  );
