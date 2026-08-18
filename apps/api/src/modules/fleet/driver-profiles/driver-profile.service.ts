// Driver profiles (fleet design §2.3, FR-11). Creation validates the employee through the
// platform directory seam — Fleet never imports HR — and refuses an exited employee: a profile
// is an operational capability, and you cannot enroll someone who is no longer employed.
// No domain events: the frozen surface (§8) has none for profiles; enrollment is configuration.
import {
  FleetEvents,
  type CreateFleetDriverProfile,
  type ListFleetDriversQuery,
  type Paginated,
  type UpdateFleetDriverProfile,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployee } from '../../../platform/directory';
import { emit } from '../../../platform/kernel/event-bus';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { diffChanges } from '../../../shared/utils/diff';
import { resolveDriverDocsCategoryId } from './driver-files';
import { fleetDriverProfileRepository } from './driver-profile.repository';
import { DRIVER_PROFILE_KIND, type FleetDriverProfileDoc } from './driver-profile.model';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'driverProfile',
  entityId: id,
});

const snapshot = (doc: FleetDriverProfileDoc) => ({
  employeeId: String(doc.employeeId),
  licenseNumber: doc.licenseNumber,
  licenseExpiresAt: doc.licenseExpiresAt,
  specialization: doc.specialization,
  area: doc.area,
  isActive: doc.isActive,
  // `== null` covers both "no scan" (null) and "row predates the field" (absent from the BSON).
  licenseImage: doc.licenseImage == null ? null : String(doc.licenseImage.fileId),
});

/** Case-insensitive substring match with the user's input treated as text, not as a pattern. */
const rx = (term: string): RegExp => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

class FleetDriverProfileService {
  async create(input: CreateFleetDriverProfile, by: string): Promise<FleetDriverProfileDoc> {
    const employee = await getDirectoryEmployee(input.employeeId);
    if (employee === null) {
      throw new ValidationError([
        { field: 'body.employeeId', code: 'UNKNOWN', message: 'employee not found' },
      ]);
    }
    if (employee.status === 'exited') {
      throw new ConflictError('an exited employee cannot be enrolled as a driver');
    }
    const existing = await fleetDriverProfileRepository.findDriverByEmployeeId(input.employeeId);
    if (existing !== null) {
      throw new ConflictError(`employee ${employee.code} already has a driver profile`);
    }

    const doc = await fleetDriverProfileRepository.create(
      {
        employeeId: new Types.ObjectId(input.employeeId),
        kind: DRIVER_PROFILE_KIND,
        licenseNumber: input.licenseNumber,
        licenseExpiresAt: input.licenseExpiresAt,
        specialization: input.specialization,
        area: input.area ?? null,
        isActive: true,
        licenseImage: null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListFleetDriversQuery): Promise<Paginated<FleetDriverProfileDoc>> {
    const clauses: FilterQuery<FleetDriverProfileDoc>[] = [];
    if (query.specialization !== undefined) {
      clauses.push({ specialization: query.specialization });
    }
    if (query.isActive !== undefined) clauses.push({ isActive: query.isActive });
    if (query.licenseExpiresBefore !== undefined) {
      clauses.push({ licenseExpiresAt: { $lte: query.licenseExpiresBefore } });
    }
    if (query.search !== undefined) {
      clauses.push({ licenseNumber: rx(query.search) });
    }
    if (query.area !== undefined) clauses.push({ area: rx(query.area) });
    if (query.hasLicenseImage !== undefined) {
      // `$ne: null` rather than `$exists`, and that is the whole point: a profile written before
      // the field existed has NO key, so `{ licenseImage: { $exists: true } }` would call it
      // "has an image" for the absent-vs-null distinction and `{ $exists: false }` would miss
      // every row explicitly set to null. `$ne: null` treats absent and null as the same answer,
      // which is what the question "does this driver have a scan on file?" actually means.
      clauses.push(
        query.hasLicenseImage ? { licenseImage: { $ne: null } } : { licenseImage: null },
      );
    }
    return fleetDriverProfileRepository.listDrivers({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  async getById(id: string): Promise<FleetDriverProfileDoc> {
    return fleetDriverProfileRepository.getById(id);
  }

  async update(
    id: string,
    input: UpdateFleetDriverProfile,
    by: string,
  ): Promise<FleetDriverProfileDoc> {
    const before = await fleetDriverProfileRepository.getById(id);
    const set: Partial<FleetDriverProfileDoc> = {};
    if (input.licenseNumber !== undefined) set.licenseNumber = input.licenseNumber;
    if (input.licenseExpiresAt !== undefined) set.licenseExpiresAt = input.licenseExpiresAt;
    if (input.specialization !== undefined) set.specialization = input.specialization;
    if (input.area !== undefined) set.area = input.area ?? null;
    if (input.isActive !== undefined) set.isActive = input.isActive;

    const updated = await fleetDriverProfileRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  // ── Licence image (Files owns the bytes, the profile owns the link) ───────

  /**
   * Attach or REPLACE the driver's licence scan.
   *
   * Replace rather than a second row: a driver has one current licence document, and the previous
   * one is not lost — `fileService.replace` keeps it as an earlier version of the same file group,
   * so the history survives while the profile keeps pointing at exactly one thing.
   *
   * The whole intake rule set (mime, size) is the file CATEGORY's, enforced inside the Files
   * service. Nothing here re-implements it — this method's job is the profile-side invariants.
   */
  async setLicenseImage(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
  ): Promise<FleetDriverProfileDoc> {
    const before = await fleetDriverProfileRepository.getById(id);
    // `== null` covers both "no image yet" (null) and "row predates the field" (undefined);
    // `=== null` would send a legacy profile down the REPLACE path with nothing to replace.
    const current = before.licenseImage ?? null;
    const isFirst = current === null;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'fleet',
          entityType: 'driverProfile',
          entityId: id,
          categoryId: await resolveDriverDocsCategoryId(),
          displayName: `${before.licenseNumber} — driver license`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }

    let updated: FleetDriverProfileDoc;
    try {
      updated = await fleetDriverProfileRepository.updateById(
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
        { by: ctx.userId, version: before.__v },
      );
    } catch (error) {
      // The bytes are already stored, and the link never landed. A FIRST upload leaves a file
      // group nothing references — a true orphan — so it is withdrawn here; the version guard
      // above can lose the race to a concurrent edit, which is exactly when this fires.
      //
      // A REPLACE needs no compensation: it added version n+1 to the group the profile already
      // points at, so the profile still resolves to version n and the extra version is retained
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
          old: before.licenseImage == null ? null : String(before.licenseImage.fileId),
          new: String(file._id),
        },
      ],
    });
    await emit(FleetEvents.DriverLicenseImageUploaded, {
      driverProfileId: id,
      employeeId: String(updated.employeeId),
      fileId: String(file._id),
    });
    return updated;
  }

  /**
   * The bytes, for rendering.
   *
   * Authorization is the caller's `fleetDriver.view`, applied on the route; the Files service then
   * re-asks Fleet through the ADR-023 authorizer, so the check is made twice by two independent
   * paths.
   *
   * `readEntityOwnedBuffer`, not `readBuffer`: the latter additionally demands the platform's
   * `file.download` grant for a private file, which no fleet role holds — every licence image
   * would 403 for exactly the people who own it.
   */
  async readLicenseImage(
    ctx: AuthContext,
    id: string,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const profile = await fleetDriverProfileRepository.getById(id);
    if (profile.licenseImage == null) {
      throw new NotFoundError('this driver has no license image');
    }
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(
      ctx,
      String(profile.licenseImage.fileId),
    );
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  /**
   * Detach the licence image. The PROFILE is untouched beyond losing the link, and the file is
   * soft-deleted rather than purged — the same "delete is recoverable" rule the rest of the module
   * follows. A profile with no image is not an error to delete from: it is a no-op worth refusing
   * so the UI never shows a delete action that does nothing.
   */
  async deleteLicenseImage(ctx: AuthContext, id: string): Promise<FleetDriverProfileDoc> {
    const before = await fleetDriverProfileRepository.getById(id);
    if (before.licenseImage == null) {
      throw new ConflictError('this driver has no license image to delete');
    }
    const fileId = String(before.licenseImage.fileId);
    const updated = await fleetDriverProfileRepository.updateById(
      id,
      { licenseImage: null },
      { by: ctx.userId, version: before.__v },
    );
    // After the profile write, so a failed detach never leaves the row pointing at a deleted file.
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'licenseImage', old: fileId, new: null }],
    });
    await emit(FleetEvents.DriverLicenseImageDeleted, {
      driverProfileId: id,
      employeeId: String(updated.employeeId),
      fileId: null,
    });
    return updated;
  }

  /** `hr.employee.exited` subscription (design §9.1): leaving the company leaves the pool. */
  async deactivateForExitedEmployee(employeeId: string): Promise<void> {
    const profile = await fleetDriverProfileRepository.findDriverByEmployeeId(employeeId);
    if (profile === null || !profile.isActive) return;
    await fleetDriverProfileRepository.updateById(
      String(profile._id),
      { isActive: false },
      { by: null, version: profile.__v },
    );
    await auditService.record({
      entityRef: entityRef(String(profile._id)),
      action: 'update',
      changes: [{ field: 'isActive', old: true, new: false }],
    });
  }
}

export const fleetDriverProfileService = new FleetDriverProfileService();
