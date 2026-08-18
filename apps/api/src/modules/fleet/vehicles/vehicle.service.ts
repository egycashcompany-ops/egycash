// The vehicle registry service (fleet design §2.1, §4.1). Events fire at commit points only —
// after the repository write has succeeded — and every mutation is version-aware and audited.
import {
  FleetEvents,
  FleetSettingKeys,
  type ChangeFleetVehicleStatus,
  type CreateFleetVehicle,
  type FleetCatalogKind,
  type FleetDefaultBranchDto,
  type ListFleetVehiclesQuery,
  type Paginated,
  type UpdateFleetVehicle,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { fileService, type UploadedBinary, type FileDoc } from '../../../platform/files';
import { branchRepository } from '../../../platform/organization';
import { settingsService } from '../../../platform/settings';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { fleetMaintenanceRepository } from '../maintenance/maintenance.repository';
import {
  fleetVehicleRepository,
  vehicleIdentifierFilter,
  vehicleSearchFilter,
} from './vehicle.repository';
import { resolveVehicleDocsCategoryId } from './vehicle-files';
import { canTransitionVehicle, isVehicleWritable } from './vehicle-status';
import { FleetVehicleModel, type FleetVehicleDoc } from './vehicle.model';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'vehicle', entityId: id });

const ORG = { userId: null, branchId: null };

const idOrNull = (value: Types.ObjectId | null): string | null =>
  value === null ? null : String(value);

/**
 * The audited surface — everything an admin can change, nothing derived.
 *
 * The license image is in here (as its file id) because swapping a vehicle's license scan IS an
 * administrative change to the record, and §14 asks for it to be traceable. The legacy free-text
 * `licenseClass` is NOT: nothing writes it any more, so a diff over it could only ever be empty.
 */
const snapshot = (doc: FleetVehicleDoc) => ({
  code: doc.code,
  typeId: String(doc.typeId),
  plateNumber: doc.plateNumber,
  chassisNumber: doc.chassisNumber,
  motorNumber: doc.motorNumber,
  joinedAt: doc.joinedAt,
  licenseExpiresAt: doc.licenseExpiresAt,
  licenseClassId: idOrNull(doc.licenseClassId),
  operationId: idOrNull(doc.operationId),
  insuranceCompanyId: idOrNull(doc.insuranceCompanyId),
  branchId: idOrNull(doc.branchId),
  departmentId: idOrNull(doc.departmentId),
  radio: doc.radio,
  status: doc.status,
  statusReason: doc.statusReason,
  licenseImageFileId: doc.licenseImage === null ? null : String(doc.licenseImage.fileId),
});

const eventPayload = (doc: FleetVehicleDoc) => ({
  vehicleId: String(doc._id),
  code: doc.code,
  typeId: String(doc.typeId),
});

class FleetVehicleService {
  private async assertTypeActive(typeId: string): Promise<void> {
    const type = await fleetVehicleTypeRepository.findActiveById(typeId);
    if (type === null) {
      throw new ValidationError([
        { field: 'body.typeId', code: 'UNKNOWN', message: 'vehicle type not found or inactive' },
      ]);
    }
  }

  /**
   * A catalog reference must name a LIVE item OF THE RIGHT KIND. Checking the kind is the point:
   * an id alone would let an insurance company be stored as a license class, and both are valid
   * ids in the same collection.
   */
  private async assertCatalogRef(
    id: string,
    kind: FleetCatalogKind,
    field: string,
  ): Promise<void> {
    const item = await fleetCatalogItemRepository.findActiveOfKind(id, kind);
    if (item === null) {
      throw new ValidationError([
        { field: `body.${field}`, code: 'UNKNOWN', message: `${kind} not found or inactive` },
      ]);
    }
  }

  /** Validates whichever of the three catalog references the payload actually carries. */
  private async assertCatalogRefs(input: {
    licenseClassId?: string | null | undefined;
    operationId?: string | null | undefined;
    insuranceCompanyId?: string | null | undefined;
  }): Promise<void> {
    const refs: [string | null | undefined, FleetCatalogKind, string][] = [
      [input.licenseClassId, 'licenseClass', 'licenseClassId'],
      [input.operationId, 'operation', 'operationId'],
      [input.insuranceCompanyId, 'insuranceCompany', 'insuranceCompanyId'],
    ];
    for (const [id, kind, field] of refs) {
      if (id != null) await this.assertCatalogRef(id, kind, field);
    }
  }

  /**
   * A vehicle's branch must exist and be active. The zod schema already refuses `null`, so what
   * this adds is the part a schema cannot know: that the id names a real, live branch. Together
   * they are what makes "no vehicle without a branch" true even against a hand-made request.
   */
  private async assertBranch(branchId: string): Promise<void> {
    const branch = await branchRepository.findById(branchId);
    if (branch === null || branch.status !== 'active') {
      throw new ValidationError([
        { field: 'body.branchId', code: 'UNKNOWN', message: 'branch not found or inactive' },
      ]);
    }
  }

  /**
   * The branch the create form preselects (§2.1), resolved BY NAME from live branch data on every
   * call — never a baked-in id, which would differ per environment and rot on the first rename.
   *
   * Answering with `branchId: null` rather than throwing is deliberate: a missing default is not
   * an error, it is a fact the form needs, and the form still requires the user to pick a branch.
   */
  async defaultBranch(): Promise<FleetDefaultBranchDto> {
    const configuredName = await settingsService.resolve<string>(
      FleetSettingKeys.DefaultBranchName,
      ORG,
    );
    // `findByName` matches EITHER language case-insensitively, so one configured value serves an
    // Arabic-named branch and an English-named one alike.
    const branch = await branchRepository.findByName({ ar: configuredName, en: configuredName });
    if (branch === null || branch.status !== 'active') {
      return { branchId: null, name: null, configuredName };
    }
    return { branchId: String(branch._id), name: branch.name, configuredName };
  }

  async create(input: CreateFleetVehicle, by: string): Promise<FleetVehicleDoc> {
    await this.assertTypeActive(input.typeId);
    await this.assertBranch(input.branchId);
    await this.assertCatalogRefs(input);
    // The unique partial indexes are the authority (FR-1); the pre-check exists only to name the
    // colliding field in the 409 instead of surfacing a raw duplicate-key error.
    const existing = await fleetVehicleRepository.findByCode(input.code);
    if (existing !== null) throw new ConflictError(`vehicle code "${input.code}" already exists`);

    const doc = await fleetVehicleRepository.create(
      {
        code: input.code,
        typeId: new Types.ObjectId(input.typeId),
        plateNumber: input.plateNumber,
        chassisNumber: input.chassisNumber,
        motorNumber: input.motorNumber,
        joinedAt: input.joinedAt,
        licenseExpiresAt: input.licenseExpiresAt,
        licenseClass: null,
        licenseClassId:
          input.licenseClassId == null ? null : new Types.ObjectId(input.licenseClassId),
        operationId: input.operationId == null ? null : new Types.ObjectId(input.operationId),
        insuranceCompanyId:
          input.insuranceCompanyId == null ? null : new Types.ObjectId(input.insuranceCompanyId),
        branchId: new Types.ObjectId(input.branchId),
        departmentId: input.departmentId == null ? null : new Types.ObjectId(input.departmentId),
        radio: { issi: input.radio.issi ?? null, motorolaSn: input.radio.motorolaSn ?? null },
        status: 'active',
        statusReason: null,
        licenseImage: null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(FleetEvents.VehicleCreated, eventPayload(doc));
    return doc;
  }

  async list(
    query: ListFleetVehiclesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<FleetVehicleDoc>> {
    const clauses: FilterQuery<FleetVehicleDoc>[] = [];
    if (query.status !== undefined) clauses.push({ status: query.status });
    if (query.typeId !== undefined) clauses.push({ typeId: new Types.ObjectId(query.typeId) });
    if (query.branchId !== undefined) {
      clauses.push({ branchId: { $in: query.branchId.map((id) => new Types.ObjectId(id)) } });
    }
    // The three catalog filters, each an exact reference match.
    for (const [value, field] of [
      [query.licenseClassId, 'licenseClassId'],
      [query.operationId, 'operationId'],
      [query.insuranceCompanyId, 'insuranceCompanyId'],
    ] as const) {
      if (value !== undefined) clauses.push({ [field]: new Types.ObjectId(value) });
    }
    // Per-identifier narrowing, ANDed with everything else — see `vehicleIdentifierFilter`.
    for (const [value, field] of [
      [query.code, 'code'],
      [query.plateNumber, 'plateNumber'],
      [query.chassisNumber, 'chassisNumber'],
      [query.motorNumber, 'motorNumber'],
    ] as const) {
      if (value !== undefined) clauses.push(vehicleIdentifierFilter(field, value));
    }
    if (query.licenseExpiresBefore !== undefined) {
      clauses.push({ licenseExpiresAt: { $lte: query.licenseExpiresBefore } });
    }
    if (query.search !== undefined) clauses.push(vehicleSearchFilter(query.search));
    const filter = clauses.length === 0 ? {} : { $and: clauses };
    return fleetVehicleRepository.listVehicles({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  async getById(id: string, scope: ScopeSelector): Promise<FleetVehicleDoc> {
    return fleetVehicleRepository.getById(id, scope);
  }

  async update(
    id: string,
    input: UpdateFleetVehicle,
    by: string,
    scope: ScopeSelector,
  ): Promise<FleetVehicleDoc> {
    const before = await fleetVehicleRepository.getById(id, scope);
    if (!isVehicleWritable(before.status)) {
      throw new ConflictError('a disposed vehicle is history and cannot be edited');
    }
    if (input.typeId !== undefined) await this.assertTypeActive(input.typeId);
    if (input.branchId !== undefined) await this.assertBranch(input.branchId);
    await this.assertCatalogRefs(input);

    const set: Partial<FleetVehicleDoc> = {};
    if (input.code !== undefined) set.code = input.code;
    if (input.typeId !== undefined) set.typeId = new Types.ObjectId(input.typeId);
    if (input.plateNumber !== undefined) set.plateNumber = input.plateNumber;
    if (input.chassisNumber !== undefined) set.chassisNumber = input.chassisNumber;
    if (input.motorNumber !== undefined) set.motorNumber = input.motorNumber;
    if (input.joinedAt !== undefined) set.joinedAt = input.joinedAt;
    if (input.licenseExpiresAt !== undefined) set.licenseExpiresAt = input.licenseExpiresAt;
    // Each catalog reference clears to null when explicitly sent as null — an erased fact, the
    // same semantics the optional text fields already had.
    if (input.licenseClassId !== undefined) {
      set.licenseClassId =
        input.licenseClassId == null ? null : new Types.ObjectId(input.licenseClassId);
    }
    if (input.operationId !== undefined) {
      set.operationId = input.operationId == null ? null : new Types.ObjectId(input.operationId);
    }
    if (input.insuranceCompanyId !== undefined) {
      set.insuranceCompanyId =
        input.insuranceCompanyId == null ? null : new Types.ObjectId(input.insuranceCompanyId);
    }
    // No null branch: the schema refuses it, so `undefined` (untouched) is the only other case.
    if (input.branchId !== undefined) set.branchId = new Types.ObjectId(input.branchId);
    if (input.departmentId !== undefined) {
      set.departmentId = input.departmentId == null ? null : new Types.ObjectId(input.departmentId);
    }
    if (input.radio !== undefined) {
      set.radio = { issi: input.radio.issi ?? null, motorolaSn: input.radio.motorolaSn ?? null };
    }

    const updated = await fleetVehicleRepository.updateById(id, set, {
      by,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(FleetEvents.VehicleUpdated, eventPayload(updated));
    return updated;
  }

  async changeStatus(
    id: string,
    input: ChangeFleetVehicleStatus,
    by: string,
    scope: ScopeSelector,
  ): Promise<FleetVehicleDoc> {
    const before = await fleetVehicleRepository.getById(id, scope);
    if (!canTransitionVehicle(before.status, input.status)) {
      throw new ConflictError(
        `a ${before.status} vehicle cannot become ${input.status} (§4.1: disposed is terminal, no-ops are refused)`,
      );
    }
    const updated = await fleetVehicleRepository.updateById(
      id,
      // Returning to `active` clears the reason — the reason belongs to the absence, not the car.
      {
        status: input.status,
        statusReason: input.status === 'active' ? null : (input.reason ?? null),
      },
      { by, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [
        { field: 'status', old: before.status, new: updated.status },
        { field: 'statusReason', old: before.statusReason, new: updated.statusReason },
      ],
    });
    await emit(FleetEvents.VehicleStatusChanged, {
      vehicleId: String(updated._id),
      code: updated.code,
      from: before.status,
      to: updated.status,
      reason: updated.statusReason,
    });
    return updated;
  }

  // ── License image (§6/§8 — Files owns the bytes, the vehicle owns the link) ──

  /**
   * Attach or REPLACE the vehicle's license scan.
   *
   * Replace rather than a second row: a vehicle has one current license document, and the previous
   * one is not lost — `fileService.replace` keeps it as an earlier version of the same file group,
   * so the history survives while the vehicle keeps pointing at exactly one thing.
   *
   * The whole intake rule set (mime, size) is the file CATEGORY's, enforced inside the Files
   * service. Nothing here re-implements it — this method's job is the vehicle-side invariants.
   */
  async setLicenseImage(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<FleetVehicleDoc> {
    const before = await fleetVehicleRepository.getById(id, scope);
    if (!isVehicleWritable(before.status)) {
      throw new ConflictError('a disposed vehicle is history and cannot be edited');
    }

    const current = before.licenseImage;
    const isFirst = current === null;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'fleet',
          entityType: 'vehicle',
          entityId: id,
          categoryId: await resolveVehicleDocsCategoryId(),
          displayName: `${before.code} — vehicle license`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }

    let updated: FleetVehicleDoc;
    try {
      updated = await fleetVehicleRepository.updateById(
        id,
        {
          licenseImage: {
            fileId: file._id,
            fileName: file.originalName,
            mime: file.mime,
            size: file.size,
            uploadedAt: new Date(),
          },
        },
        { by: ctx.userId, version: before.__v, scope },
      );
    } catch (error) {
      // The bytes are already stored, and the link never landed. A FIRST upload leaves a file
      // group nothing references — a true orphan — so it is withdrawn here; the version guard
      // above can lose the race to a concurrent edit, which is exactly when this fires.
      //
      // A REPLACE needs no compensation: it added version n+1 to the group the vehicle already
      // points at, so the vehicle still resolves to version n and the extra version is retained
      // history, not an orphan. Deleting it would throw away a document instead of a dangling one.
      if (isFirst) await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw error;
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'licenseImage',
          old: before.licenseImage === null ? null : String(before.licenseImage.fileId),
          new: String(file._id),
        },
      ],
    });
    await emit(FleetEvents.VehicleLicenseImageUploaded, {
      vehicleId: id,
      code: updated.code,
      fileId: String(file._id),
    });
    return updated;
  }

  /**
   * The bytes, for rendering and printing.
   *
   * Authorization is the caller's `fleetVehicle.view` PLUS the data scope — the `getById` below is
   * both, and a vehicle outside the scope answers 404 rather than admitting it exists. The Files
   * service then re-asks Fleet through the ADR-023 authorizer, so the check is made twice by two
   * independent paths.
   *
   * `readEntityOwnedBuffer`, not `readBuffer`: the latter additionally demands the platform's
   * `file.download` grant for a private file, which no fleet role holds — every licence image
   * would 403 for exactly the people who own it (§13: the vehicle's grants govern its image).
   */
  async readLicenseImage(
    ctx: AuthContext,
    id: string,
    scope: ScopeSelector,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const vehicle = await fleetVehicleRepository.getById(id, scope);
    if (vehicle.licenseImage === null) {
      throw new NotFoundError('this vehicle has no license image');
    }
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(
      ctx,
      String(vehicle.licenseImage.fileId),
    );
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  /**
   * Detach the license image. The VEHICLE is untouched beyond losing the link, and the file is
   * soft-deleted rather than purged — the same "delete is recoverable" rule the rest of the module
   * follows. A vehicle with no image is not an error to delete from: it is a no-op worth refusing
   * so the UI never shows a delete action that does nothing.
   */
  async deleteLicenseImage(
    ctx: AuthContext,
    id: string,
    scope: ScopeSelector,
  ): Promise<FleetVehicleDoc> {
    const before = await fleetVehicleRepository.getById(id, scope);
    if (before.licenseImage === null) {
      throw new ConflictError('this vehicle has no license image to delete');
    }
    const fileId = String(before.licenseImage.fileId);
    const updated = await fleetVehicleRepository.updateById(
      id,
      { licenseImage: null },
      { by: ctx.userId, version: before.__v, scope },
    );
    // After the vehicle write, so a failed detach never leaves the row pointing at a deleted file.
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'licenseImage', old: fileId, new: null }],
    });
    await emit(FleetEvents.VehicleLicenseImageDeleted, {
      vehicleId: id,
      code: updated.code,
      fileId: null,
    });
    return updated;
  }

  async softDelete(id: string, by: string, scope: ScopeSelector): Promise<void> {
    await fleetVehicleRepository.getById(id, scope);
    await fleetVehicleRepository.softDeleteById(id, { by, scope });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  /**
   * DERIVED `inWorkshop` (FR-12) — real since FL-4: vehicles with an open maintenance visit.
   * The single source of a vehicle's assignability (owner FL-5 point 2): FL-5's roster asks
   * this seam with the plan date (FR-5) instead of re-deriving workshop state anywhere else.
   */
  async openVisitVehicleIds(
    vehicleIds: readonly string[],
    coveringDate?: Date,
  ): Promise<ReadonlySet<string>> {
    return fleetMaintenanceRepository.openVisitVehicleIds(vehicleIds, coveringDate);
  }
}

export { FleetVehicleModel };
export const fleetVehicleService = new FleetVehicleService();
