// The cassette slot as the settlements collections store it (docs/12-planning/
// atm-settlements-phase1.md §3.1, §4.1, §4.5): one sub-schema for a layout's slots and its versions,
// and one with the plan's notes and bag for a plan line. The shape rules (`layoutIssues`) are
// checked by the save schemas and the services before any write; these only keep a stored slot in
// its declared type.
import { Schema } from 'mongoose';
import {
  ATM_CASSETTE_NOTES_MAX,
  ATM_LAYOUT_SLOTS_MAX,
  ATM_SLOT_KINDS,
  type AtmCassetteSlot,
  type AtmPlanSlot,
} from '@ecms/contracts';

/** No control character in a stored label or name (SEC-14). */
export const NO_CONTROL = /^[^\p{Cc}]*$/u;

const slotFields = {
  slot: { type: Number, required: true, min: 1, max: ATM_LAYOUT_SLOTS_MAX },
  kind: { type: String, required: true, enum: ATM_SLOT_KINDS },
  denomination: { type: Number, default: null },
  currency: { type: String, default: null, match: /^[A-Z]{3}$/ },
} as const;

export const cassetteSlotSchema = new Schema<AtmCassetteSlot>(slotFields, { _id: false });

export const planSlotSchema = new Schema<AtmPlanSlot>(
  {
    ...slotFields,
    notes: { type: Number, required: true, min: 0, max: ATM_CASSETTE_NOTES_MAX },
    bag: { type: Number, default: null, enum: [1, 2, null] },
  },
  { _id: false },
);
