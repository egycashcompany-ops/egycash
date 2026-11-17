// Vehicle device checks — «فحص أجهزة السيارة» (FR-21; docs/12-planning/it-vehicle-checks-design.md
// §6.1): the car list the phone form offers, filing a report, and adding its photos; and since
// 2026-11-10 («تمام نفذا الـ Dashboard بتاعت الفحص») IT's dashboard over them — the figures, the
// reports list, one report, its photos, and deleting a wrong one.
//
// The form's paths ignore the reporter's data scope (design §4): the form offers every active car,
// and `own` over cars would be no car at all. The dashboard's paths are the opposite: every read
// and the delete run under the caller's scope for their own key, on the branch each report keeps.
import { Types } from 'mongoose';
import {
  ErrorCodes,
  IT_VEHICLE_CHECK_ITEMS,
  IT_VEHICLE_CHECK_MAX_PHOTOS,
  IT_VEHICLE_CHECK_PHOTO_WINDOW_HOURS,
  cairoYmd,
  vehicleCheckNeedsNotes,
  ymdOf,
  ymdToUtcDate,
  type CreateItVehicleCheck,
  type ItVehicleCheckDashboardDto,
  type ItVehicleCheckDashboardQuery,
  type ListItVehicleChecksQuery,
  type Paginated,
} from '@ecms/contracts';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  StaleDocumentError,
} from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../../platform/audit';
import { fileService, type UploadedBinary } from '../../../platform/files';
import { publishAuditedChange } from '../../../platform/realtime';
import {
  findVehicleForCheck,
  listActiveVehicleCodes,
  listActiveVehiclesForCheckBoard,
  type ItVehicleOption,
} from '../fleet-boundary';
import { toItVehicleCheckLatestDto } from '../it.mappers';
import { itVehicleCheckRepository } from './vehicle-check.repository';
import { vehicleCheckPhotoCategory } from './vehicle-check-files';
import {
  buildVehicleCheckDashboard,
  carsVisibleTo,
  dashboardWindow,
  latestReportsFilter,
  vehicleCheckListFilter,
} from './vehicle-check-dashboard';
import { type ItVehicleCheckDoc, type ItVehicleCheckItemsSub } from './vehicle-check.model';

/** The audited entity — a LITERAL pair, so the realtime registry's scan can classify it. */
const vehicleCheckEntityRef = (id: string) => ({
  moduleId: 'it',
  entityType: 'vehicleCheck',
  entityId: id,
});

/**
 * A report filed, a photo added or a report deleted refreshes «فحص أجهزة السيارات». The audit row
 * announces itself (ADR-029), but with no branch, so it reaches only the topic's organization-wide
 * room — and a branch-scoped `itVehicleCheck.view` reader, who joins only their branches' rooms,
 * would never hear of a report on their own branch's car. One `update` signal WITH the report's
 * branch (the car's at filing, the scope anchor) reaches that branch's room too; a report with no
 * branch is for organization-wide readers only, so it goes to their room alone. No audit row of
 * its own — `signalConsumable`'s precedent. Best-effort, as every signal is.
 */
export const signalVehicleCheck = (report: Pick<ItVehicleCheckDoc, '_id' | 'branchId'>): void => {
  publishAuditedChange({
    entityRef: { moduleId: 'it', entityType: 'vehicleCheck', entityId: String(report._id) },
    action: 'update',
    at: new Date().toISOString(),
    branchId: report.branchId === null ? null : String(report.branchId),
  });
};

/** A report as its audit rows describe it — what was filed, and never changes once filed. */
const filedFacts = (report: ItVehicleCheckDoc) => ({
  vehicleId: String(report.vehicleId),
  vehicleCode: report.vehicleCode,
  branchId: report.branchId === null ? null : String(report.branchId),
  checkDate: ymdOf(report.checkDate),
  items: report.items,
  notes: report.notes ?? null,
  clientRequestId: report.clientRequestId,
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

    // 1b. «كمان عايز الملاحظة إجبارى لو فى حاجة لا تعمل»: a device «لا يعمل» needs a note saying
    //     what is wrong. After the repeat, so a report filed before this rule still answers 200.
    if (vehicleCheckNeedsNotes(input.items) && (input.notes?.trim() ?? '') === '') {
      throw new BusinessRuleError(
        'a report with a device «لا يعمل» carries a note',
        ErrorCodes.IT_VEHICLE_CHECK_NOTES_REQUIRED,
      );
    }

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

    // 5. The trail, and the dashboard's signal — for a NEW report only: a repeat changed nothing.
    await auditService.record({
      entityRef: vehicleCheckEntityRef(String(report._id)),
      action: 'create',
      changes: diffChanges({}, filedFacts(report)),
    });
    signalVehicleCheck(report);
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
    //    Then the dashboard's signal; a photo already there (the early returns) added nothing.
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
    signalVehicleCheck(updated);
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

  // ── The dashboard (2026-11-10): reads and the delete, each under the caller's scope ──────────

  /**
   * «فحص أجهزة السيارات» — the tiles, «الأعطال حسب الجهاز», «لم تُفحص منذ ٧ أيام» and the matrix,
   * in three reads whatever the size of the fleet: Fleet's active cars and the window's figures
   * together, then each visible car's latest report in one aggregation — never a read per car.
   * The rules are `vehicle-check-dashboard.ts`'s; this only reads.
   */
  async dashboard(
    query: ItVehicleCheckDashboardQuery,
    scope: ScopeSelector,
  ): Promise<ItVehicleCheckDashboardDto> {
    const today = cairoYmd(new Date());
    const window = dashboardWindow(query, today);
    const [fleet, period] = await Promise.all([
      listActiveVehiclesForCheckBoard(),
      itVehicleCheckRepository.windowFigures(
        vehicleCheckListFilter({
          from: window.from,
          to: window.to,
          ...(query.branchId === undefined ? {} : { branchId: query.branchId }),
        }),
        scope,
      ),
    ]);
    const cars = carsVisibleTo(fleet, scope, query.branchId);
    const latest =
      cars.length === 0
        ? []
        : await itVehicleCheckRepository.latestPerVehicle(
            latestReportsFilter(cars, query.branchId),
            scope,
          );
    return buildVehicleCheckDashboard({
      window,
      today,
      cars,
      latest: latest.map(toItVehicleCheckLatestDto),
      period,
    });
  }

  /** «آخر التقارير» under every filter, the newest first. */
  async list(
    query: ListItVehicleChecksQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItVehicleCheckDoc>> {
    return itVehicleCheckRepository.listNewestFirst(vehicleCheckListFilter(query), query, scope);
  }

  /**
   * One live report the reader may see. Missing, deleted and outside the scope are one answer
   * (404), so a reader learns nothing of a report they may not read.
   */
  async get(id: string, scope: ScopeSelector): Promise<ItVehicleCheckDoc> {
    const report = await itVehicleCheckRepository.findById(id, scope);
    if (report === null) throw new NotFoundError('vehicle check not found');
    return report;
  }

  /**
   * One photo's bytes — the custody signed copy's path: the report first, under the reader's
   * scope; the file only when it is one of THAT report's photos (an id of another report's photo
   * is a 404 here, never a way round its scope); then the Files service, whose entity authorizer
   * asks the same grant again.
   */
  async readPhoto(
    ctx: AuthContext,
    id: string,
    fileId: string,
    scope: ScopeSelector,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const report = await this.get(id, scope);
    if (!report.photos.some((photo) => String(photo.fileId) === fileId)) {
      throw new NotFoundError('this photo is not on this report');
    }
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(ctx, fileId);
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  /**
   * «حذف التقرير» — a wrong report, soft-deleted under the caller's delete scope (design §3: a
   * wrong report was corrected by filing again until IT's delete grant arrived). The photos stay
   * stored, as no retention is set (design §7), and simply become unreachable: every read goes
   * through a live report. The car's latest report is then the one before it.
   */
  async remove(id: string, ctx: AuthContext, scope: ScopeSelector): Promise<void> {
    const report = await this.get(id, scope);
    await itVehicleCheckRepository.softDeleteById(id, { by: ctx.userId, scope });
    await auditService.record({
      entityRef: vehicleCheckEntityRef(id),
      action: 'delete',
      changes: diffChanges(
        { ...filedFacts(report), photos: report.photos.map((photo) => String(photo.fileId)) },
        {},
      ),
    });
    signalVehicleCheck(report);
  }
}

export const itVehicleCheckService = new ItVehicleCheckService();
