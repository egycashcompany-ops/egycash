// The shipment form's rules that do not need a screen — how the banks follow each other, where the
// area comes from, and what a refused save says. Pure, so each one is pinned in a spec.
//
// THE THREE BANKS (legacy main_ops.ejs:405-433, as the owner described it):
//   · البنك الرئيسي — the bank BILLED for the shipment. Stored as `mainBankId`; every per-bank
//     roll-up keys on it (legacy /ops_bank_report, /vault1; ECMS reports).
//   · the FROM bank — whose branch the money is collected from. Legacy's `fromBankSelect` only
//     filtered the from-branch list and was never posted, so it is not stored: the origin branch
//     carries its own bank.
//   · the TO bank — whose branch it is delivered to. Stored as `secondaryBankId` when it differs
//     from the main bank (legacy `sec_bank`), null when it is the main bank.
import { ErrorCodes, isYmd, type OperationsShipmentType } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';

/**
 * A side's bank after the MAIN bank changed. Legacy reset both side selects to the new main bank
 * (main_ops.ejs:505-517); that also threw away a side the operator had deliberately set to another
 * bank. Here a side FOLLOWS the main bank only while it was following it — empty, or equal to the
 * old main bank — and a deliberate choice survives.
 */
export const followMainBank = (side: string, previousMain: string, nextMain: string): string =>
  side === '' || side === previousMain ? nextMain : side;

/**
 * What `secondaryBankId` carries: the TO bank only when it is not the main bank. Null means "the
 * main bank", which is how every shipment written so far reads (and what `isCrossBank` tests).
 */
export const secondaryBankFor = (mainBankId: string, toBankId: string): string | null =>
  toBankId === '' || toBankId === mainBankId ? null : toBankId;

/**
 * The shipment's area: the TO branch's operations area (`opsAreaName`, legacy `area` — «للعمليات»,
 * never `area2`; main_ops.ejs:520-531). «عاوز المنطقة ميقدر يكتب»: it is not typed, so it follows
 * the branch exactly — a branch with no area, or no branch, means no area, never the area of the
 * branch picked before it (legacy kept that only because its box was editable).
 */
export const areaOfDestination = (branch: { opsAreaName: string | null } | null): string =>
  branch?.opsAreaName?.trim() ?? '';

/**
 * A SHIPMENT'S DATES HAVE A FLOOR — «مينفعش لما يجى يضيف شحنه يختار تاريخ فات», and for an edit
 * «ميقدرش يحدد يوم قبل يوم اللى كانت عليه الشحنة»:
 *
 *   · a NEW date is today or later — today in Cairo, the desk's day, never the browser's or UTC's
 *     (which is still yesterday for the first hours after a Cairo midnight);
 *   · an EDIT may keep the day a date was on, or move it later, but never earlier. A shipment from
 *     last week stays editable on its own day: the floor is ITS day, not today.
 *
 * The collection date, and a secured shipment's delivery date alike — the server holds both to it.
 * `held` is the date as stored on the shipment being edited ('YYYY-MM-DD'), or null: a new
 * shipment, or a delivery date being set for the first time, which is a new date. The server
 * refuses the same (`OPERATIONS_SHIPMENT_DATE_IN_PAST`, `OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL`);
 * the form's date boxes do not offer an earlier day, and a day typed earlier is said in words
 * before anything is sent.
 */
export const earliestShipmentDate = (held: string | null, today: string): string => held ?? today;

export type ShipmentDateProblem = 'inPast' | 'beforeOriginal' | 'beforeCollection';

/**
 * Why `value` cannot be the date, or null when it can. An empty or half-typed date is not this
 * rule's to refuse — the required-field check names an empty collection date, a secured
 * shipment's delivery date may stay empty, and there is nothing to compare until a whole day is
 * there. Days compare as 'YYYY-MM-DD' strings.
 */
export const shipmentDateProblem = (
  value: string,
  held: string | null,
  today: string,
): ShipmentDateProblem | null => {
  if (!isYmd(value)) return null;
  if (held === null) return value < today ? 'inPast' : null;
  return value < held ? 'beforeOriginal' : null;
};

/** What each problem says — the same words as the server's refusal of it (`SAVE_ERRORS`). */
export const SHIPMENT_DATE_PROBLEM_KEY: Record<ShipmentDateProblem, string> = {
  inPast: 'operations.shipment.errors.dateInPast',
  beforeOriginal: 'operations.shipment.errors.dateBeforeOriginal',
  beforeCollection: 'operations.shipment.errors.deliveryBeforeCollection',
};

/** The day after a 'YYYY-MM-DD' day, as 'YYYY-MM-DD' — '' for anything that is not a whole day. */
export const nextDay = (day: string): string => {
  if (!isYmd(day)) return '';
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * A NEW محصنة's delivery date — «تاريخ التسليم تانى يوم الاستلام افتراضى وممكن يغير»: the day
 * after its collection, until the person picks another. The server stores what it is sent; the
 * default is the form's alone. '' while the collection date is not a whole day yet.
 */
export const defaultDeliveryDate = (collectionDate: string): string => nextDay(collectionDate);

/**
 * The delivery date after the COLLECTION date changed, on a new محصنة. It FOLLOWS the collection
 * date while it is still that date's default (or empty — the collection box was half-typed): the
 * person has not chosen it, so moving the collection moves it with it. A delivery date the person
 * chose survives — as a side's bank survives the main bank changing (`followMainBank`); if it now
 * falls before the collection, the box says so (`deliveryDateProblem`).
 */
export const followCollectionDate = (
  delivery: string,
  previousCollection: string,
  nextCollection: string,
): string =>
  delivery === '' || delivery === defaultDeliveryDate(previousCollection)
    ? defaultDeliveryDate(nextCollection)
    : delivery;

/**
 * Why `delivery` cannot be a secured shipment's delivery date, or null when it can. The floor
 * first, as the server checks it first (`shipmentDateProblem` — not before today for a first
 * delivery date, not before the day it was on for an edit); then the ORDER — never before the
 * collection date, the same day allowed (`OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION`).
 *
 * `held` is the two dates as stored on the shipment being edited ('YYYY-MM-DD'; the delivery null
 * when it had none), or null for a new one. An edit that leaves both dates as they were is not
 * refused for an order it did not make — a row stored the wrong way round (legacy never checked)
 * still takes a notes fix, exactly as the server judges it.
 */
export const deliveryDateProblem = (
  delivery: string,
  collection: string,
  held: { delivery: string | null; collection: string } | null,
  today: string,
): ShipmentDateProblem | null => {
  const floor = shipmentDateProblem(delivery, held?.delivery ?? null, today);
  if (floor !== null) return floor;
  if (!isYmd(delivery) || !isYmd(collection)) return null;
  if (held !== null && delivery === held.delivery && collection === held.collection) return null;
  return delivery < collection ? 'beforeCollection' : null;
};

/**
 * The earliest day a secured shipment's delivery-date box offers: the later of its floor
 * (`earliestShipmentDate`) and the collection date — the calendar offers no day the save would be
 * refused for. The collection date counts only once it is a whole day.
 */
export const deliveryDateMin = (floor: string, collectionDate: string): string =>
  isYmd(collectionDate) && collectionDate > floor ? collectionDate : floor;

/**
 * Must the form have a delivery date? For a NEW محصنة, yes — «تاريخ التسليم» opens filled in and
 * is what puts it on a day's dispatch list. Not for a daily shipment, which has none. And not for
 * an edit of an old محصنة stored WITHOUT one (legacy never required it, receive_mohsana.ejs:644):
 * a notes fix must not force a date invented to get past the form, which would put the shipment
 * on that day's dispatch list. One that has a delivery date cannot have it emptied.
 */
export const deliveryDateRequired = (
  shipmentType: OperationsShipmentType,
  heldDelivery: string | null,
  creating: boolean,
): boolean => shipmentType === 'secured' && (creating || heldDelivery !== null);

/**
 * The i18n key for a refused save, by the server's code — so an Arabic desk reads why, in Arabic,
 * instead of the server's English sentence. Unknown codes fall back to the generic message.
 */
const SAVE_ERRORS: Record<string, string> = {
  OPERATIONS_BRANCH_BANK_MISMATCH: 'operations.shipment.errors.branchBank',
  OPERATIONS_UNKNOWN_BRANCH: 'operations.shipment.errors.unknownBranch',
  OPERATIONS_UNKNOWN_BANK: 'operations.shipment.errors.unknownBank',
  OPERATIONS_UNKNOWN_CURRENCY: 'operations.shipment.errors.unknownCurrency',
  OPERATIONS_CREW_DAY_MISMATCH: 'operations.shipment.errors.crewDay',
  OPERATIONS_CREW_CAPTAIN_MISMATCH: 'operations.shipment.errors.crewCaptain',
  // A date's floor (`shipmentDateProblem`): the form says it first, but the server's clock is the
  // one that counts — a browser whose clock runs behind is refused here.
  OPERATIONS_SHIPMENT_DATE_IN_PAST: SHIPMENT_DATE_PROBLEM_KEY.inPast,
  OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL: SHIPMENT_DATE_PROBLEM_KEY.beforeOriginal,
  OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION: SHIPMENT_DATE_PROBLEM_KEY.beforeCollection,
  // Someone else saved this shipment after it was opened (optimistic lock, 409).
  STALE_DOCUMENT: 'operations.shipment.errors.stale',
  // Round 10: the vault received this محصنة after the form was opened — «ميقدر حد … يعدل عليها».
  // The board offers no edit on a locked row (`isLockedRow`), so only a stale row reaches this.
  OPERATIONS_SECURED_LOCKED: 'operations.shipment.errors.locked',
  // Round 12: a محصنة on a van whose delivery date this edit moves to another day (or clears) — and
  // its captain has already started that delivery in the app, so the server will not take the stop
  // off his van. Nothing is wrong with the values themselves; the date has to stay where it is.
  OPERATIONS_DISTRIBUTION_LEG_STARTED: 'operations.shipment.errors.legStarted',
};

export const SHIPMENT_SAVE_ERROR_KEYS = Object.values(SAVE_ERRORS);

/**
 * Refusals that have nothing to do with the values typed: no connection, no permission, a session
 * that ended, a server fault. «راجع القيم» would send the operator to re-check good values, so for
 * these the caller says the actual reason (`errorMessage`, which words each of them in both
 * languages). A fetch that never reached the server throws a bare `TypeError`.
 */
const NOT_ABOUT_THE_VALUES = new Set([
  'NETWORK',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL',
  'PAYLOAD_TOO_LARGE',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_TOKEN_INVALID',
  'UNAUTHENTICATED',
  'AUTH_SESSION_REVOKED',
]);

const isAboutSomethingElse = (error: unknown): boolean =>
  error instanceof TypeError || (error instanceof ApiError && NOT_ABOUT_THE_VALUES.has(error.code));

/**
 * The vault received this محصنة after the form was opened (Round 10, `OPERATIONS_SECURED_LOCKED`):
 * nothing typed can be saved past it, so the form says why and closes, and the board is re-read.
 */
export const isLockedRefusal = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCodes.OPERATIONS_SECURED_LOCKED;

/**
 * The i18n key for a refused shipment save, or `null` when the refusal is not about the values —
 * then the caller shows `errorMessage(error, locale)`.
 */
export const shipmentSaveErrorKey = (error: unknown): string | null => {
  const known = error instanceof ApiError ? SAVE_ERRORS[error.code] : undefined;
  if (known !== undefined) return known;
  return isAboutSomethingElse(error) ? null : 'operations.shipment.saveFailed';
};

/**
 * The same for the branch form — reached from the catalogs AND from the shipment form's «+ إضافة».
 * A branch's name and its code are each unique within its bank, deactivated branches included, and
 * the shipment form searches ACTIVE branches only: a name that "does not exist" there may belong to
 * a deactivated branch. The duplicate refusal says so, instead of «راجع القيم».
 */
export const BRANCH_DUPLICATE_KEY = 'operations.catalogs.branch.duplicate';

export const branchSaveErrorKey = (error: unknown): string | null => {
  // E11000 on `ux_bank_name` / `ux_bank_code` (base.repository.ts → ConflictError DUPLICATE).
  if (error instanceof ApiError && error.code === 'DUPLICATE') return BRANCH_DUPLICATE_KEY;
  return isAboutSomethingElse(error) ? null : 'operations.catalogs.saveFailed';
};
