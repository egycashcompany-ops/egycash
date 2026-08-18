// The INTERIM vault-custody provider (see ../treasury-boundary.ts for why it is interim).
//
// This class implements the `VaultCustodyProvider` port and owns `operations_vault_custody` only
// until a real Treasury module exists to own it. It knows about custody and NOTHING about
// shipments: it never reads or writes `operations_shipments`, never touches shipment status, and
// never decides whether a shipment may be dispatched. Those are Operations' decisions, taken in
// `secured/secured.service.ts`, which drives this port. Keeping the port that dumb is what makes
// swapping in a real Treasury module a registration change rather than a rewrite.
import { Types, type ClientSession } from 'mongoose';
import { OperationsEvents } from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import {
  registerVaultCustodyProvider,
  type VaultCustodyProvider,
  type VaultCustodyView,
  type VaultReceiptInput,
} from '../treasury-boundary';
import { operationsVaultCustodyRepository } from './vault-custody.repository';
import { type OperationsVaultCustodyDoc } from './vault-custody.model';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'vaultCustody',
  entityId: id,
});

const snapshot = (doc: OperationsVaultCustodyDoc) => ({
  state: doc.state,
  receiptNumber: doc.receiptNumber,
  bagCount: doc.bagCount,
  cartonCount: doc.cartonCount,
  boxCount: doc.boxCount,
  bagSeals: doc.bagSeals,
  boxSeals: doc.boxSeals,
  receivedByPrimaryId: String(doc.receivedByPrimaryId),
  receivedBySecondaryId: String(doc.receivedBySecondaryId),
  releasedById: doc.releasedById === null ? null : String(doc.releasedById),
});

export const toCustodyView = (doc: OperationsVaultCustodyDoc): VaultCustodyView => ({
  id: String(doc._id),
  shipmentId: String(doc.shipmentId),
  state: doc.state,
  receiptNumber: doc.receiptNumber,
  receivedAt: doc.receivedAt,
  releasedAt: doc.releasedAt,
  bagCount: doc.bagCount,
  cartonCount: doc.cartonCount,
  boxCount: doc.boxCount,
  receivedByPrimaryId: String(doc.receivedByPrimaryId),
  receivedBySecondaryId: String(doc.receivedBySecondaryId),
});

class OperationsVaultCustodyService implements VaultCustodyProvider {
  async receive(input: VaultReceiptInput, by: string): Promise<VaultCustodyView> {
    // Q2 NORMALIZE — the dual-control rule the legacy schema described and never enforced.
    if (input.receivedByPrimaryId === input.receivedBySecondaryId) {
      throw new BusinessRuleError(
        'the two receiving treasurers must be different people',
        'OPERATIONS_CUSTODY_DUAL_CONTROL_REQUIRED',
      );
    }
    const existing = await operationsVaultCustodyRepository.findByShipment(input.shipmentId);
    if (existing !== null) {
      // Legacy re-stamped status 2 and the receive timestamp on EVERY save from the receive
      // screen (Q29, contad_app.js:1194-1240). NORMALIZE: custody is taken once.
      throw new ConflictError('this shipment is already in the vault');
    }

    const doc = await operationsVaultCustodyRepository.create(
      {
        shipmentId: new Types.ObjectId(input.shipmentId),
        state: 'held',
        receiptNumber: input.receiptNumber,
        bagCount: input.bagCount,
        cartonCount: input.cartonCount,
        boxCount: input.boxCount,
        bagSeals: input.bagSeals,
        boxSeals: input.boxSeals,
        receivedByPrimaryId: new Types.ObjectId(input.receivedByPrimaryId),
        receivedBySecondaryId: new Types.ObjectId(input.receivedBySecondaryId),
        receivedAt: new Date(),
        releasedById: null,
        releasedAt: null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(OperationsEvents.VaultReceived, {
      custodyId: String(doc._id),
      shipmentId: String(doc.shipmentId),
      state: doc.state,
    });
    return toCustodyView(doc);
  }

  async release(shipmentId: string, by: string, session?: unknown): Promise<VaultCustodyView> {
    const typedSession = session as ClientSession | undefined;
    const current = await operationsVaultCustodyRepository.findByShipment(shipmentId, typedSession);
    if (current === null) {
      throw new BusinessRuleError(
        'this shipment is not in the vault',
        'OPERATIONS_CUSTODY_NOT_HELD',
      );
    }
    if (current.state !== 'held') {
      throw new BusinessRuleError(
        'this shipment has already left the vault',
        'OPERATIONS_CUSTODY_NOT_HELD',
      );
    }
    const updated = await operationsVaultCustodyRepository.updateById(
      String(current._id),
      // Q3 NORMALIZE — the legacy treasurer_delivery fields existed and were never written.
      { state: 'released', releasedById: new Types.ObjectId(by), releasedAt: new Date() },
      { by, version: current.__v, session: typedSession },
    );
    return toCustodyView(updated);
  }

  /** Audit + event for a release, run by the caller AFTER its transaction commits. */
  async announceRelease(view: VaultCustodyView, before: OperationsVaultCustodyDoc): Promise<void> {
    const after = await operationsVaultCustodyRepository.getById(view.id);
    await auditService.record({
      entityRef: entityRef(view.id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    await emit(OperationsEvents.VaultReleased, {
      custodyId: view.id,
      shipmentId: view.shipmentId,
      state: after.state,
    });
  }

  async find(shipmentId: string): Promise<VaultCustodyView | null> {
    const doc = await operationsVaultCustodyRepository.findByShipment(shipmentId);
    return doc === null ? null : toCustodyView(doc);
  }

  async listHeld(
    page: number,
    pageSize: number,
  ): Promise<{ items: VaultCustodyView[]; total: number }> {
    // Q32 PRESERVE — the legacy /vault1 inventory has NO date filter at all (its date filters are
    // commented out, contad_app.js:1374/1530): the vault answers "what is here now".
    const found = await operationsVaultCustodyRepository.list({
      filter: { state: 'held' },
      page,
      pageSize,
      sortBy: 'receivedAt',
      sortDir: 'desc',
      sortableFields: ['receivedAt', 'createdAt'],
    });
    return { items: found.items.map(toCustodyView), total: found.meta.totalItems };
  }

  /** The doc behind a view — the caller needs the before-image for its audit diff. */
  async docFor(shipmentId: string, session?: ClientSession): Promise<OperationsVaultCustodyDoc> {
    const doc = await operationsVaultCustodyRepository.findByShipment(shipmentId, session);
    if (doc === null) {
      throw new BusinessRuleError(
        'this shipment is not in the vault',
        'OPERATIONS_CUSTODY_NOT_HELD',
      );
    }
    return doc;
  }
}

export const operationsVaultCustodyService = new OperationsVaultCustodyService();

// Registered at module load, the platform seam way (platform/directory, platform/automation).
registerVaultCustodyProvider(operationsVaultCustodyService);
