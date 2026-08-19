// Documents in, customer-safe DTOs out.
//
// Written as explicit allow-lists rather than by spreading a document and deleting fields: the
// difference is what happens when somebody adds a column to a gold model next year. A spread would
// carry it outward silently; this will not compile until somebody decides.
import {
  type GoldPortalBarDto,
  type GoldPortalDrawerDto,
  type GoldPortalKeyDto,
  type GoldPortalReceiptDto,
  type GoldPortalRepresentativeDto,
  type GoldPortalTransferDto,
} from '@ecms/contracts';
import { type Types } from 'mongoose';
import { type GoldBarDoc } from '../bars/bar.model';
import { type GoldDeliveryReceiptDoc } from '../delivery/delivery-receipt.model';
import { type GoldKeyHandoverDoc } from '../keys/key-handover.model';
import { type GoldReceivingReceiptDoc } from '../receiving/receiving-receipt.model';
import { type GoldRepresentativeDoc } from '../representatives/representative.model';
import { type GoldTransferDoc } from '../transfers/transfer.model';
import { type PortalDrawerRow } from './portal.reads';

/** Names resolved once per page and handed in — the module's usual batch-lookup shape. */
export interface PortalLabels {
  vaults: Map<string, string>;
  drawers: Map<string, { number: number; label: string }>;
  representatives: Map<string, string>;
  companies: Map<string, string>;
}

const idOrNull = (value: Types.ObjectId | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

const named = (map: Map<string, string>, id: Types.ObjectId | null | undefined): string | null => {
  const key = idOrNull(id);
  return key === null ? null : (map.get(key) ?? null);
};

export const toPortalBar = (doc: GoldBarDoc, labels: PortalLabels): GoldPortalBarDto => ({
  id: String(doc._id),
  serialNumber: doc.serialNumber,
  brand: doc.brand,
  metalType: doc.metalType,
  purity: doc.purity,
  weight: doc.weight,
  status: doc.status,
  vaultName: named(labels.vaults, doc.currentVaultId),
  drawerLabel: idOrNull(doc.currentDrawerId) === null
    ? null
    : (labels.drawers.get(String(doc.currentDrawerId))?.label ?? null),
});

export const toPortalDrawer = (row: PortalDrawerRow): GoldPortalDrawerDto => ({
  drawerId: String(row.drawerId),
  number: row.number,
  label: row.label,
  vaultName: row.vaultName,
  myBarsCount: row.myBarsCount,
  myWeight: row.myWeight,
});

export const toPortalReceipt = (
  doc: GoldReceivingReceiptDoc | GoldDeliveryReceiptDoc,
  labels: PortalLabels,
): GoldPortalReceiptDto => ({
  id: String(doc._id),
  receiptNumber: doc.receiptNumber,
  receiptDate: doc.receiptDate.toISOString(),
  representativeName: named(labels.representatives, doc.representativeId),
  barsCount: doc.barsCount,
  totalWeight: doc.totalWeight,
  status: doc.status,
});

/**
 * A transfer is read from the customer's own side: which way it went, and who the other party was.
 * The counterparty is a NAME and nothing else — they are another customer of ours.
 */
export const toPortalTransfer = (
  doc: GoldTransferDoc,
  company: string,
  labels: PortalLabels,
): GoldPortalTransferDto => {
  const outgoing = idOrNull(doc.currentOwnerId) === company;
  return {
    id: String(doc._id),
    transferNumber: doc.transferNumber,
    transferDate: doc.transferDate.toISOString(),
    direction: outgoing ? 'out' : 'in',
    counterpartyName: named(labels.companies, outgoing ? doc.newOwnerId : doc.currentOwnerId),
    barsCount: doc.barsCount,
    totalWeight: doc.totalWeight,
    status: doc.status,
  };
};

export const toPortalKey = (doc: GoldKeyHandoverDoc, labels: PortalLabels): GoldPortalKeyDto => {
  const cell = labels.drawers.get(String(doc.drawerId));
  return {
    id: String(doc._id),
    vaultName: named(labels.vaults, doc.vaultId),
    drawerNumber: cell?.number ?? null,
    drawerLabel: cell?.label ?? null,
    representativeName: named(labels.representatives, doc.representativeId),
    status: doc.status,
    handoverDate: doc.handoverDate.toISOString(),
    returnDate: doc.returnedAt === null ? null : doc.returnedAt.toISOString(),
  };
};

export const toPortalRepresentative = (
  doc: GoldRepresentativeDoc,
): GoldPortalRepresentativeDto => ({
  id: String(doc._id),
  fullName: doc.fullName,
  nationalId: doc.nationalId,
  phone: doc.phone,
  jobTitle: doc.jobTitle,
  status: doc.status,
});
