// «فحص أجهزة السيارة» — the phone form's rules, kept apart from the page because they are the part
// with a rule in it and the part a node test can reach (docs/12-planning/it-vehicle-checks-design.md
// §2, §6.3): the counts in the bottom bar, the payload, a second tap clearing an answer, the default
// day, the two fields a send cannot go without, and what each answer of the server does to the
// form.
//
// THE REQUEST ID. A report carries a `clientRequestId` made once per report: a send whose answer was
// lost (mobile data, a double tap) is sent again with the SAME id and the server answers with the
// report it already filed. So the id is kept exactly when the outcome is unknown, and replaced
// whenever the server has answered — a refused send filed nothing, and the next one is a new report.
// A held id is also replaced as soon as the report is EDITED (`requestIdAfterEdit`): the edited
// report is another report, and sent under the held id it would only bring the first one back.
import {
  CreateItVehicleCheckSchema,
  IT_VEHICLE_CHECK_ITEMS,
  IT_VEHICLE_CHECK_NOTES_MAX,
  cairoYmd,
  isYmd,
  type CreateItVehicleCheck,
  type ItVehicleCheckAnswer,
  type ItVehicleCheckItem,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { type RequiredField } from '../../../shared/ui/required-fields';

/** Each device's answer; a device left out is unanswered («لم يُفحص»). */
export type VehicleCheckAnswers = Partial<Record<ItVehicleCheckItem, ItVehicleCheckAnswer>>;

/** What the form holds while it is filled — and what the draft keeps (§2 item 8). */
export interface VehicleCheckFormState {
  /** The chosen car's id; '' for none. */
  vehicleId: string;
  /** 'YYYY-MM-DD'; '' when the reporter emptied the box. */
  checkDate: string;
  items: VehicleCheckAnswers;
  notes: string;
  clientRequestId: string;
}

/** «تم فحص n من 11». */
export const VEHICLE_CHECK_TOTAL = IT_VEHICLE_CHECK_ITEMS.length;

/** A fresh UUID — `crypto.randomUUID` where the page is a secure context, built by hand where not. */
export const newClientId = (): string => {
  const crypto = globalThis.crypto;
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // RFC 4122 version 4: the version nibble, then the variant bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** The day the box opens on: today in Cairo, whatever the phone's own time zone. */
export const defaultCheckDate = (now: Date = new Date()): string => cairoYmd(now);

/** A form with nothing in it but the day — the page's first state, and «تقرير لسيارة أخرى». */
export const emptyVehicleCheck = (
  checkDate: string = defaultCheckDate(),
  clientRequestId: string = newClientId(),
): VehicleCheckFormState => ({ vehicleId: '', checkDate, items: {}, notes: '', clientRequestId });

/**
 * A tap on one of a row's two buttons. Tapping the answer already chosen clears it: nothing is
 * mandatory, so an answer given by mistake has to be undoable.
 */
export const answerTapped = (
  items: VehicleCheckAnswers,
  item: ItVehicleCheckItem,
  answer: ItVehicleCheckAnswer,
): VehicleCheckAnswers => {
  if (items[item] === answer) {
    // Unanswered is ABSENT, never a stored null — the draft and the counts read it that way.
    const rest = { ...items };
    delete rest[item];
    return rest;
  }
  return { ...items, [item]: answer };
};

export interface VehicleCheckCounts {
  total: number;
  /** Answered either way. */
  done: number;
  works: number;
  notWorking: number;
  unanswered: number;
}

/**
 * The bar's «تم فحص n من 11 · m لا يعمل», and the sent view's «x يعمل · y لا يعمل» — from the form,
 * or from the filed report, whose unanswered devices are `null`.
 */
export const checkCounts = (
  items: Partial<Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null>>,
): VehicleCheckCounts => {
  let works = 0;
  let notWorking = 0;
  for (const item of IT_VEHICLE_CHECK_ITEMS) {
    if (items[item] === 'works') works += 1;
    else if (items[item] === 'notWorking') notWorking += 1;
  }
  const done = works + notWorking;
  return {
    total: VEHICLE_CHECK_TOTAL,
    done,
    works,
    notWorking,
    unanswered: VEHICLE_CHECK_TOTAL - done,
  };
};

/**
 * What is sent: every device named, an unanswered one as `null`; the note trimmed, and left out
 * when nothing is left of it.
 */
export const vehicleCheckPayload = (state: VehicleCheckFormState): CreateItVehicleCheck => {
  const notes = state.notes.trim().slice(0, IT_VEHICLE_CHECK_NOTES_MAX);
  return {
    vehicleId: state.vehicleId,
    checkDate: state.checkDate,
    items: Object.fromEntries(
      IT_VEHICLE_CHECK_ITEMS.map((item) => [item, state.items[item] ?? null]),
    ) as CreateItVehicleCheck['items'],
    ...(notes === '' ? {} : { notes }),
    clientRequestId: state.clientRequestId,
  };
};

/**
 * The two fields a send cannot go without: the car, and a day (the box can be emptied). Every
 * device may be left unanswered, and the note and the photos are optional.
 */
export const vehicleCheckRequired = (
  state: Pick<VehicleCheckFormState, 'vehicleId' | 'checkDate'>,
  labels: { vehicle: string; date: string },
): RequiredField[] => [
  { key: 'vehicle', label: labels.vehicle, ok: state.vehicleId !== '' },
  { key: 'date', label: labels.date, ok: isYmd(state.checkDate) },
];

/** Is this a UUID the server takes as a request id? The contract's own rule, not a second one. */
export const isClientId = (value: unknown): value is string =>
  CreateItVehicleCheckSchema.shape.clientRequestId.safeParse(value).success;

// ── What a refused send does to the form (§6.3, «Outcomes on the form») ─────────────────────────

/** The toast a failed send shows — each an `it.vehicleCheck.toast.*` key on the page. */
export type VehicleCheckSendToast = 'failed' | 'carGone' | 'carInactive' | 'futureDay';

export interface VehicleCheckSendFailure {
  toast: VehicleCheckSendToast;
  /** Empty the car box (the car is gone, or not active). */
  clearCar: boolean;
  /** Ask for the car list again, so the box stops offering it. */
  refetchCars: boolean;
  /** Put the day back to today in Cairo. */
  resetDay: boolean;
  /**
   * Make a new request id. False only when the outcome is UNKNOWN — no answer, a network error, a
   * 5xx — so that sending again is the same report, not a second one.
   */
  newRequestId: boolean;
}

/** Did the server refuse the day — `checkDate` named among a 400's details? */
const refusedDay = (error: ApiError): boolean =>
  error.status === 400 &&
  (error.details ?? []).some(
    (detail) => detail.field === 'body.checkDate' || detail.field === 'checkDate',
  );

/**
 * The outcome table of §6.3 for a send that did not file, as data. (201 and 200 are the sent view
 * and never reach here.)
 *
 * | the answer                         | toast       | the form            | request id |
 * | no answer, network error, 5xx      | failed      | kept                | KEPT ¹     |
 * | 404 (the car)                      | carGone     | car cleared, refetch | new        |
 * | 422 IT_VEHICLE_NOT_ACTIVE          | carInactive | car cleared, refetch | new        |
 * | 400 on checkDate                   | futureDay   | day back to today   | new        |
 * | 409 IT_VEHICLE_CHECK_REQUEST_REUSED| failed      | kept                | new        |
 *
 * ¹ Until the report is edited: then `requestIdAfterEdit` gives it a new one.
 *
 * Any other refusal (a 4xx the table does not name — a grant taken away, say) is answered as
 * the 409 is: the generic toast, the form kept, and — since the server answered and filed nothing
 * — a new id.
 */
export const vehicleCheckSendFailure = (error: unknown): VehicleCheckSendFailure => {
  const kept = { clearCar: false, refetchCars: false, resetDay: false };
  if (!(error instanceof ApiError) || error.status >= 500) {
    return { toast: 'failed', ...kept, newRequestId: false };
  }
  if (error.status === 404) {
    return {
      toast: 'carGone',
      clearCar: true,
      refetchCars: true,
      resetDay: false,
      newRequestId: true,
    };
  }
  if (error.status === 422 && error.code === 'IT_VEHICLE_NOT_ACTIVE') {
    return {
      toast: 'carInactive',
      clearCar: true,
      refetchCars: true,
      resetDay: false,
      newRequestId: true,
    };
  }
  if (refusedDay(error)) {
    return {
      toast: 'futureDay',
      clearCar: false,
      refetchCars: false,
      resetDay: true,
      newRequestId: true,
    };
  }
  return { toast: 'failed', ...kept, newRequestId: true };
};

/** Would these two bodies file the same report — the same car, day, answers and note? */
const sameReport = (a: CreateItVehicleCheck, b: CreateItVehicleCheck): boolean =>
  a.vehicleId === b.vehicleId &&
  a.checkDate === b.checkDate &&
  (a.notes ?? '') === (b.notes ?? '') &&
  IT_VEHICLE_CHECK_ITEMS.every((item) => (a.items?.[item] ?? null) === (b.items?.[item] ?? null));

/**
 * The request id after an edit (§6.3, the «kept» row). After an unknown outcome the id is HELD, so
 * that sending the same report again is that report. But once the car, the day, an answer or the
 * note differs from what went out under the held id, it is ANOTHER report: sent under that id, the
 * server would answer with the first report — if it was filed — and the edit would be lost without
 * a word. So the edited report gets a new id. A possible duplicate is harmless (several reports a
 * day are allowed, and the latest counts); a silently lost edit is not.
 *
 * `held` is the body that went out under the held id, or `null` when no id is held. An edit that
 * only adds spaces around the note changes nothing that is sent, and keeps the id.
 */
export const requestIdAfterEdit = (
  edited: VehicleCheckFormState,
  held: CreateItVehicleCheck | null,
  newId: () => string,
): VehicleCheckFormState => {
  if (held === null || held.clientRequestId !== edited.clientRequestId) return edited;
  return sameReport(vehicleCheckPayload(edited), held)
    ? edited
    : { ...edited, clientRequestId: newId() };
};

/**
 * The form after a refused send: the table's row applied. The answers and the note are never
 * touched — only the car, the day and the request id move.
 */
export const applySendFailure = (
  state: VehicleCheckFormState,
  failure: VehicleCheckSendFailure,
  { today, newId }: { today: string; newId: () => string },
): VehicleCheckFormState => ({
  ...state,
  vehicleId: failure.clearCar ? '' : state.vehicleId,
  checkDate: failure.resetDay ? today : state.checkDate,
  clientRequestId: failure.newRequestId ? newId() : state.clientRequestId,
});

/** «08/11/2026» — the day as the date box shows it, so the sent view does not read it reversed. */
export const dayShown = (ymd: string): string => ymd.split('-').reverse().join('/');
