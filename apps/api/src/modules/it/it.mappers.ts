// Doc → DTO mapping for the IT-1 entities. Derived facts stay derived — the mapper never invents
// one (the fleet FR-12 discipline).
import {
  type ItLicenseDto,
  type ItSoftwareInstallationDto,
  type ItSoftwareProductDto,
  type ItMaintenanceOrderDto,
  type ItMaintenancePlanDto,
  type ItSparePartDto,
  type ItSparePartMovementDto,
  type ItTicketDto,
  type ItTicketEventDto,
  type ItTicketPriorityDto,
  type ItAssetAssignmentDto,
  type ItAssetDto,
  type ItAssetHolderDto,
  type ItAssetSpecsDto,
  type ItCustodyReceiptDto,
  type ItAssetHistoryEntryDto,
  type ItCatalogItemDto,
  type ItVendorDto,
  type ItPersonDto,
  type ItTechnicianDto,
  type ItMobileLineAssignmentDto,
  type ItMobileLineDto,
  type ItMobileLineHistoryEntryDto,
  type ItMobileLineReceiptDto,
  type ItMobileNetwork,
  type ItConsumableDto,
  type ItConsumableMemoDto,
  type ItConsumableMovementDto,
} from '@ecms/contracts';
import { type DirectoryEmployeeListing } from '../../platform/directory';
import { type ItCatalogItemDoc } from './catalog-items/catalog-item.model';
import { type ItVendorDoc } from './vendors/vendor.model';
import { type ItAssetDoc, type ItAssetSpecsSub } from './assets/asset.model';
import { type ItAssetAssignmentDoc } from './assets/assignment.model';
import { type ItCustodyReceiptDoc } from './assets/receipt.model';
import { type ItAssetEventDoc } from './assets/asset-event.model';
import { type ItTicketDoc } from './tickets/ticket.model';
import { type ItTicketEventDoc } from './tickets/ticket-event.model';
import { type ItTicketPriorityDoc } from './tickets/priority.model';
import { type ItMaintenancePlanDoc } from './maintenance/plan.model';
import { type ItMaintenanceOrderDoc } from './maintenance/order.model';
import { type ItSparePartDoc } from './spare-parts/part.model';
import { type ItSparePartMovementDoc } from './spare-parts/movement.model';
import { type ItSoftwareProductDoc } from './software/product.model';
import { type ItSoftwareInstallationDoc } from './software/installation.model';
import { type ItLicenseView } from './licenses/license.service';
import { type ItMobileLineDoc } from './mobile-lines/mobile-line.model';
import { type ItMobileLineAssignmentDoc } from './mobile-lines/line-assignment.model';
import { type ItMobileLineEventDoc } from './mobile-lines/line-event.model';
import { type ItMobileLineReceiptDoc } from './mobile-lines/line-receipt.model';
import { type ItConsumableDoc } from './consumables/consumable.model';
import { type ItConsumableMovementDoc } from './consumables/consumable-movement.model';
import { type ItConsumableMemoDoc } from './consumables/consumable-memo.model';
// A pure rule, not a model: the register's «below minimum» is the store's arithmetic, said once.
import { isBelowMin } from './consumables/consumable-stock';

const iso = (d: Date): string => d.toISOString();

export const toItCatalogItemDto = (doc: ItCatalogItemDoc): ItCatalogItemDto => ({
  id: String(doc._id),
  kind: doc.kind,
  code: doc.code,
  name: doc.name,
  description: doc.description,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toItVendorDto = (doc: ItVendorDoc): ItVendorDto => ({
  id: String(doc._id),
  name: doc.name,
  code: doc.code,
  phone: doc.phone,
  email: doc.email,
  address: doc.address,
  services: doc.services,
  contacts: doc.contacts.map((c) => ({
    name: c.name,
    role: c.role,
    phone: c.phone,
    email: c.email,
  })),
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/** The specifications table — an asset's, or the snapshot a receipt printed. Null when none. */
export const toItAssetSpecsDto = (
  specs: ItAssetSpecsSub | null | undefined,
): ItAssetSpecsDto | null =>
  specs == null
    ? null
    : {
        processor: specs.processor ?? null,
        memory: specs.memory ?? null,
        systemType: specs.systemType ?? null,
        storage: specs.storage ?? null,
        mediaDrive: specs.mediaDrive ?? null,
        displayAdapter: specs.displayAdapter ?? null,
        graphicsMemory: specs.graphicsMemory ?? null,
        networkAdapters: specs.networkAdapters ?? [],
      };

/**
 * Who holds each asset on ONE response — «لو متسلم اسم الشخص اللى متسلمله الحاجة» — resolved by the
 * caller and handed in: the intervals the assets point at, by id, and their employees' labels (the
 * mobile lines' shape, without the paper). The mapper only reads the maps, so the number of
 * round-trips a response costs is decided in one place.
 */
export interface ItAssetHolderLabels {
  intervals: ReadonlyMap<string, ItAssetAssignmentDoc>;
  employees: ItHolderLabels;
}

/**
 * The holder an asset names — only through the interval the asset itself points at, and only while
 * that interval is open: a stale pointer, a closed or deleted interval, or another asset's interval
 * holds nothing. An employee the directory cannot name keeps their id, with null code and name, and
 * the screen shows the id — never a guess.
 */
const assetHolder = (doc: ItAssetDoc, labels: ItAssetHolderLabels): ItAssetHolderDto | null => {
  const pointer = doc.currentAssignmentId == null ? null : String(doc.currentAssignmentId);
  const open = pointer === null ? undefined : labels.intervals.get(pointer);
  if (
    open === undefined ||
    open.returnedAt !== null ||
    open.isDeleted ||
    String(open.assetId) !== String(doc._id)
  ) {
    return null;
  }
  const employeeId = String(open.assignedToEmployeeId);
  const employee = labels.employees.get(employeeId);
  return {
    employeeId,
    employeeCode: employee?.code ?? null,
    employeeName: employee?.fullNameAr ?? null,
    assignedAt: iso(open.assignedAt),
  };
};

/**
 * The labels are REQUIRED, unlike the mobile lines': a response that forgot to resolve them would
 * say «nobody holds it» about an asset somebody holds — and `items.map(toItAssetDto)` would hand
 * the index in as the labels. Both are type errors this way.
 */
export const toItAssetDto = (doc: ItAssetDoc, holders: ItAssetHolderLabels): ItAssetDto => ({
  id: String(doc._id),
  assetCode: doc.assetCode,
  name: doc.name,
  description: doc.description,
  categoryId: String(doc.categoryId),
  status: doc.status,
  serialNumber: doc.serialNumber,
  model: doc.model,
  manufacturer: doc.manufacturer,
  externalTag: doc.externalTag,
  branchId: String(doc.branchId),
  location: doc.location,
  currentAssignmentId: doc.currentAssignmentId === null ? null : String(doc.currentAssignmentId),
  disposal:
    doc.disposal === null
      ? null
      : {
          at: iso(doc.disposal.at),
          method: doc.disposal.method,
          reason: doc.disposal.reason,
          notes: doc.disposal.notes,
        },
  purchase:
    doc.purchase === null
      ? null
      : {
          date: doc.purchase.date === null ? null : iso(doc.purchase.date),
          cost: doc.purchase.cost,
          vendorId: doc.purchase.vendorId === null ? null : String(doc.purchase.vendorId),
          invoiceRef: doc.purchase.invoiceRef,
        },
  warranty:
    doc.warranty === null
      ? null
      : {
          vendorId: doc.warranty.vendorId === null ? null : String(doc.warranty.vendorId),
          start: iso(doc.warranty.start),
          end: iso(doc.warranty.end),
          terms: doc.warranty.terms,
        },
  notes: doc.notes,
  specs: toItAssetSpecsDto(doc.specs),
  accessories: doc.accessories ?? [],
  holder: assetHolder(doc, holders),
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * IT-6 — the holder's label, resolved by the caller and handed in.
 *
 * The mapper stays pure: it reads a map it was given rather than querying, so the ONE place that
 * decides how many database round-trips a page costs is the controller that assembles the page.
 */
export type ItHolderLabels = ReadonlyMap<string, { code: string; fullNameAr: string }>;

/**
 * The asset behind each interval — what was received, resolved the same way and handed in: its
 * code, its name and its serial («تزود سيريال الأصول لما أعمل Extract»), `null` for an asset
 * registered without one.
 */
export type ItAssetLabels = ReadonlyMap<
  string,
  { assetCode: string; name: string; serialNumber: string | null }
>;

/** Whether each receipt on a page has its signed copy — one read per page, like the labels. */
export type ItReceiptStates = ReadonlyMap<string, { signed: boolean }>;

export const toItAssetAssignmentDto = (
  doc: ItAssetAssignmentDoc,
  holders?: ItHolderLabels,
  assets?: ItAssetLabels,
  receipts?: ItReceiptStates,
): ItAssetAssignmentDto => {
  const holder = holders?.get(String(doc.assignedToEmployeeId));
  const asset = assets?.get(String(doc.assetId));
  const receiptId = doc.receiptId == null ? null : String(doc.receiptId);
  return {
    id: String(doc._id),
    assetId: String(doc.assetId),
    assetCode: asset?.assetCode ?? null,
    assetName: asset?.name ?? null,
    assetSerialNumber: asset?.serialNumber ?? null,
    assignedToEmployeeId: String(doc.assignedToEmployeeId),
    assignedToEmployeeCode: holder?.code ?? null,
    assignedToEmployeeName: holder?.fullNameAr ?? null,
    assignedByUserId: doc.assignedByUserId === null ? null : String(doc.assignedByUserId),
    assignedAt: iso(doc.assignedAt),
    conditionOnIssue: doc.conditionOnIssue,
    expectedReturnAt: doc.expectedReturnAt === null ? null : iso(doc.expectedReturnAt),
    returnedAt: doc.returnedAt === null ? null : iso(doc.returnedAt),
    returnedToUserId: doc.returnedToUserId === null ? null : String(doc.returnedToUserId),
    conditionOnReturn: doc.conditionOnReturn,
    notes: doc.notes,
    branchId: String(doc.branchId),
    receiptId,
    receiptSigned: receiptId === null ? null : (receipts?.get(receiptId)?.signed ?? false),
    version: doc.__v,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
};

/**
 * «بطاقة رقم قومي» on the way out: the full number for a caller holding `itAsset.viewNationalId`,
 * withheld from anyone else (Security Architecture §3) — paired with the flag that tells «not
 * shown to you» from «HR has none», the employee mapper's `…Visible` convention.
 */
export const receiptNationalId = (
  nationalId: string | null | undefined,
  reveal: boolean,
): Pick<ItCustodyReceiptDto, 'nationalId' | 'nationalIdVisible'> => ({
  nationalId: reveal ? (nationalId ?? null) : null,
  nationalIdVisible: reveal,
});

const orgName = (name: { ar: string; en: string } | null | undefined) =>
  name == null ? null : { ar: name.ar, en: name.en };

/**
 * A custody receipt — the paper as it was printed, plus whether its signed copy is in. The
 * national ID only for a caller allowed to see it (`revealNationalId`); withheld by default.
 */
export const toItCustodyReceiptDto = (
  doc: ItCustodyReceiptDoc,
  revealNationalId = false,
): ItCustodyReceiptDto => ({
  id: String(doc._id),
  formNumber: doc.formNumber ?? null,
  issuedAt: iso(doc.issuedAt),
  employeeId: String(doc.employeeId),
  employeeName: doc.employeeName,
  employeeCode: doc.employeeCode,
  jobTitle: orgName(doc.jobTitle),
  ...receiptNationalId(doc.nationalId, revealNationalId),
  section: orgName(doc.section),
  department: orgName(doc.department),
  lines: doc.lines.map((line) => ({
    assetId: String(line.assetId),
    assignmentId: String(line.assignmentId),
    assetCode: line.assetCode,
    name: line.name,
    serialNumber: line.serialNumber,
    conditionOnIssue: line.conditionOnIssue,
    notes: line.notes,
    deviceType: line.deviceType ?? null,
    manufacturer: line.manufacturer ?? null,
    model: line.model ?? null,
    specs: toItAssetSpecsDto(line.specs),
    accessories: line.accessories ?? [],
  })),
  issuedByUserId: doc.issuedByUserId === null ? null : String(doc.issuedByUserId),
  branchId: String(doc.branchId),
  signedCopy:
    doc.signedCopy === null
      ? null
      : {
          fileId: String(doc.signedCopy.fileId),
          fileName: doc.signedCopy.fileName,
          mime: doc.signedCopy.mime,
          size: doc.signedCopy.size,
          uploadedAt: iso(doc.signedCopy.uploadedAt),
        },
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * History entry (design §2.3). The stored key is `subjectId` — uniform across the module's
 * timelines — and the API names it `assetId`, which is what a reader of this endpoint expects.
 *
 * `metadata` defaults to `{}` on the way out as well as in the schema: the collection sets
 * `minimize: false` so an empty object survives the round trip, and this is the second belt for a
 * row that predates that (PR #117's lesson, applied at both ends).
 */
export const toItAssetHistoryEntryDto = (doc: ItAssetEventDoc): ItAssetHistoryEntryDto => ({
  id: String(doc._id),
  assetId: String(doc.subjectId),
  type: doc.type,
  at: iso(doc.at),
  actorUserId: doc.actorUserId === null ? null : String(doc.actorUserId),
  actorName: doc.actorName,
  metadata: doc.metadata ?? {},
  notes: doc.notes,
});

// ── Mobile lines (FR-19) ────────────────────────────────────────────────────

/**
 * What the register shows beside each line, resolved ONCE per page by the caller and handed in —
 * the open intervals by id, their employees' labels, their papers' signed state. The mapper only
 * reads the maps, so the number of round-trips a page costs is decided in one place.
 */
export interface ItMobileLineHolderLabels {
  intervals: ReadonlyMap<string, ItMobileLineAssignmentDoc>;
  employees: ItHolderLabels;
  receipts: ItReceiptStates;
}

/** The line behind each interval — its network, number and plan, read under the reader's scope. */
export type ItMobileLineLabels = ReadonlyMap<
  string,
  { network: ItMobileNetwork; phoneNumber: string; ratePlan: string | null }
>;

const idOrNull = (id: { toString(): string } | null | undefined): string | null =>
  id == null ? null : String(id);

const signedState = (receiptId: string | null, receipts?: ItReceiptStates): boolean | null =>
  receiptId === null ? null : (receipts?.get(receiptId)?.signed ?? false);

/**
 * The paper an interval names — only when it can be read. An interval can outlive its paper (a
 * workforce reset keeps the lines' intervals and purges the papers that carry national IDs), and
 * offering to print or file a paper that is gone would be a button that can only fail.
 */
const paperOf = (receiptId: string | null, receipts?: ItReceiptStates): string | null =>
  receiptId !== null && receipts !== undefined && !receipts.has(receiptId) ? null : receiptId;

export const toItMobileLineDto = (
  doc: ItMobileLineDoc,
  labels?: ItMobileLineHolderLabels,
): ItMobileLineDto => {
  const currentAssignmentId = idOrNull(doc.currentAssignmentId);
  // Only the interval the line itself points at: a stale pointer or a closed interval holds nothing.
  const open =
    currentAssignmentId === null ? undefined : labels?.intervals.get(currentAssignmentId);
  const employeeId = idOrNull(open?.assignedToEmployeeId);
  const employee = employeeId === null ? undefined : labels?.employees.get(employeeId);
  const receiptId = paperOf(idOrNull(open?.receiptId), labels?.receipts);
  return {
    id: String(doc._id),
    network: doc.network,
    phoneNumber: doc.phoneNumber,
    accountNumber: doc.accountNumber ?? null,
    ratePlan: doc.ratePlan ?? null,
    simKind: doc.simKind,
    simSerial: doc.simSerial ?? null,
    status: doc.status,
    branchId: String(doc.branchId),
    notes: doc.notes ?? null,
    currentAssignmentId,
    holder:
      open === undefined || open.returnedAt !== null
        ? null
        : {
            assignmentId: String(open._id),
            kind: open.holderKind,
            employeeId,
            employeeCode: employee?.code ?? null,
            employeeName: employee?.fullNameAr ?? null,
            vehicleCode: open.vehicleCode ?? null,
            vehiclePlate: open.vehiclePlate ?? null,
            assignedAt: iso(open.assignedAt),
            receiptId,
            receiptSigned: signedState(receiptId, labels?.receipts),
          },
    version: doc.__v,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
};

export const toItMobileLineAssignmentDto = (
  doc: ItMobileLineAssignmentDoc,
  holders?: ItHolderLabels,
  lines?: ItMobileLineLabels,
  receipts?: ItReceiptStates,
): ItMobileLineAssignmentDto => {
  const employeeId = idOrNull(doc.assignedToEmployeeId);
  const holder = employeeId === null ? undefined : holders?.get(employeeId);
  const line = lines?.get(String(doc.lineId));
  const receiptId = paperOf(idOrNull(doc.receiptId), receipts);
  return {
    id: String(doc._id),
    lineId: String(doc.lineId),
    network: line?.network ?? null,
    phoneNumber: line?.phoneNumber ?? null,
    ratePlan: line?.ratePlan ?? null,
    holderKind: doc.holderKind,
    assignedToEmployeeId: employeeId,
    assignedToEmployeeCode: holder?.code ?? null,
    assignedToEmployeeName: holder?.fullNameAr ?? null,
    vehicleCode: doc.vehicleCode ?? null,
    vehiclePlate: doc.vehiclePlate ?? null,
    assignedByUserId: idOrNull(doc.assignedByUserId),
    assignedAt: iso(doc.assignedAt),
    returnedAt: doc.returnedAt === null ? null : iso(doc.returnedAt),
    returnedToUserId: idOrNull(doc.returnedToUserId),
    notes: doc.notes ?? null,
    branchId: String(doc.branchId),
    receiptId,
    receiptSigned: signedState(receiptId, receipts),
    version: doc.__v,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
};

/**
 * A line's acknowledgment — the paper as printed, plus whether its signed copy is in. The national
 * ID only for a caller allowed to see it (`revealNationalId`), exactly as a device receipt's.
 */
export const toItMobileLineReceiptDto = (
  doc: ItMobileLineReceiptDoc,
  revealNationalId = false,
): ItMobileLineReceiptDto => ({
  id: String(doc._id),
  formNumber: doc.formNumber ?? null,
  issuedAt: iso(doc.issuedAt),
  employeeId: String(doc.employeeId),
  employeeName: doc.employeeName ?? null,
  employeeCode: doc.employeeCode ?? null,
  jobTitle: orgName(doc.jobTitle),
  ...receiptNationalId(doc.nationalId, revealNationalId),
  section: orgName(doc.section),
  department: orgName(doc.department),
  line: {
    lineId: String(doc.line.lineId),
    assignmentId: String(doc.line.assignmentId),
    network: doc.line.network,
    phoneNumber: doc.line.phoneNumber,
    simKind: doc.line.simKind,
    simSerial: doc.line.simSerial ?? null,
    ratePlan: doc.line.ratePlan ?? null,
    accountNumber: doc.line.accountNumber ?? null,
  },
  issuedByUserId: idOrNull(doc.issuedByUserId),
  branchId: String(doc.branchId),
  signedCopy:
    doc.signedCopy == null
      ? null
      : {
          fileId: String(doc.signedCopy.fileId),
          fileName: doc.signedCopy.fileName,
          mime: doc.signedCopy.mime,
          size: doc.signedCopy.size,
          uploadedAt: iso(doc.signedCopy.uploadedAt),
        },
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/** A line's history entry — stored under the timelines' uniform `subjectId`, named `lineId` here. */
export const toItMobileLineHistoryEntryDto = (
  doc: ItMobileLineEventDoc,
): ItMobileLineHistoryEntryDto => ({
  id: String(doc._id),
  lineId: String(doc.subjectId),
  type: doc.type,
  at: iso(doc.at),
  actorUserId: idOrNull(doc.actorUserId),
  actorName: doc.actorName,
  metadata: doc.metadata ?? {},
  notes: doc.notes,
});

// ── Consumables (FR-20) ─────────────────────────────────────────────────────

/** An item of a store — its counters as the ledger left them, and the reorder hint derived. */
export const toItConsumableDto = (doc: ItConsumableDoc): ItConsumableDto => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  typeId: String(doc.typeId),
  unit: doc.unit,
  branchId: String(doc.branchId),
  minQty: doc.minQty ?? null,
  notes: doc.notes ?? null,
  active: doc.active,
  onHandQty: doc.onHandQty,
  issuedQty: doc.issuedQty,
  scrappedQty: doc.scrappedQty,
  belowMin: isBelowMin(doc.onHandQty, doc.minQty ?? null),
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * What a page of the ledger shows beside each movement, resolved ONCE per page by the caller and
 * handed in: the items, the employees (through the directory), the assets (under the reader's
 * scope — an asset from a branch they cannot see is not named), and the memos with their signed
 * state. The mapper only reads the maps, so what a page costs is decided in one place.
 */
export interface ItConsumableMovementLabels {
  items: ReadonlyMap<string, { code: string; name: string; typeId: string }>;
  employees: ItHolderLabels;
  assets: ReadonlyMap<string, { assetCode: string; name: string }>;
  memos: ReadonlyMap<string, { memoNumber: number; signed: boolean }>;
}

/**
 * The labels are REQUIRED, as an asset's holders are: a page that forgot to resolve them would offer
 * a memo that may be gone — and `items.map(toItConsumableMovementDto)` would hand the index in as
 * the labels. Both are type errors this way.
 *
 * The memo is offered only when it can be read (`paperOf`, the lines' rule): the workforce reset
 * keeps the ledger and purges the papers, which name the person — and a print or upload button for
 * a paper that is gone could only fail.
 */
export const toItConsumableMovementDto = (
  doc: ItConsumableMovementDoc,
  labels: ItConsumableMovementLabels,
): ItConsumableMovementDto => {
  const item = labels.items.get(String(doc.consumableId));
  const employeeId = idOrNull(doc.employeeId);
  const employee = employeeId === null ? undefined : labels.employees.get(employeeId);
  const assetId = idOrNull(doc.assetId);
  const asset = assetId === null ? undefined : labels.assets.get(assetId);
  const memoId = paperOf(idOrNull(doc.memoId), labels.memos);
  const memo = memoId === null ? undefined : labels.memos.get(memoId);
  return {
    id: String(doc._id),
    consumableId: String(doc.consumableId),
    kind: doc.kind,
    qty: doc.qty,
    at: iso(doc.at),
    branchId: String(doc.branchId),
    consumableCode: item?.code ?? null,
    consumableName: item?.name ?? null,
    typeId: item?.typeId ?? null,
    employeeId,
    employeeCode: employee?.code ?? null,
    employeeName: employee?.fullNameAr ?? null,
    assetId,
    assetCode: asset?.assetCode ?? null,
    assetName: asset?.name ?? null,
    reason: doc.reason ?? null,
    memoId,
    memoNumber: memo?.memoNumber ?? null,
    memoSigned: memo === undefined ? null : memo.signed,
    byUserId: idOrNull(doc.byUserId),
    notes: doc.notes ?? null,
    createdAt: iso(doc.createdAt),
  };
};

/** A memo — the paper as it was written (a snapshot), plus whether its signed copy is in. */
export const toItConsumableMemoDto = (doc: ItConsumableMemoDoc): ItConsumableMemoDto => ({
  id: String(doc._id),
  memoNumber: doc.memoNumber,
  issuedAt: iso(doc.issuedAt),
  employeeId: String(doc.employeeId),
  employeeName: doc.employeeName ?? null,
  employeeCode: doc.employeeCode ?? null,
  jobTitle: orgName(doc.jobTitle),
  issuedByName: doc.issuedByName ?? null,
  notes: doc.notes ?? null,
  lines: doc.lines.map((line) => ({
    consumableId: String(line.consumableId),
    movementId: String(line.movementId),
    code: line.code,
    name: line.name,
    typeName: orgName(line.typeName),
    unit: line.unit,
    qty: line.qty,
    reason: line.reason,
    assetId: idOrNull(line.assetId),
    assetCode: line.assetCode ?? null,
    assetName: line.assetName ?? null,
  })),
  branchId: String(doc.branchId),
  issuedByUserId: idOrNull(doc.issuedByUserId),
  signedCopy:
    doc.signedCopy == null
      ? null
      : {
          fileId: String(doc.signedCopy.fileId),
          fileName: doc.signedCopy.fileName,
          mime: doc.signedCopy.mime,
          size: doc.signedCopy.size,
          uploadedAt: iso(doc.signedCopy.uploadedAt),
        },
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

// ── Help desk (IT-3) ────────────────────────────────────────────────────────

export const toItTicketPriorityDto = (doc: ItTicketPriorityDoc): ItTicketPriorityDto => ({
  id: String(doc._id),
  name: doc.name,
  rank: doc.rank,
  responseMinutes: doc.responseMinutes,
  resolutionMinutes: doc.resolutionMinutes,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toItTicketDto = (doc: ItTicketDoc): ItTicketDto => ({
  id: String(doc._id),
  ticketCode: doc.ticketCode,
  title: doc.title,
  description: doc.description,
  requesterUserId: String(doc.requesterUserId),
  branchId: doc.branchId === null ? null : String(doc.branchId),
  categoryId: String(doc.categoryId),
  priorityId: String(doc.priorityId),
  assetId: doc.assetId === null ? null : String(doc.assetId),
  assignedTechnicianUserId:
    doc.assignedTechnicianUserId === null ? null : String(doc.assignedTechnicianUserId),
  status: doc.status,
  sla: {
    policy: {
      responseMinutes: doc.sla.policy.responseMinutes,
      resolutionMinutes: doc.sla.policy.resolutionMinutes,
    },
    responseDueAt: iso(doc.sla.responseDueAt),
    resolutionDueAt: iso(doc.sla.resolutionDueAt),
    firstResponseAt: doc.sla.firstResponseAt === null ? null : iso(doc.sla.firstResponseAt),
    responseBreachedAt:
      doc.sla.responseBreachedAt === null ? null : iso(doc.sla.responseBreachedAt),
    resolutionBreachedAt:
      doc.sla.resolutionBreachedAt === null ? null : iso(doc.sla.resolutionBreachedAt),
    pausedMs: doc.sla.pausedMs,
    holdStartedAt: doc.sla.holdStartedAt === null ? null : iso(doc.sla.holdStartedAt),
  },
  resolution:
    doc.resolution === null
      ? null
      : {
          summary: doc.resolution.summary,
          resolvedByUserId: String(doc.resolution.resolvedByUserId),
          resolvedAt: iso(doc.resolution.resolvedAt),
        },
  closedAt: doc.closedAt === null ? null : iso(doc.closedAt),
  reopenCount: doc.reopenCount,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * A stream entry.
 *
 * @param includeInternal the caller's `itTicket.edit`. The repository already excludes internal
 * rows from the QUERY for anyone without it (FR-7) — this redaction is the second belt: if such a
 * row ever reached here through a future code path, the body still does not go over the wire.
 */
export const toItTicketEventDto = (
  doc: ItTicketEventDoc,
  includeInternal: boolean,
): ItTicketEventDto => {
  const redacted = doc.visibility === 'internal' && !includeInternal;
  return {
    id: String(doc._id),
    ticketId: String(doc.subjectId),
    type: doc.type,
    at: iso(doc.at),
    actorUserId: doc.actorUserId === null ? null : String(doc.actorUserId),
    actorName: doc.actorName,
    fromStatus: doc.fromStatus,
    toStatus: doc.toStatus,
    body: redacted ? null : doc.body,
    visibility: doc.visibility,
    metadata: doc.metadata ?? {},
    notes: doc.notes,
  };
};

// ── Maintenance and the spare-parts store (IT-4) ────────────────────────────

export const toItMaintenancePlanDto = (doc: ItMaintenancePlanDoc): ItMaintenancePlanDto => ({
  id: String(doc._id),
  assetId: String(doc.assetId),
  name: doc.name,
  intervalDays: doc.intervalDays,
  checklist: doc.checklist,
  lastCompletedAt: doc.lastCompletedAt === null ? null : iso(doc.lastCompletedAt),
  nextDueAt: iso(doc.nextDueAt),
  active: doc.active,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * An order. Its consumed parts are deliberately NOT here: they are movement rows keyed by `orderId`
 * (ADR-024), read through `GET /it/maintenance-orders/:id/parts`. Embedding them would put a second
 * copy of the ledger on the wire, and a mapper that assembled one would be inventing a fact.
 */
export const toItMaintenanceOrderDto = (doc: ItMaintenanceOrderDoc): ItMaintenanceOrderDto => ({
  id: String(doc._id),
  orderCode: doc.orderCode,
  kind: doc.kind,
  assetId: String(doc.assetId),
  planId: doc.planId === null ? null : String(doc.planId),
  ticketId: doc.ticketId === null ? null : String(doc.ticketId),
  status: doc.status,
  scheduledFor: doc.scheduledFor === null ? null : iso(doc.scheduledFor),
  startedAt: doc.startedAt === null ? null : iso(doc.startedAt),
  completedAt: doc.completedAt === null ? null : iso(doc.completedAt),
  performedByUserId: doc.performedByUserId === null ? null : String(doc.performedByUserId),
  vendorId: doc.vendorId === null ? null : String(doc.vendorId),
  cost: doc.cost,
  summary: doc.summary,
  assetStatusBefore: doc.assetStatusBefore,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toItSparePartDto = (doc: ItSparePartDoc): ItSparePartDto => ({
  id: String(doc._id),
  partCode: doc.partCode,
  name: doc.name,
  unit: doc.unit,
  onHandQty: doc.onHandQty,
  minQty: doc.minQty,
  active: doc.active,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/** A ledger row carries no `version`: it is append-only, so there is nothing to edit optimistically. */
export const toItSparePartMovementDto = (
  doc: ItSparePartMovementDoc,
): ItSparePartMovementDto => ({
  id: String(doc._id),
  partId: String(doc.partId),
  qty: doc.qty,
  orderId: doc.orderId === null ? null : String(doc.orderId),
  at: iso(doc.at),
  byUserId: doc.byUserId === null ? null : String(doc.byUserId),
  note: doc.note,
  createdAt: iso(doc.createdAt),
});

// ── Software and licences (IT-5) ────────────────────────────────────────────

export const toItSoftwareProductDto = (doc: ItSoftwareProductDoc): ItSoftwareProductDto => ({
  id: String(doc._id),
  name: doc.name,
  publisher: doc.publisher,
  active: doc.active,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * `version` is the optimistic-concurrency number and `softwareVersion` is the software's own —
 * two different things the design's §2.8 sketch gave one name. `branchId` is deliberately NOT on
 * the wire: it is a scope anchor copied from the asset, and a client that read it might start
 * trusting it instead of the asset.
 */
export const toItSoftwareInstallationDto = (
  doc: ItSoftwareInstallationDoc,
): ItSoftwareInstallationDto => ({
  id: String(doc._id),
  assetId: String(doc.assetId),
  productId: String(doc.productId),
  softwareVersion: doc.softwareVersion,
  licenseId: doc.licenseId === null ? null : String(doc.licenseId),
  installedAt: iso(doc.installedAt),
  removedAt: doc.removedAt === null ? null : iso(doc.removedAt),
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * A licence takes a VIEW, not a document: `seatsUsed` and `state` are derived (FR-10, §6) and the
 * mapper is the wrong place to derive them — it would need a query per row. The service computes
 * both for a whole page in one aggregation and hands them here already decided, which is the
 * "derived facts stay derived, and the mapper never invents one" rule kept honestly.
 */
export const toItLicenseDto = (view: ItLicenseView): ItLicenseDto => ({
  id: String(view.doc._id),
  productId: String(view.doc.productId),
  licenseKey: view.doc.licenseKey,
  seats: view.doc.seats,
  purchase:
    view.doc.purchase === null
      ? null
      : {
          vendorId: view.doc.purchase.vendorId === null ? null : String(view.doc.purchase.vendorId),
          date: view.doc.purchase.date === null ? null : iso(view.doc.purchase.date),
          cost: view.doc.purchase.cost,
          invoiceRef: view.doc.purchase.invoiceRef,
        },
  expiresAt: view.doc.expiresAt === null ? null : iso(view.doc.expiresAt),
  notes: view.doc.notes,
  seatsUsed: view.seatsUsed,
  state: view.state,
  version: view.doc.__v,
  createdAt: iso(view.doc.createdAt),
  updatedAt: iso(view.doc.updatedAt),
});

/**
 * A person as IT's screens print them — HR's facts, read through the directory, and the one fact
 * that is IT's: how many assets they hold now. That count is computed for a whole page in one
 * `$group` and handed in already decided, for the reason `toItLicenseDto` gives.
 */
export const toItPersonDto = (
  person: DirectoryEmployeeListing,
  openCustodyCount: number,
): ItPersonDto => ({
  employeeId: person.employeeId,
  code: person.code,
  fullNameAr: person.fullNameAr,
  status: person.status,
  branchId: person.branchId,
  departmentId: person.departmentId,
  jobTitleId: person.jobTitleId,
  hiredAt: person.hiredAt === null ? null : iso(person.hiredAt),
  exitedAt: person.exitedAt === null ? null : iso(person.exitedAt),
  userId: person.userId,
  openCustodyCount,
});

export const toItTechnicianDto = (person: DirectoryEmployeeListing): ItTechnicianDto => ({
  employeeId: person.employeeId,
  code: person.code,
  fullNameAr: person.fullNameAr,
  status: person.status,
  userId: person.userId,
});
