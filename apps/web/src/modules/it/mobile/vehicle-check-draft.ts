// The vehicle check's draft — what a phone gives back after it unloaded the tab while its camera
// app was open (docs/12-planning/it-vehicle-checks-design.md §2 item 8, §6.3).
//
// WHERE. The tab's `sessionStorage`, through Fleet's `writeDraft` / `clearDraft` (the roster boards'
// helpers): it survives exactly a reload of this tab, and dies with it. A draft is not a saved
// report: nothing here talks to the API, and the server's report remains the only filed state.
//
// WHAT. The car, the day, the answers, the note and the report's request id. The request id is kept
// so that a send whose answer was lost, sent again after the reload, is the same report. Photos are
// NOT kept: they are too big for this storage, and the reporter takes them again.
//
// READ. With this file's own guarded reader (Fleet's is shaped for the roster's rows), and every
// field taken only when it is valid: a draft written by an older build, or edited by hand, puts the
// form back in a state it could have been in, never one the server would refuse.
//
// This is the ONE file of the phone screens allowed to touch browser storage
// (`it-mobile-quality.spec.tsx`).
import {
  CreateItVehicleCheckSchema,
  IT_VEHICLE_CHECK_ANSWERS,
  IT_VEHICLE_CHECK_ITEMS,
  IT_VEHICLE_CHECK_NOTES_MAX,
  isYmd,
  type ItVehicleCheckAnswer,
} from '@ecms/contracts';
import { clearDraft, writeDraft } from '../../fleet/lib/draft-storage';
import {
  isClientId,
  type VehicleCheckAnswers,
  type VehicleCheckFormState,
} from '../lib/vehicle-check-form';

/** The draft's key. `.v1`: a later shape takes a new key rather than misreading this one. */
export const VEHICLE_CHECK_DRAFT_KEY = 'ecms.it.vehicleCheck.draft.v1';

/** What is stored: the form, the chosen car's code (shown before the car list arrives), and `v`. */
export interface VehicleCheckDraft extends VehicleCheckFormState {
  v: 1;
  /** The chosen car's code as the box showed it; '' with no car. */
  vehicleCode: string;
}

export const writeVehicleCheckDraft = (state: VehicleCheckFormState, vehicleCode: string): void => {
  const draft: VehicleCheckDraft = {
    v: 1,
    vehicleId: state.vehicleId,
    vehicleCode: state.vehicleId === '' ? '' : vehicleCode,
    checkDate: state.checkDate,
    items: state.items,
    notes: state.notes,
    clientRequestId: state.clientRequestId,
  };
  writeDraft(VEHICLE_CHECK_DRAFT_KEY, draft);
};

/** Cleared once the report is sent, and by «تقرير لسيارة أخرى». */
export const clearVehicleCheckDraft = (): void => clearDraft(VEHICLE_CHECK_DRAFT_KEY);

/**
 * Is there anything to keep? A form that holds only today and a fresh request id is the form the
 * page opens on anyway; writing it would only leave a draft nobody filled in.
 */
export const draftWorthKeeping = (state: VehicleCheckFormState, today: string): boolean =>
  state.vehicleId !== '' ||
  Object.keys(state.items).length > 0 ||
  state.notes !== '' ||
  state.checkDate !== today;

/** Guarded like every storage read here: private mode, or a full disk, must not break the form. */
const readStored = (): unknown => {
  try {
    const raw = window.sessionStorage.getItem(VEHICLE_CHECK_DRAFT_KEY);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    // Storage unavailable, or non-JSON under the key: the form starts empty, as it always did.
    return null;
  }
};

const ANSWERS: readonly string[] = IT_VEHICLE_CHECK_ANSWERS;

/** Only the eleven devices, and only the two answers; anything else is unanswered. */
const itemsOf = (value: unknown): VehicleCheckAnswers => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const stored = value as Record<string, unknown>;
  const items: VehicleCheckAnswers = {};
  for (const item of IT_VEHICLE_CHECK_ITEMS) {
    const answer = stored[item];
    if (typeof answer === 'string' && ANSWERS.includes(answer)) {
      items[item] = answer as ItVehicleCheckAnswer;
    }
  }
  return items;
};

const isCarId = (value: unknown): value is string =>
  CreateItVehicleCheckSchema.shape.vehicleId.safeParse(value).success;

/**
 * The stored draft, every field checked — or `null` when there is none, it is not JSON, it is not
 * an object, or its `v` is not 1. Field by field, what is not valid is dropped rather than the
 * whole draft:
 *  • a car id that is not an id → no car;
 *  • an item outside the eleven, or an answer outside the two → unanswered;
 *  • a day that is not a calendar day, or is after `today` → `today`;
 *  • a note that is not text → none; a longer one is cut to 1000;
 *  • a request id that is not a UUID → a new one.
 */
export const readVehicleCheckDraft = ({
  today,
  newId,
}: {
  today: string;
  newId: () => string;
}): VehicleCheckDraft | null => {
  const stored = readStored();
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const draft = stored as Record<string, unknown>;
  if (draft.v !== 1) return null;
  const vehicleId = isCarId(draft.vehicleId) ? draft.vehicleId : '';
  const vehicleCode =
    vehicleId !== '' && typeof draft.vehicleCode === 'string' ? draft.vehicleCode : '';
  const day = draft.checkDate;
  const checkDate = typeof day === 'string' && isYmd(day) && day <= today ? day : today;
  const notes =
    typeof draft.notes === 'string' ? draft.notes.slice(0, IT_VEHICLE_CHECK_NOTES_MAX) : '';
  const clientRequestId = isClientId(draft.clientRequestId) ? draft.clientRequestId : newId();
  return {
    v: 1,
    vehicleId,
    vehicleCode,
    checkDate,
    items: itemsOf(draft.items),
    notes,
    clientRequestId,
  };
};

/**
 * Once the car list is in: a restored car that is no longer on it (taken out of service, disposed of
 * since) is cleared, and the report gets a new request id — the next send is for another car, so it
 * is another report. A form with no car, or a car still on the list, comes back unchanged.
 */
export const reconcileDraftCar = <S extends VehicleCheckFormState>(
  state: S,
  activeCarIds: ReadonlySet<string>,
  newId: () => string,
): S =>
  state.vehicleId === '' || activeCarIds.has(state.vehicleId)
    ? state
    : { ...state, vehicleId: '', clientRequestId: newId() };
