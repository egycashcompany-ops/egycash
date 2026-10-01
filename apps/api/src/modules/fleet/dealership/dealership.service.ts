// The dealership screen (التوكيل): rows opened by the workshop, invoices written by the clerk.
import { Types, type FilterQuery } from 'mongoose';
import {
  type FleetDealershipInvoiceDto,
  type FleetDealershipSummaryQuery,
  type FleetDealershipTotalsDto,
  type ListFleetDealershipInvoicesQuery,
  type Paginated,
  type UpdateFleetDealershipInvoice,
  parseFleetSort,
} from '@ecms/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { type AuthContext } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { vehicleIdOf } from '../fleet.mappers';
import { type FleetMaintenanceVisitDoc } from '../maintenance/maintenance.model';
import { fleetDealershipRepository } from './dealership.repository';
import { resolveDealershipDocsCategoryId } from './dealership-files';
import { isPrivateOperation, splitWorkType } from './work-type-split';
import { type FleetDealershipInvoiceDoc } from './dealership.model';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'dealershipInvoice',
  entityId: id,
});

const stringOrNull = (value: Types.ObjectId | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

/** Where the money comes from, by the rule — a private car with no invoice number pays from custody. */
export const sideOf = (doc: {
  privateCar: boolean;
  invoiceNumber: string | null;
  invoiceAmount: number | null;
}): FleetDealershipInvoiceDoc['side'] => {
  if (doc.invoiceAmount === null) return null;
  return doc.privateCar && (doc.invoiceNumber === null || doc.invoiceNumber === '')
    ? 'custody'
    : 'dealership';
};

export interface DealershipInvoiceWithJoins {
  doc: FleetDealershipInvoiceDoc;
  vehicleCode: string | null;
  insuranceCompanyName: string | null;
}

export const toDealershipInvoiceDto = ({
  doc,
  vehicleCode,
  insuranceCompanyName,
}: DealershipInvoiceWithJoins): FleetDealershipInvoiceDto => ({
  id: String(doc._id),
  visitId: String(doc.visitId),
  vehicleId: stringOrNull(doc.vehicleId),
  vehicleCode,
  outDate: doc.outDate.toISOString(),
  workKind: doc.workKind,
  workTypeLabel: doc.workTypeLabel,
  privateCar: doc.privateCar,
  insuranceCompanyId: stringOrNull(doc.insuranceCompanyId),
  insuranceCompanyName,
  invoiceNumber: doc.invoiceNumber ?? null,
  invoiceAmount: doc.invoiceAmount ?? null,
  image:
    doc.image == null
      ? null
      : {
          fileId: String(doc.image.fileId),
          fileName: doc.image.fileName,
          mime: doc.image.mime,
          size: doc.image.size,
          uploadedAt: doc.image.uploadedAt.toISOString(),
        },
  side: doc.side ?? null,
  pending: doc.invoiceAmount == null,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

const snapshot = (doc: FleetDealershipInvoiceDoc) => ({
  privateCar: doc.privateCar,
  insuranceCompanyId: stringOrNull(doc.insuranceCompanyId),
  invoiceNumber: doc.invoiceNumber ?? null,
  invoiceAmount: doc.invoiceAmount ?? null,
  side: doc.side ?? null,
});

class FleetDealershipService {
  /**
   * The rows a workshop exit opens — called by the maintenance check-out. One per half of the
   * work type (see `splitWorkType`), each carrying what the registry knows about the car today:
   * its insurer, and whether it is «ملاكي» (from its operation). Idempotent per visit.
   */
  async openForVisit(visit: FleetMaintenanceVisitDoc, by: string): Promise<void> {
    if (visit.outDate === null) return;
    const visitId = String(visit._id);
    if (await fleetDealershipRepository.hasRowsForVisit(visitId)) return;
    const workType = await fleetCatalogItemRepository.findById(String(visit.workTypeId));
    const rows = splitWorkType(workType?.name.ar ?? '');
    const vehicleId = vehicleIdOf(visit);
    let privateCar = false;
    let insuranceCompanyId: Types.ObjectId | null = null;
    if (vehicleId !== null) {
      const vehicle = await fleetVehicleRepository.findById(vehicleId);
      insuranceCompanyId = vehicle?.insuranceCompanyId ?? null;
      const operationId = vehicle?.operationId ?? null;
      if (operationId !== null) {
        const operation = await fleetCatalogItemRepository.findById(String(operationId));
        privateCar = isPrivateOperation(operation?.name.ar);
      }
    }
    for (const row of rows) {
      const doc = await fleetDealershipRepository.create(
        {
          visitId: visit._id,
          vehicleId: visit.vehicleId ?? null,
          vehicleCode: visit.vehicleId == null ? (visit.vehicleCode ?? null) : null,
          outDate: visit.outDate,
          workKind: row.workKind,
          workTypeLabel: row.workTypeLabel,
          privateCar,
          insuranceCompanyId,
          invoiceNumber: null,
          invoiceAmount: null,
          image: null,
          side: null,
        },
        { by },
      );
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'create',
        changes: [{ field: 'visitId', old: null, new: visitId }],
      });
    }
  }

  /** A reopened visit has not left the workshop: its rows that have no invoice yet are withdrawn. */
  async withdrawPendingOfVisit(visitId: string, by: string): Promise<void> {
    for (const row of await fleetDealershipRepository.pendingOfVisit(visitId)) {
      await fleetDealershipRepository.softDeleteById(String(row._id), { by });
      await auditService.record({ entityRef: entityRef(String(row._id)), action: 'delete' });
    }
  }

  private async filterFor(
    query: FleetDealershipSummaryQuery,
  ): Promise<FilterQuery<FleetDealershipInvoiceDoc>> {
    return fleetDealershipRepository.dealershipFilter({
      vehicleIds:
        query.vehicleCodes === undefined
          ? undefined
          : await fleetVehicleRepository.idsByCodes(query.vehicleCodes),
      vehicleCodes: query.vehicleCodes,
      side: query.side,
      pending: query.pending,
      workKind: query.workKind,
      from: query.from,
      to: query.to,
    });
  }

  async list(
    query: ListFleetDealershipInvoicesQuery,
  ): Promise<
    Paginated<FleetDealershipInvoiceDoc> & { joins: Map<string, DealershipInvoiceWithJoins> }
  > {
    const page = await fleetDealershipRepository.listInvoices({
      filter: await this.filterFor(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'outDate',
      sortDir: query.sortDir ?? 'desc',
      sorts: parseFleetSort(query.sort),
    });
    return { ...page, joins: await this.joinsFor(page.items) };
  }

  async summary(query: FleetDealershipSummaryQuery): Promise<FleetDealershipTotalsDto> {
    return fleetDealershipRepository.totals(await this.filterFor(query));
  }

  /** The codes and the insurers' names for exactly the rows on the page — one lookup each. */
  async joinsFor(
    docs: readonly FleetDealershipInvoiceDoc[],
  ): Promise<Map<string, DealershipInvoiceWithJoins>> {
    const vehicleIds = [
      ...new Set(docs.flatMap((doc) => (doc.vehicleId == null ? [] : [String(doc.vehicleId)]))),
    ];
    const insurerIds = [
      ...new Set(
        docs.flatMap((doc) =>
          doc.insuranceCompanyId == null ? [] : [String(doc.insuranceCompanyId)],
        ),
      ),
    ];
    const [codes, insurers] = await Promise.all([
      fleetVehicleRepository.codesByIds(vehicleIds),
      fleetCatalogItemRepository.namesByIds(insurerIds),
    ]);
    return new Map(
      docs.map((doc) => [
        String(doc._id),
        {
          doc,
          vehicleCode:
            doc.vehicleId == null
              ? (doc.vehicleCode ?? null)
              : (codes.get(String(doc.vehicleId)) ?? null),
          insuranceCompanyName:
            doc.insuranceCompanyId == null
              ? null
              : (insurers.get(String(doc.insuranceCompanyId))?.ar ?? null),
        },
      ]),
    );
  }

  async get(id: string): Promise<DealershipInvoiceWithJoins> {
    const doc = await fleetDealershipRepository.getById(id);
    const joins = await this.joinsFor([doc]);
    return joins.get(id) as DealershipInvoiceWithJoins;
  }

  /**
   * Record or correct the invoice. The one rule: a car that is NOT «ملاكي» needs an invoice
   * number once an amount is on the row — the dealership bills by number, and the custody fund
   * only covers private cars.
   */
  async update(
    id: string,
    input: UpdateFleetDealershipInvoice,
    by: string,
  ): Promise<DealershipInvoiceWithJoins> {
    const before = await fleetDealershipRepository.getById(id);
    if (input.insuranceCompanyId != null) {
      const insurer = await fleetCatalogItemRepository.findActiveOfKind(
        input.insuranceCompanyId,
        'insuranceCompany',
      );
      if (insurer === null) {
        throw new ValidationError([
          {
            field: 'body.insuranceCompanyId',
            code: 'INVALID',
            message: 'unknown insurance company',
          },
        ]);
      }
    }
    const next = {
      privateCar: input.privateCar ?? before.privateCar,
      invoiceNumber:
        input.invoiceNumber === undefined ? (before.invoiceNumber ?? null) : input.invoiceNumber,
      invoiceAmount:
        input.invoiceAmount === undefined ? (before.invoiceAmount ?? null) : input.invoiceAmount,
    };
    if (next.invoiceAmount !== null && !next.privateCar && (next.invoiceNumber ?? '') === '') {
      throw new ValidationError([
        {
          field: 'body.invoiceNumber',
          code: 'REQUIRED',
          message: 'an invoice number is required unless the car is private (ملاكي)',
        },
      ]);
    }
    const set: Partial<FleetDealershipInvoiceDoc> = {
      ...next,
      side: sideOf(next),
    };
    if (input.insuranceCompanyId !== undefined) {
      set.insuranceCompanyId =
        input.insuranceCompanyId === null ? null : new Types.ObjectId(input.insuranceCompanyId);
    }
    const updated = await fleetDealershipRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return this.get(id);
  }

  async remove(id: string, by: string): Promise<void> {
    const before = await fleetDealershipRepository.getById(id);
    await fleetDealershipRepository.softDeleteById(id, { by });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges(snapshot(before), {}),
    });
  }

  // ── The scan (Files owns the bytes, the row owns the link) — as the vehicle licence image ──

  async setImage(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
  ): Promise<DealershipInvoiceWithJoins> {
    const before = await fleetDealershipRepository.getById(id);
    const current = before.image ?? null;
    const isFirst = current === null;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'fleet',
          entityType: 'dealershipInvoice',
          entityId: id,
          categoryId: await resolveDealershipDocsCategoryId(),
          displayName: `${before.workTypeLabel} — dealership invoice`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }
    try {
      await fleetDealershipRepository.updateById(
        id,
        {
          image: {
            fileId: file._id,
            fileName: file.originalName,
            mime: file.mime,
            size: file.size,
            uploadedAt: new Date(),
          },
        },
        { by: ctx.userId, version: before.__v },
      );
    } catch (error) {
      // A first upload that never got linked is an orphan; a replace is retained history.
      if (isFirst) await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw error;
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'image',
          old: before.image == null ? null : String(before.image.fileId),
          new: String(file._id),
        },
      ],
    });
    return this.get(id);
  }

  async readImage(
    ctx: AuthContext,
    id: string,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const row = await fleetDealershipRepository.getById(id);
    if (row.image == null) throw new NotFoundError('this invoice has no image');
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(ctx, String(row.image.fileId));
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  async deleteImage(ctx: AuthContext, id: string): Promise<DealershipInvoiceWithJoins> {
    const before = await fleetDealershipRepository.getById(id);
    if (before.image == null) throw new ConflictError('this invoice has no image to delete');
    const fileId = String(before.image.fileId);
    await fleetDealershipRepository.updateById(
      id,
      { image: null },
      {
        by: ctx.userId,
        version: before.__v,
      },
    );
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'image', old: fileId, new: null }],
    });
    return this.get(id);
  }
}

export const fleetDealershipService = new FleetDealershipService();
