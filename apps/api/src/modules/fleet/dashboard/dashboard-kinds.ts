// «نقل أموال» / «ATM» — which catalog items the dashboard's cash and ATM figures mean (T3.5–T3.8).
//
// MOVED UNCHANGED from the old landing service (`dashboard.service.ts`, P1-13): the same name test,
// now taking the catalog it reads instead of closing over it, so R1 can ask it of the items it
// loaded once. The ids it picks are what the links carry (`?operation=`, `?spec=`), so a figure and
// its screen read the same items.
import { type LocalizedString } from '@ecms/contracts';

/** A catalog row as far as the test reads it. */
export interface KindItem {
  _id: unknown;
  name: Partial<LocalizedString>;
}

export type FleetKind = 'cash' | 'atm';

/**
 * «نقل أموال» and «ATM» are OPERATIONS in the catalog, matched by the catalog's own Arabic name
 * rather than by an id hardcoded here: ids differ per environment, and a house that renames the
 * operation renames the counter with it.
 */
export const operationKind = (
  operations: readonly KindItem[],
  id: string | null,
): FleetKind | null => {
  if (id === null) return null;
  const item = operations.find((o) => String(o._id) === id);
  if (item === undefined) return null;
  const ar = item.name.ar ?? '';
  const en = (item.name.en ?? '').toLowerCase();
  if (ar.includes('نقل') || en.includes('cash')) return 'cash';
  if (ar.toUpperCase().includes('ATM') || en.includes('atm')) return 'atm';
  return null;
};

/**
 * The same question on the DRIVER side, and the same kind of answer.
 *
 * «التخصص» is a `driverSpecialization` catalog, so the split reads the catalog's own name exactly
 * as the operation split above does — «نقل اموال» counts as cash, «ATM» as ATM, and a house's own
 * additions («ملاكى», «سزوكى») count as neither. A profile nobody has re-classified still carries
 * the legacy enum, and that is read as a second chance rather than as nothing.
 */
export const specializationKind = (
  specializations: readonly KindItem[],
  id: string | null | undefined,
  legacy: string | null | undefined,
): FleetKind | null => {
  // `== null`, not `=== null`: a profile written before the field existed has no key at all and
  // arrives as `undefined`, which would otherwise be looked up and silently match nothing.
  const item = id == null ? undefined : specializations.find((s) => String(s._id) === id);
  if (item !== undefined) {
    const ar = item.name.ar ?? '';
    const en = (item.name.en ?? '').toLowerCase();
    if (ar.includes('نقل') || en.includes('cash')) return 'cash';
    if (ar.toUpperCase().includes('ATM') || en.includes('atm')) return 'atm';
    return null;
  }
  if (legacy === 'cashTransport') return 'cash';
  if (legacy === 'atm') return 'atm';
  return null;
};

/** The ids of the catalog items of one kind, in catalog order — what a link's list carries. */
export const idsOfKind = (
  items: readonly KindItem[],
  kind: FleetKind,
  kindOf: (items: readonly KindItem[], id: string) => FleetKind | null,
): string[] => items.map((item) => String(item._id)).filter((id) => kindOf(items, id) === kind);
