// Doc → DTO mapping for the operations module (the fleet.mappers precedent): ids and dates become
// strings, minor units become major units, and nothing derived is stored.
import {
  fromMinorUnits,
  type OperationsBankBranchDto,
  type OperationsAreaDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsDayDto,
  type OperationsShipmentAssignmentDto,
  type OperationsShipmentDto,
  type OperationsVaultInventoryRowDto,
  type OperationsVaultReceiptDto,
} from '@ecms/contracts';
import { type OperationsDayDoc } from './days/day.model';
import { type OperationsShipmentAssignmentDoc } from './shipments/shipment-assignment.model';
import { type OperationsBankDoc } from './banks/bank.model';
import { type OperationsBankBranchDoc } from './bank-branches/bank-branch.model';
import { type OperationsCurrencyDoc } from './currencies/currency.model';
import { type OperationsAreaDoc } from './areas/area.model';
import { type OperationsShipmentDoc } from './shipments/shipment.model';
import { type VaultCustodyView } from './treasury-boundary';

const iso = (d: Date): string => d.toISOString();

export const toBankDto = (doc: OperationsBankDoc): OperationsBankDto => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  opsName: doc.opsName,
  slogan: doc.slogan,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toAreaDto = (doc: OperationsAreaDoc): OperationsAreaDto => ({
  id: String(doc._id),
  name: doc.name,
  nameEn: doc.nameEn,
  governorate: doc.governorate,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toBankBranchDto = (doc: OperationsBankBranchDoc): OperationsBankBranchDto => ({
  id: String(doc._id),
  bankId: String(doc.bankId),
  name: doc.name,
  code: doc.code,
  opsAreaName: doc.opsAreaName,
  financeAreaName: doc.financeAreaName,
  location:
    doc.location === null
      ? null
      : { addressLine: doc.location.addressLine, coordinates: doc.location.coordinates },
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toCurrencyDto = (doc: OperationsCurrencyDoc): OperationsCurrencyDto => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  legacyAliases: doc.legacyAliases,
  // `?? null`: a row written before the catalog could be ordered has no such field at all.
  sortOrder: doc.sortOrder ?? null,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toShipmentDto = (doc: OperationsShipmentDoc): OperationsShipmentDto => ({
  id: String(doc._id),
  shipmentType: doc.shipmentType,
  status: doc.status,
  mainBankId: String(doc.mainBankId),
  secondaryBankId: doc.secondaryBankId === null ? null : String(doc.secondaryBankId),
  originBranchId: String(doc.originBranchId),
  destinationBranchId: String(doc.destinationBranchId),
  areaName: doc.areaName,
  lines: doc.lines.map((line) => ({
    currencyId: String(line.currencyId),
    amount: fromMinorUnits(line.amountMinor),
  })),
  collectionDate: iso(doc.collectionDate),
  deliveryDate: doc.deliveryDate === null ? null : iso(doc.deliveryDate),
  receiptNumber: doc.receiptNumber,
  vaultReceiptNumber: doc.vaultReceiptNumber,
  serialTracked: doc.serialTracked,
  notes: doc.notes,
  receivedById: doc.receivedById === null ? null : String(doc.receivedById),
  receivedAt: doc.receivedAt === null ? null : iso(doc.receivedAt),
  // `== null`, not `=== null`: the board reads `.lean()`, and a row written before the receipt
  // column has no such field at all — absent and null both mean "no photo yet".
  receiptImage:
    doc.receiptImage == null
      ? null
      : {
          fileId: String(doc.receiptImage.fileId),
          fileName: doc.receiptImage.fileName,
          mime: doc.receiptImage.mime,
          size: doc.receiptImage.size,
          uploadedAt: iso(doc.receiptImage.uploadedAt),
        },
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toDayDto = (doc: OperationsDayDoc): OperationsDayDto => ({
  id: String(doc._id),
  date: iso(doc.date),
  status: doc.status,
  openedById: doc.openedById === null ? null : String(doc.openedById),
  openedAt: doc.openedAt === null ? null : iso(doc.openedAt),
  closedById: doc.closedById === null ? null : String(doc.closedById),
  closedAt: doc.closedAt === null ? null : iso(doc.closedAt),
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toShipmentAssignmentDto = (
  doc: OperationsShipmentAssignmentDoc,
): OperationsShipmentAssignmentDto => ({
  id: String(doc._id),
  shipmentId: String(doc.shipmentId),
  leg: doc.leg,
  operationsDayId: String(doc.operationsDayId),
  captainEmployeeId: String(doc.captainEmployeeId),
  vehicleId: String(doc.vehicleId),
  crewAssignmentId: String(doc.crewAssignmentId),
  sequence: doc.sequence,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * The Treasury port's view → the Operations-facing row. There is no doc here on purpose: this
 * mapper takes `VaultCustodyView`, not `OperationsVaultCustodyDoc`, so an Operations controller
 * physically cannot serialize a custody field the port did not hand it.
 */
export const toVaultInventoryRowDto = (
  view: VaultCustodyView,
  receivedByName: string | null,
): OperationsVaultInventoryRowDto => ({
  id: view.id,
  shipmentId: view.shipmentId,
  state: view.state,
  receiptNumber: view.receiptNumber,
  bagCount: view.bagCount,
  cartonCount: view.cartonCount,
  boxCount: view.boxCount,
  bagSealsPerBag: view.bagSealsPerBag,
  denominations: view.denominations.map((line) => ({ value: line.value, count: line.count })),
  receivedById: view.receivedById,
  receivedByName,
  // A receipt taken before Round 18 named two treasurers; mapped as they always were.
  receivedByPrimaryId: view.receivedByPrimaryId,
  receivedBySecondaryId: view.receivedBySecondaryId,
  receivedAt: iso(view.receivedAt),
  releasedAt: view.releasedAt === null ? null : iso(view.releasedAt),
});

/**
 * Round 18 — the receipt the vault's ✓ just took, from the port's view (never the custody doc, for
 * the reason above: the seals stay behind the port), with its receiver: the user who received it —
 * the request's own, whom the custody recorded. A receipt taken now always has a seals-per-bag
 * choice; the fallback only satisfies the view's wider type, which also reads older rows.
 */
export const toVaultReceiptDto = (
  view: VaultCustodyView,
  receiver: { id: string; name: string | null },
): OperationsVaultReceiptDto => ({
  custodyId: view.id,
  receiptNumber: view.receiptNumber,
  receivedAt: iso(view.receivedAt),
  receivedById: receiver.id,
  receivedByName: receiver.name,
  bagCount: view.bagCount,
  cartonCount: view.cartonCount,
  boxCount: view.boxCount,
  bagSealsPerBag: view.bagSealsPerBag ?? 2,
  denominations: view.denominations.map((line) => ({ value: line.value, count: line.count })),
});
