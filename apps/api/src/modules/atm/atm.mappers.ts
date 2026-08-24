// Doc → DTO mapping for the ATM module (the operations.mappers precedent): ids and dates become
// strings, nothing derived is stored — except the mail ticket's `duplication`, which is the ONE
// deliberately live-computed field (the legacy recomputed it on every pending render,
// contad_app.js:2674-2698); callers without a live answer get the ingest-time value.
import {
  type AtmMachineDto,
  type AtmMailTicketDto,
  type AtmMaintenanceDto,
  type AtmRefLabelDto,
  type AtmReplenishmentDto,
} from '@ecms/contracts';
import { type AtmMachineDoc } from './machines/machine.model';
import { type AtmRefLabelDoc } from './catalogs/ref-label.model';
import { type AtmReplenishmentDoc } from './replenishments/replenishment.model';
import { type AtmMaintenanceDoc } from './maintenances/maintenance.model';
import { type AtmMailTicketDoc } from './mail-tickets/mail-ticket.model';

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export const toAtmMachineDto = (doc: AtmMachineDoc): AtmMachineDto => ({
  id: String(doc._id),
  branchId: String(doc.branchId),
  bankName: doc.bankName,
  machineCode: doc.machineCode,
  name: doc.name,
  zone: doc.zone,
  area: doc.area,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toAtmRefLabelDto = (doc: AtmRefLabelDoc): AtmRefLabelDto => ({
  id: String(doc._id),
  branchId: String(doc.branchId),
  name: doc.name,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toAtmReplenishmentDto = (doc: AtmReplenishmentDoc): AtmReplenishmentDto => ({
  id: String(doc._id),
  branchId: String(doc.branchId),
  machineId: String(doc.machineId),
  machineCode: doc.machineCode,
  bankName: doc.bankName,
  machineName: doc.machineName,
  zone: doc.zone,
  area: doc.area,
  openedAt: iso(doc.openedAt),
  closedAt: isoOrNull(doc.closedAt),
  scheduleTime: doc.scheduleTime,
  leaderName: doc.leaderName,
  openedByName: doc.openedByName,
  closedByName: doc.closedByName,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toAtmMaintenanceDto = (doc: AtmMaintenanceDoc): AtmMaintenanceDto => ({
  id: String(doc._id),
  branchId: String(doc.branchId),
  machineId: String(doc.machineId),
  machineCode: doc.machineCode,
  bankName: doc.bankName,
  machineName: doc.machineName,
  zone: doc.zone,
  area: doc.area,
  openedAt: iso(doc.openedAt),
  closedAt: isoOrNull(doc.closedAt),
  serviceType: doc.serviceType,
  notes: doc.notes,
  referenceNumber: doc.referenceNumber,
  source: doc.source,
  mailTicketId: doc.mailTicketId === null ? null : String(doc.mailTicketId),
  leaderEmployeeId: doc.leaderEmployeeId === null ? null : String(doc.leaderEmployeeId),
  leaderName: doc.leaderName,
  openedByName: doc.openedByName,
  closedByName: doc.closedByName,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toAtmMailTicketDto = (
  doc: AtmMailTicketDoc,
  liveDuplication?: boolean,
): AtmMailTicketDto => ({
  id: String(doc._id),
  branchId: String(doc.branchId),
  machineId: doc.machineId === null ? null : String(doc.machineId),
  machineCode: doc.machineCode,
  bankName: doc.bankName,
  machineName: doc.machineName,
  area: doc.area,
  receivedAt: iso(doc.receivedAt),
  status: doc.status,
  issueText: doc.issueText,
  senderEmail: doc.senderEmail,
  foundInMaster: doc.foundInMaster,
  duplication: liveDuplication ?? doc.duplicationAtIngest,
  actionByName: doc.actionByName,
  actionAt: isoOrNull(doc.actionAt),
  providerMessageId: doc.providerMessageId,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});
