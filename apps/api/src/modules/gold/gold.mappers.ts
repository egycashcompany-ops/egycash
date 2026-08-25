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
import { type GoldBarDoc } from './bars/bar.model';
import { type GoldReceivingReceiptDoc } from './receiving/receiving-receipt.model';
import { type GoldDeliveryReceiptDoc } from './delivery/delivery-receipt.model';
import { type GoldTransferDoc } from './transfers/transfer.model';
import { type GoldKeyHandoverDoc } from './keys/key-handover.model';

const iso = (d: Date): string => d.toISOString();

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
type Stamped = { _id: unknown; createdAt?: Date | null; updatedAt?: Date | null };

const bornAt = (id: unknown): Date =>
  id instanceof Types.ObjectId ? id.getTimestamp() : new Date(0);

const createdIso = (doc: Stamped): string => (doc.createdAt ?? bornAt(doc._id)).toISOString();

const updatedIso = (doc: Stamped): string =>
  (doc.updatedAt ?? doc.createdAt ?? bornAt(doc._id)).toISOString();
export const isoOrNull = (d: Date | null | undefined): string | null =>
  d === null || d === undefined ? null : d.toISOString();
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
  doc.history.map(toHistoryDto);

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

const toReceivingLineDto = (
  line: GoldReceivingReceiptDoc['lines'][number],
  labels: GoldLabels,
): GoldReceivingLineDto => {
  const drawerId = id(line.drawerId);
  return {
    serialNumber: line.serialNumber,
    metalType: line.metalType,
    purity: line.purity,
    weight: line.weight,
    brand: line.brand,
    weightBeforePacking: line.weightBeforePacking,
    weightAfterPacking: line.weightAfterPacking,
    vaultId: id(line.vaultId),
    vaultCode: look(labels.vaults, id(line.vaultId)),
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
  lines: doc.lines.map((line) => toReceivingLineDto(line, labels)),
  barIds: doc.barIds.map((barId) => String(barId)),
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
  barIds: doc.barIds.map((barId) => String(barId)),
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
  barIds: doc.barIds.map((barId) => String(barId)),
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
