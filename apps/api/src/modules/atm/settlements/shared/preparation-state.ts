// What a line's preparation requires and how far it got (DS-13, DS-16;
// docs/12-planning/atm-settlements-phase1.md §6.5 "preparationStatus", §6.8 P4).
//
// A bag needs its QR unless every cassette in it holds 0 notes (`bagNeedsQr`); a bagged cassette
// needs its seal when it holds notes. Missing is not duplicate: duplicates never block, a missing
// required value does (P4 → 422 `ATM_PREPARATION_INCOMPLETE`).
import { bagNeedsQr, type AtmPreparationStatus } from '@ecms/contracts';
import { type AtmLinePreparationDoc } from '../preparation/line-preparation.model';

type PrepFields = Pick<AtmLinePreparationDoc, 'bags' | 'seals' | 'status'>;
type SlotNotes = readonly { slot: number; notes: number }[];

const notesOf = (slots: SlotNotes, slot: number): number =>
  slots.find((s) => s.slot === slot)?.notes ?? 0;

export const bagRequired = (bag: { slots: readonly number[] }, slots: SlotNotes): boolean =>
  bagNeedsQr(bag, slots);

export const sealRequired = (slot: number, slots: SlotNotes): boolean => notesOf(slots, slot) > 0;

/** The required fields with no value, in form order: `bags[i].qr` and `seals[slot=n]`. */
export const requiredMissing = (prep: PrepFields, slots: SlotNotes): string[] => [
  ...prep.bags.flatMap((bag, i) =>
    bagRequired(bag, slots) && bag.qr === null ? [`bags[${String(i)}].qr`] : [],
  ),
  ...prep.seals.flatMap((seal) =>
    sealRequired(seal.slot, slots) && seal.value === null
      ? [`seals[slot=${String(seal.slot)}]`]
      : [],
  ),
];

/** `{ captured, required }`: the required fields, and how many of them hold a value. */
export const preparationProgress = (
  prep: PrepFields,
  slots: SlotNotes,
): { captured: number; required: number } => {
  let required = 0;
  let captured = 0;
  for (const bag of prep.bags) {
    if (!bagRequired(bag, slots)) continue;
    required += 1;
    if (bag.qr !== null) captured += 1;
  }
  for (const seal of prep.seals) {
    if (!sealRequired(seal.slot, slots)) continue;
    required += 1;
    if (seal.value !== null) captured += 1;
  }
  return { captured, required };
};

/** Whether any field — required or not — holds a value. */
export const holdsAnyValue = (prep: Pick<AtmLinePreparationDoc, 'bags' | 'seals'>): boolean =>
  prep.bags.some((b) => b.qr !== null) || prep.seals.some((s) => s.value !== null);

/** §6.5: no value → none, some → partial, every required value → complete; prepared when it is. */
export const preparationStatusOf = (prep: PrepFields, slots: SlotNotes): AtmPreparationStatus => {
  if (prep.status === 'prepared') return 'prepared';
  if (!holdsAnyValue(prep)) return 'none';
  return requiredMissing(prep, slots).length === 0 ? 'complete' : 'partial';
};
