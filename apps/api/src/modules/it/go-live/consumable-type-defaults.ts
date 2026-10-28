// The consumables' types the IT team starts with — the owner's own list: «للمستهلكات زي: حبارات -
// كابلات بأنواعها - كونفرترات (محولات) بأنواعها - ماوس - كيبرود - رامات - هاردات - فلاشات - وهكذا»,
// with «أخرى» for his «وهكذا». Pure: the nine types, where each sits in the catalog's lists, and how
// a type the catalog already holds is recognised. The writing is `consumable-types.ts`; the opening
// stock (`consumables-opening-import.ts`) names the type of each item by one of these codes.
//
// A CODE AND A NAME, BOTH. A seeded row carries a `code`, which is what the opening stock's file
// names a type by: a name the IT team may change on the catalogs page tomorrow is no key for a file
// written today. And a type the IT team already made by hand counts as there whether it carries the
// code or only the Arabic name — seeding a second «كابلات» beside theirs would put both in every
// dropdown (the reason a seed's Arabic is never «corrected», `scripts/check-formal-arabic.mjs`).
import { foldName } from './inventory-import';

export const IT_CONSUMABLE_TYPE_CODES = [
  'ink',
  'cables',
  'adapters',
  'mice',
  'keyboards',
  'memory',
  'storage',
  'flash',
  'other',
] as const;
export type ItConsumableTypeCode = (typeof IT_CONSUMABLE_TYPE_CODES)[number];

/** Each type's names — the plan the owner approved («موافق على اقتراحاتك كلها في المستهلكات»). */
export const IT_CONSUMABLE_TYPE_NAMES: Readonly<
  Record<ItConsumableTypeCode, { ar: string; en: string }>
> = {
  ink: { ar: 'حبارات', en: 'Ink & toner' },
  cables: { ar: 'كابلات', en: 'Cables' },
  adapters: { ar: 'محولات', en: 'Adapters' },
  mice: { ar: 'ماوس', en: 'Mice' },
  keyboards: { ar: 'كيبورد', en: 'Keyboards' },
  memory: { ar: 'رامات', en: 'Memory (RAM)' },
  storage: { ar: 'هاردات', en: 'Storage drives' },
  flash: { ar: 'فلاشات', en: 'Flash drives' },
  other: { ar: 'أخرى', en: 'Other' },
};

/**
 * Where a type sits in the catalog's lists, which are ordered by `sortOrder` (the catalogs page and
 * every type dropdown): the owner's order, «أخرى» last — and in steps of ten, so the IT team can
 * slot a type of their own between two without renumbering the rest.
 */
export const consumableTypeSortOrder = (code: ItConsumableTypeCode): number =>
  (IT_CONSUMABLE_TYPE_CODES.indexOf(code) + 1) * 10;

/** A consumable type as the catalog holds it now. */
export interface LiveConsumableType {
  id: string;
  code: string | null;
  name: { ar: string; en: string };
  isActive: boolean;
}

export type ConsumableTypeMatch =
  | { kind: 'found'; type: LiveConsumableType; by: 'code' | 'name' }
  | { kind: 'inactive'; type: LiveConsumableType; by: 'code' | 'name' }
  | { kind: 'missing' };

/**
 * The live type each of the nine is: by its code, or else by its Arabic name — both folded, so
 * «Cables» is `cables` and «محوّلات» is «محولات».
 *
 * An active row is taken before a retired one, and the code before the name; within each, the
 * earliest the catalog holds (`live` comes oldest first). A retired row is still REPORTED rather
 * than passed over: the seed must not write a twin beside it, and the opening stock must not file
 * items under a type the IT team retired — it refuses instead, as it does for a retired branch.
 */
export const matchConsumableTypes = (
  live: readonly LiveConsumableType[],
): ReadonlyMap<ItConsumableTypeCode, ConsumableTypeMatch> =>
  new Map(
    IT_CONSUMABLE_TYPE_CODES.map((code): [ItConsumableTypeCode, ConsumableTypeMatch] => {
      const byCode = live.filter(
        (type) => type.code !== null && foldName(type.code) === foldName(code),
      );
      const byName = live.filter(
        (type) => foldName(type.name.ar) === foldName(IT_CONSUMABLE_TYPE_NAMES[code].ar),
      );
      const ranked = [
        ...byCode.filter((type) => type.isActive).map((type) => ({ type, by: 'code' as const })),
        ...byName.filter((type) => type.isActive).map((type) => ({ type, by: 'name' as const })),
        ...byCode.map((type) => ({ type, by: 'code' as const })),
        ...byName.map((type) => ({ type, by: 'name' as const })),
      ];
      const [pick] = ranked;
      if (pick === undefined) return [code, { kind: 'missing' }];
      return [code, { kind: pick.type.isActive ? 'found' : 'inactive', ...pick }];
    }),
  );
