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
 * The area after the TO branch was picked: that branch's operations area (`opsAreaName`, legacy
 * `area` — «للعمليات», never `area2`) — main_ops.ejs:520-531. A branch with no area keeps what the
 * box held, as legacy did; the box stays editable either way.
 */
export const areaAfterDestination = (
  branch: { opsAreaName: string | null } | null,
  current: string,
): string => (branch !== null && branch.opsAreaName !== null && branch.opsAreaName.trim() !== ''
  ? branch.opsAreaName
  : current);

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
  // Someone else saved this shipment after it was opened (optimistic lock, 409).
  STALE_DOCUMENT: 'operations.shipment.errors.stale',
};

export const SHIPMENT_SAVE_ERROR_KEYS = Object.values(SAVE_ERRORS);

export const shipmentSaveErrorKey = (error: unknown): string =>
  (error instanceof ApiError ? SAVE_ERRORS[error.code] : undefined) ??
  'operations.shipment.saveFailed';
