// Doc → DTO mapping for the Gold module.
//
// Two things are worth knowing before reading this file.
//
// First, DISPLAY NAMES arrive as a `labels` bag rather than being looked up here. A gold list
// renders the owner, the branch and the delegate for every row, and resolving those per row would
// turn one page into forty queries; each service resolves them once for the whole page and hands
// the map down (the IT-6 batch-lookup discipline).
//
// Second, a receipt's SNAPSHOT names (`teamLeaderName`, `supervisor1Name`, `vehicleNumber`) are
// read straight off the document and never re-resolved. They were captured when the document was
// written precisely so that a printed receipt keeps saying what it said.
import { Types } from 'mongoose';
import {
  type GoldBarDto,
  type GoldBarHistoryEntryDto,
  type GoldBarLineDto,
  type GoldCompanyDto,
  type GoldDeliveryReceiptDto,
  type GoldDrawerDto,
  type GoldFloorDto,
  type GoldKeyHandoverDto,
  type GoldReceivingLineDto,
  type GoldReceivingReceiptDto,
  type GoldRepresentativeDto,
  type GoldTransferDto,
  type GoldVaultDto,
} from '@ecms/contracts';
import { type GoldCompanyDoc } from './companies/company.model';
import { type GoldRepresentativeDoc } from './representatives/representative.model';
import { type GoldFloorDoc } from './floors/floor.model';
import { type GoldVaultDoc } from './vaults/vault.model';
import { type GoldDrawerDoc } from './vaults/drawer.model';
import { type GoldBarDoc, type GoldBarHistorySub } from './bars/bar.model';
import {
  type GoldReceivingLineSub,
  type GoldReceivingReceiptDoc,
} from './receiving/receiving-receipt.model';
import { type GoldDeliveryReceiptDoc } from './delivery/delivery-receipt.model';
import { type GoldTransferDoc } from './transfers/transfer.model';
import { type GoldKeyHandoverDoc } from './keys/key-handover.model';

/**
 * Whatever the row holds, as a Date — or nothing.
 *
 * `.lean()` does NOT cast: it hands back the raw BSON value, so a field the schema calls a `Date`
 * is a Date only if whoever WROTE the row made it one. A row written by this API always did; a row
 * from a migration or a restored dump commonly holds the ISO STRING instead, and `"2024-03-01"`
 * has no `.toISOString()`. Guarding for absence alone therefore closes half the door — which is
 * why this checks the type rather than the presence.
 *
 * A parseable string or epoch number is not a fallback, it is the same instant written another
 * way, so it is read as the date it is. Anything genuinely unusable becomes null and the caller
 * decides what that means.
 */
const asDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

/**
 * Whatever the row holds, as a list — or an empty one.
 *
 * `default: []` is applied on WRITE, so it says nothing about a row that reached the collection
 * another way, and `.lean()` returns the raw value. Same lesson as the dates: guard the TYPE, not
 * the presence — `?? []` still hands a stored STRING to `.map`.
 */
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/**
 * A BUSINESS date — the date on the paper, not on the row.
 *
 * Deliberately NOT resolved from the `_id` the way the audit timestamps are. A receipt's own date
 * has no true substitute, and a printed receipt carrying a date the system invented is worse than
 * one carrying none. So a row that lost its date renders with the cell EMPTY: visibly wrong, easy
 * to find, impossible to mistake for a fact — and the eleven good rows beside it still render.
 */
const iso = (d: unknown): string => asDate(d)?.toISOString() ?? '';

/**
 * The audit timestamps, read from the row itself.
 *
 * `timestamps: true` writes `createdAt` and `updatedAt` on everything this API creates, which is
 * why the DTOs type them as always present — and why the mappers used to dereference them
 * unguarded. A row that reached the collection any OTHER way (a migration, a restored dump, a
 * hand-inserted fixture) may not carry them, and one such row took down the entire page with a
 * 500: twelve good rows hidden, and an error that names nothing.
 *
 * The ObjectId's embedded timestamp is not a substitute value invented to paper over the gap — it
 * IS when that document was created, recorded by the driver in the `_id` itself. So the page
 * renders, the date is right, and the malformed row is visible instead of fatal.
 */
type Stamped = { _id: unknown; createdAt?: unknown; updatedAt?: unknown };

/** The creation instant the driver stamped into the `_id`, whether it arrived as an id or a string. */
const bornAt = (id: unknown): Date => {
  if (id instanceof Types.ObjectId) return id.getTimestamp();
  if (typeof id === 'string' && Types.ObjectId.isValid(id)) {
    return new Types.ObjectId(id).getTimestamp();
  }
  return new Date(0);
};

const createdIso = (doc: Stamped): string =>
  (asDate(doc.createdAt) ?? bornAt(doc._id)).toISOString();

const updatedIso = (doc: Stamped): string =>
  (asDate(doc.updatedAt) ?? asDate(doc.createdAt) ?? bornAt(doc._id)).toISOString();
export const isoOrNull = (d: unknown): string | null => asDate(d)?.toISOString() ?? null;
const id = (v: { toString: () => string } | null | undefined): string | null =>
  v === null || v === undefined ? null : String(v);

/** Display names resolved once per page and shared by every row that needs them. */
export interface GoldLabels {
  branches?: Map<string, string>;
  companies?: Map<string, string>;
  representatives?: Map<string, string>;
  floors?: Map<string, string>;
  vaults?: Map<string, string>;
  drawerNumbers?: Map<string, number>;
  users?: Map<string, string>;
}

const look = (map: Map<string, string> | undefined, key: string | null): string | null =>
  key === null ? null : (map?.get(key) ?? null);

export const toGoldCompanyDto = (doc: GoldCompanyDoc): GoldCompanyDto => ({
  id: String(doc._id),
  name: doc.name,
  logoFileId: id(doc.logoFileId),
  type: doc.type,
  phone: doc.phone,
  email: doc.email,
  status: doc.status,
  notes: doc.notes,
  version: doc.__v,
  createdAt: createdIso(doc),
  updatedAt: updatedIso(doc),
});

export const toGoldRepresentativeDto = (
  doc: GoldRepresentativeDoc,
  labels: GoldLabels = {},
): GoldRepresentativeDto => ({
  id: String(doc._id),
  companyId: String(doc.companyId),
  companyName: look(labels.companies, String(doc.companyId)),
  fullName: doc.fullName,
  nationalId: doc.nationalId,
  phone: doc.phone,
  jobTitle: doc.jobTitle,
  joinDate: isoOrNull(doc.joinDate),
  status: doc.status,
  notes: doc.notes,
  version: doc.__v,
  createdAt: createdIso(doc),
  updatedAt: updatedIso(doc),
});

export const toGoldFloorDto = (doc: GoldFloorDoc, labels: GoldLabels = {}): GoldFloorDto => ({
  id: String(doc._id),
  name: doc.name,
  order: doc.order,
  branchId: id(doc.branchId),
  branchName: look(labels.branches, id(doc.branchId)),
  version: doc.__v,
  createdAt: createdIso(doc),
  updatedAt: updatedIso(doc),
});

export const toGoldVaultDto = (
  doc: GoldVaultDoc,
  drawerCount: number,
  labels: GoldLabels = {},
): GoldVaultDto => ({
  id: String(doc._id),
  name: doc.name,
  code: doc.code,
  description: doc.description,
  status: doc.status,
  // Nullish, not `=== null`: a row whose `layout` key is absent altogether is the same "no layout
  // yet" this already knows how to render, and reading `.rows` off it instead blanks the board.
  layout:
    doc.layout === null || doc.layout === undefined
      ? null
      : {
          rows: doc.layout.rows,
          cols: doc.layout.cols,
          orientation: doc.layout.orientation,
          horizontalDirection: doc.layout.horizontalDirection,
          verticalDirection: doc.layout.verticalDirection,
          startNumber: doc.layout.startNumber,
          drawerWeightLimit: doc.layout.drawerWeightLimit,
        },
  drawersGenerated: doc.drawersGenerated,
  floorId: id(doc.floorId),
  floorName: look(labels.floors, id(doc.floorId)),
  order: doc.order,
  branchId: id(doc.branchId),
  branchName: look(labels.branches, id(doc.branchId)),
  drawerCount,
  version: doc.__v,
  createdAt: createdIso(doc),
  updatedAt: updatedIso(doc),
});

export const toGoldDrawerDto = (
  doc: GoldDrawerDoc,
  companies: GoldDrawerDto['companies'] = [],
): GoldDrawerDto => ({
  id: String(doc._id),
  vaultId: String(doc.vaultId),
  branchId: id(doc.branchId),
  row: doc.row,
  col: doc.col,
  number: doc.number,
  label: doc.label,
  status: doc.status,
  barsCount: doc.barsCount,
  totalWeight: doc.totalWeight,
  weightLimit: doc.weightLimit,
  companies,
});

const toHistoryDto = (entry: GoldBarDoc['history'][number]): GoldBarHistoryEntryDto => ({
  action: entry.action,
  fromVaultId: id(entry.fromVaultId),
  fromDrawerId: id(entry.fromDrawerId),
  toVaultId: id(entry.toVaultId),
  toDrawerId: id(entry.toDrawerId),
  reference: entry.reference,
  byUserId: id(entry.byUserId),
  at: iso(entry.at),
  notes: entry.notes,
});

export const toGoldBarHistoryDto = (doc: GoldBarDoc): GoldBarHistoryEntryDto[] =>
  asArray<GoldBarHistorySub>(doc.history).map(toHistoryDto);

export const toGoldBarDto = (doc: GoldBarDoc, labels: GoldLabels = {}): GoldBarDto => {
  const drawerId = id(doc.currentDrawerId);
  return {
    id: String(doc._id),
    serialNumber: doc.serialNumber,
    companyId: id(doc.companyId),
    companyName: look(labels.companies, id(doc.companyId)),
    parentCompanyId: id(doc.parentCompanyId),
    branchId: id(doc.branchId),
    branchName: look(labels.branches, id(doc.branchId)),
    metalType: doc.metalType,
    brand: doc.brand,
    purity: doc.purity,
    weight: doc.weight,
    sealed: doc.sealed,
    weightBeforeSeal: doc.weightBeforeSeal,
    weightAfterSeal: doc.weightAfterSeal,
    currentVaultId: id(doc.currentVaultId),
    currentVaultCode: look(labels.vaults, id(doc.currentVaultId)),
    currentDrawerId: drawerId,
    currentDrawerNumber: drawerId === null ? null : (labels.drawerNumbers?.get(drawerId) ?? null),
    status: doc.status,
    notes: doc.notes,
    version: doc.__v,
    createdAt: createdIso(doc),
    updatedAt: updatedIso(doc),
  };
};

export const toGoldBarLineDto = (doc: GoldBarDoc): GoldBarLineDto => ({
  id: String(doc._id),
  serialNumber: doc.serialNumber,
  weight: doc.weight,
  metalType: doc.metalType,
  brand: doc.brand,
  purity: doc.purity,
});

/**
 * One bar line on a receiving receipt.
 *
 * The line is read defensively for the same reason the row is: a receipt carrying one unreadable
 * line is still a receipt the register has to list, and the twelve rows around it should not
 * disappear because a migration wrote one sub-document badly.
 */
const toReceivingLineDto = (
  line: Partial<GoldReceivingReceiptDoc['lines'][number]> | null | undefined,
  labels: GoldLabels,
): GoldReceivingLineDto => {
  const cell = line ?? {};
  const drawerId = id(cell.drawerId);
  return {
    serialNumber: cell.serialNumber ?? '',
    metalType: cell.metalType ?? 'gold',
    purity: cell.purity ?? null,
    weight: cell.weight ?? 0,
    brand: cell.brand ?? null,
    weightBeforePacking: cell.weightBeforePacking ?? null,
    weightAfterPacking: cell.weightAfterPacking ?? null,
    vaultId: id(cell.vaultId),
    vaultCode: look(labels.vaults, id(cell.vaultId)),
    drawerId,
    drawerNumber: drawerId === null ? null : (labels.drawerNumbers?.get(drawerId) ?? null),
  };
};

export const toGoldReceivingReceiptDto = (
  doc: GoldReceivingReceiptDoc,
  labels: GoldLabels = {},
): GoldReceivingReceiptDto => ({
  id: String(doc._id),
  receiptNumber: doc.receiptNumber,
  status: doc.status,
  printCount: doc.printCount,
  lastPrintedAt: isoOrNull(doc.lastPrintedAt),
  receiptDate: iso(doc.receiptDate),
  branchId: id(doc.branchId),
  branchName: look(labels.branches, id(doc.branchId)),
  releaseType: doc.releaseType,
  releaseOrderNumber: doc.releaseOrderNumber,
  releaseLetterNumber: doc.releaseLetterNumber,
  releaseLetterDate: isoOrNull(doc.releaseLetterDate),
  deliveredByUs: doc.deliveredByUs,
  teamLeaderEmployeeId: id(doc.teamLeaderEmployeeId),
  teamLeaderName: doc.teamLeaderName,
  vehicleId: id(doc.vehicleId),
  vehicleNumber: doc.vehicleNumber,
  companyId: id(doc.companyId),
  companyName: look(labels.companies, id(doc.companyId)),
  companyDelegateId: id(doc.companyDelegateId),
  companyDelegateName: look(labels.representatives, id(doc.companyDelegateId)),
  companyDelegateNationalId: doc.companyDelegateNationalId,
  storageDelegateId: id(doc.storageDelegateId),
  storageDelegateName: look(labels.representatives, id(doc.storageDelegateId)),
  storageDelegateNationalId: doc.storageDelegateNationalId,
  supervisor1EmployeeId: id(doc.supervisor1EmployeeId),
  supervisor1Name: doc.supervisor1Name,
  supervisor2EmployeeId: id(doc.supervisor2EmployeeId),
  supervisor2Name: doc.supervisor2Name,
  representativeId: id(doc.representativeId),
  representativeName: look(labels.representatives, id(doc.representativeId)),
  nationalId: doc.nationalId,
  keyHolder: doc.keyHolder,
  keyHolderNationalId: doc.keyHolderNationalId,
  totalWeight: doc.totalWeight,
  barsCount: doc.barsCount,
  notes: doc.notes,
  storageLocation: doc.storageLocation,
  lines: asArray<GoldReceivingLineSub>(doc.lines).map((line) => toReceivingLineDto(line, labels)),
  barIds: asArray(doc.barIds).map((barId) => String(barId)),
  version: doc.__v,
  createdAt: createdIso(doc),
  updatedAt: updatedIso(doc),
});

export const toGoldDeliveryReceiptDto = (
  doc: GoldDeliveryReceiptDoc,
  labels: GoldLabels = {},
  bars: GoldBarLineDto[] = [],
): GoldDeliveryReceiptDto => ({
  id: String(doc._id),
  receiptNumber: doc.receiptNumber,
  status: doc.status,
  printCount: doc.printCount,
  lastPrintedAt: isoOrNull(doc.lastPrintedAt),
  receiptDate: iso(doc.receiptDate),
  branchId: id(doc.branchId),
  branchName: look(labels.branches, id(doc.branchId)),
  companyId: id(doc.companyId),
  companyName: look(labels.companies, id(doc.companyId)),
  metalType: doc.metalType,
  supervisor1EmployeeId: id(doc.supervisor1EmployeeId),
  supervisor1Name: doc.supervisor1Name,
  supervisor2EmployeeId: id(doc.supervisor2EmployeeId),
  supervisor2Name: doc.supervisor2Name,
  representativeId: id(doc.representativeId),
  representativeName: look(labels.representatives, id(doc.representativeId)),
  nationalId: doc.nationalId,
  keyHolder: doc.keyHolder,
  totalWeight: doc.totalWeight,
  barsCount: doc.barsCount,
  barIds: asArray(doc.barIds).map((barId) => String(barId)),
  bars,
  notes: doc.notes,
  version: doc.__v,
  createdAt: createdIso(doc),
  updatedAt: updatedIso(doc),
});

export const toGoldTransferDto = (
  doc: GoldTransferDoc,
  labels: GoldLabels = {},
  bars: GoldBarLineDto[] = [],
): GoldTransferDto => ({
  id: String(doc._id),
  transferNumber: doc.transferNumber,
  status: doc.status,
  printCount: doc.printCount,
  lastPrintedAt: isoOrNull(doc.lastPrintedAt),
  transferDate: iso(doc.transferDate),
  branchId: id(doc.branchId),
  branchName: look(labels.branches, id(doc.branchId)),
  metalType: doc.metalType,
  supervisor1EmployeeId: id(doc.supervisor1EmployeeId),
  supervisor1Name: doc.supervisor1Name,
  supervisor2EmployeeId: id(doc.supervisor2EmployeeId),
  supervisor2Name: doc.supervisor2Name,
  currentOwnerId: id(doc.currentOwnerId),
  currentOwnerName: look(labels.companies, id(doc.currentOwnerId)),
  currentOwnerDelegateId: id(doc.currentOwnerDelegateId),
  currentOwnerDelegateName: look(labels.representatives, id(doc.currentOwnerDelegateId)),
  currentOwnerNationalId: doc.currentOwnerNationalId,
  newOwnerId: id(doc.newOwnerId),
  newOwnerName: look(labels.companies, id(doc.newOwnerId)),
  newOwnerDelegateId: id(doc.newOwnerDelegateId),
  newOwnerDelegateName: look(labels.representatives, id(doc.newOwnerDelegateId)),
  newOwnerNationalId: doc.newOwnerNationalId,
  barsCount: doc.barsCount,
  totalWeight: doc.totalWeight,
  barIds: asArray(doc.barIds).map((barId) => String(barId)),
  bars,
  approvedBy: doc.approvedBy,
  notes: doc.notes,
  version: doc.__v,
  createdAt: createdIso(doc),
  updatedAt: updatedIso(doc),
});

export const toGoldKeyHandoverDto = (
  doc: GoldKeyHandoverDoc,
  labels: GoldLabels = {},
  representative: { phone: string | null; nationalId: string | null } = {
    phone: null,
    nationalId: null,
  },
  drawer: { number: number | null; label: string | null } = { number: null, label: null },
): GoldKeyHandoverDto => ({
  id: String(doc._id),
  companyId: String(doc.companyId),
  companyName: look(labels.companies, String(doc.companyId)),
  representativeId: String(doc.representativeId),
  representativeName: look(labels.representatives, String(doc.representativeId)),
  representativePhone: representative.phone,
  representativeNationalId: representative.nationalId,
  vaultId: String(doc.vaultId),
  vaultName: look(labels.vaults, String(doc.vaultId)),
  drawerId: String(doc.drawerId),
  drawerNumber: drawer.number,
  drawerLabel: drawer.label,
  handedOverByUserId: id(doc.handedOverByUserId),
  handedOverByName: look(labels.users, id(doc.handedOverByUserId)),
  handoverDate: iso(doc.handoverDate),
  status: doc.status,
  returnedAt: isoOrNull(doc.returnedAt),
  returnedByUserId: id(doc.returnedByUserId),
  returnedByName: look(labels.users, id(doc.returnedByUserId)),
  branchId: id(doc.branchId),
  branchName: look(labels.branches, id(doc.branchId)),
  notes: doc.notes,
  version: doc.__v,
  createdAt: createdIso(doc),
  updatedAt: updatedIso(doc),
});
