// Vehicle device checks — «فحص أجهزة السيارة» (FR-21; docs/12-planning/it-vehicle-checks-design.md
// §6.1): the car list the phone form offers, filing a report, and adding its photos.
//
// Every path ignores the reporter's data scope (design §4): the form offers every active car, and
// `own` over cars would be no car at all. Scope will govern READING reports, which the dashboard
// brings; each report keeps the car's branch for it.
import { Types } from 'mongoose';
import {
  ErrorCodes,
  IT_VEHICLE_CHECK_ITEMS,
  IT_VEHICLE_CHECK_MAX_PHOTOS,
  IT_VEHICLE_CHECK_PHOTO_WINDOW_HOURS,
  ymdOf,
  ymdToUtcDate,
  type CreateItVehicleCheck,
  type Paginated,
} from '@ecms/contracts';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  StaleDocumentError,
} from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../../platform/audit';
import { fileService, type UploadedBinary } from '../../../platform/files';
import {
  findVehicleForCheck,
  listActiveVehicleCodes,
  type ItVehicleOption,
} from '../fleet-boundary';
import { itVehicleCheckRepository } from './vehicle-check.repository';
import { vehicleCheckPhotoCategory } from './vehicle-check-files';
import { type ItVehicleCheckDoc, type ItVehicleCheckItemsSub } from './vehicle-check.model';

/** The audited entity — a LITERAL pair, so the realtime registry's scan can classify it. */
const vehicleCheckEntityRef = (id: string) => ({
  moduleId: 'it',
  entityType: 'vehicleCheck',
  entityId: id,
});

/** The reporter's name as the IT histories snapshot an actor. */
const actorNameOf = (ctx: AuthContext): string =>
  ctx.identity?.displayName?.[ctx.locale === 'ar' ? 'ar' : 'en'] ?? '';

const WINDOW_MS = IT_VEHICLE_CHECK_PHOTO_WINDOW_HOURS * 60 * 60 * 1000;

/** A filing's answer: the report, and whether this send created it (201) or found it (200). */
export interface ItVehicleCheckFiling {
  report: ItVehicleCheckDoc;
  created: boolean;
}

class ItVehicleCheckService {
  /** One page of the active cars in Fleet's code order — the form walks every page (ADR-037). */
  async listActiveVehicleCodes(query: {
    page: number;
    pageSize: number;
  }): Promise<Paginated<ItVehicleOption>> {
    return listActiveVehicleCodes({ page: query.page, pageSize: query.pageSize });
  }

  /**
   * File a report (design §6.1 "Filing"). A repeated `clientRequestId` answers with the report it
   * already filed — to the same reporter, whatever has changed since — and is refused (409) to
   * anyone else.
   */
  async file(input: CreateItVehicleCheck, ctx: AuthContext): Promise<ItVehicleCheckFiling> {
    // 1. A repeat is answered before anything about the car is judged: the car may be inactive
    //    by now, and the report was filed when it was not.
    const existing = await itVehicleCheckRepository.findByClientRequestId(input.clientRequestId);
    if (existing !== null) return this.repeated(existing, ctx);

    // 2. The car, through the Fleet boundary.
    const vehicle = await findVehicleForCheck(input.vehicleId);
    if (vehicle === null) throw new NotFoundError('vehicle not found');
    if (vehicle.status !== 'active') {
      throw new BusinessRuleError(
        `vehicle ${vehicle.code} is not active; a check is filed on an active car`,
        ErrorCodes.IT_VEHICLE_NOT_ACTIVE,
      );
    }

    // 3. The report: the car's code and branch at filing, the reporter, every answer (a missing
    //    key is unanswered), the trimmed note — absent when empty.
    const items = Object.fromEntries(
      IT_VEHICLE_CHECK_ITEMS.map((key) => [key, input.items?.[key] ?? null]),
    ) as ItVehicleCheckItemsSub;
    const notes = input.notes?.trim() ?? '';
    await itVehicleCheckRepository.ensureCollection();
    let report: ItVehicleCheckDoc;
    try {
      report = await itVehicleCheckRepository.create(
        {
          vehicleId: new Types.ObjectId(vehicle.id),
          vehicleCode: vehicle.code,
          branchId: vehicle.branchId === null ? null : new Types.ObjectId(vehicle.branchId),
          checkDate: ymdToUtcDate(input.checkDate),
          items,
          ...(notes === '' ? {} : { notes }),
          photos: [],
          reportedByUserId: new Types.ObjectId(ctx.userId),
          reportedByName: actorNameOf(ctx),
          clientRequestId: input.clientRequestId,
        },
        { by: ctx.userId },
      );
    } catch (error) {
      // 4. Two sends of one report raced, and the other one's insert won the unique index: answer
      //    with the report it filed, as step 1 would have.
      if (error instanceof ConflictError) {
        const raced = await itVehicleCheckRepository.findByClientRequestId(input.clientRequestId);
        if (raced !== null) return this.repeated(raced, ctx);
      }
      throw error;
    }

    // 5. The trail.
    await auditService.record({
      entityRef: vehicleCheckEntityRef(String(report._id)),
      action: 'create',
      changes: diffChanges(
        {},
        {
          vehicleId: String(report.vehicleId),
          vehicleCode: report.vehicleCode,
          branchId: report.branchId === null ? null : String(report.branchId),
          checkDate: ymdOf(report.checkDate),
          items: report.items,
          notes: report.notes ?? null,
          clientRequestId: report.clientRequestId,
        },
      ),
    });
    return { report, created: true };
  }

  /** A request id already filed: the same reporter gets their report, anyone else a 409. */
  private repeated(report: ItVehicleCheckDoc, ctx: AuthContext): ItVehicleCheckFiling {
    if (String(report.reportedByUserId) !== ctx.userId) {
      throw new ConflictError(
        'another user already filed a report with this clientRequestId',
        ErrorCodes.IT_VEHICLE_CHECK_REQUEST_REUSED,
      );
    }
    return { report, created: false };
  }

  /**
   * Add one photo to one's own report (design §6.1 "Photos"). Every refusal runs BEFORE the file
   * is stored, so a refused photo stores nothing; and one atomic conditional update guards the
   * five-photo and 24-hour limits, so racing uploads cannot exceed them.
   */
  async addPhoto(
    ctx: AuthContext,
    id: string,
    clientPhotoId: string,
    binary: UploadedBinary,
  ): Promise<ItVehicleCheckDoc> {
    const now = Date.now();
    // 1–3. The report, then the rules it must meet.
    const report = this.settle(
      await itVehicleCheckRepository.findOwnLive(id, ctx.userId),
      clientPhotoId,
      now,
    );
    if (report.photos.some((photo) => photo.clientPhotoId === clientPhotoId)) return report;

    // 4. The bytes, through the Files service (whose category refuses a wrong type or size). The
    //    display name carries NO extension: the platform keeps the stored one apart and appends it
    //    on download (`${displayName}${extension}`), so a fixed '.jpg' would read '….jpg.jpg' — or
    //    '….jpg.png' for a photo the phone could not re-encode and sent as it was. `n` is the place
    //    the photo takes when its upload begins; the form sends one photo at a time, so there it
    //    is the photo's number, but two racing uploads may share one — a name, never a key.
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'it',
        entityType: 'vehicleCheck',
        entityId: id,
        categoryId: await vehicleCheckPhotoCategory(),
        displayName: `vehicle-check-${ymdOf(report.checkDate)}-${report.vehicleCode}-${report.photos.length + 1}`,
        visibility: 'private',
        tags: [],
      },
      binary,
    );

    // 5. The link, only if every rule still holds at the moment it is written.
    const updated = await itVehicleCheckRepository.pushPhoto(
      id,
      ctx.userId,
      {
        clientPhotoId,
        fileId: file._id,
        fileName: file.originalName,
        mime: file.mime,
        size: file.size,
        uploadedAt: new Date(),
      },
      new Date(now - WINDOW_MS),
    );

    if (updated === null) {
      // 6. A racing upload or a deletion got there first. The stored file is an orphan — withdrawn,
      //    best effort, as the custody signed copy's is — and the caller is told which rule the
      //    report now meets.
      await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      const current = this.settle(
        await itVehicleCheckRepository.findOwnLive(id, ctx.userId),
        clientPhotoId,
        now,
      );
      if (current.photos.some((photo) => photo.clientPhotoId === clientPhotoId)) return current;
      // Unreachable while the rules above and the update's filter agree; never a silent success.
      throw new StaleDocumentError();
    }

    // 7. The trail: this one photo added. `old` comes from the update's own result, not from the
    //    read in step 1 — under racing uploads that read is out of date by the time the push lands.
    await auditService.record({
      entityRef: vehicleCheckEntityRef(id),
      action: 'update',
      changes: [
        {
          field: 'photos',
          old: updated.photos
            .filter((photo) => photo.clientPhotoId !== clientPhotoId)
            .map((photo) => String(photo.fileId)),
          new: updated.photos.map((photo) => String(photo.fileId)),
        },
      ],
    });
    return updated;
  }

  /**
   * The first rule a report meets, in the design's order: not found (404); the same photo already
   * on it (answered by the caller, 200); the window closed (422); the limit reached (422).
   * Returns the report when a photo may still be added — or when this photo is already there.
   */
  private settle(
    report: ItVehicleCheckDoc | null,
    clientPhotoId: string,
    now: number,
  ): ItVehicleCheckDoc {
    if (report === null) throw new NotFoundError('vehicle check not found');
    if (report.photos.some((photo) => photo.clientPhotoId === clientPhotoId)) return report;
    if (report.createdAt.getTime() < now - WINDOW_MS) {
      throw new BusinessRuleError(
        `photos are added within ${IT_VEHICLE_CHECK_PHOTO_WINDOW_HOURS} hours of filing`,
        ErrorCodes.IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED,
      );
    }
    if (report.photos.length >= IT_VEHICLE_CHECK_MAX_PHOTOS) {
      throw new BusinessRuleError(
        `a report holds at most ${IT_VEHICLE_CHECK_MAX_PHOTOS} photos`,
        ErrorCodes.IT_VEHICLE_CHECK_PHOTO_LIMIT,
      );
    }
    return report;
  }
}

export const itVehicleCheckService = new ItVehicleCheckService();
