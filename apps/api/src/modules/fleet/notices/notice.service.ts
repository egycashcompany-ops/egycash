// Filled insurance notices — create, read, edit, soft-delete, the two scans, «✓», and each form's
// set-up. Audited like every Fleet record.
import { Types, type FilterQuery } from 'mongoose';
import {
  type CreateFleetNotice,
  type FleetLicenseImageDto,
  type FleetNoticeDto,
  type FleetNoticeImageKind,
  type FleetNoticeLicenceSource,
  type FleetNoticeSettingsDto,
  type FleetNoticesSummaryDto,
  type FleetNoticesSummaryQuery,
  type FleetNoticeTemplate,
  type ListFleetNoticesQuery,
  type Paginated,
  type SaveFleetNoticeSettings,
  type SetFleetNoticeDone,
  type UpdateFleetNotice,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { type AuthContext, hasPermission } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { fleetNoticeRepository } from './notice.repository';
import { fleetNoticeSettingsRepository } from './notice-settings.repository';
import { resolveNoticeDocsCategoryId } from './notice-files';
import { type FleetNoticeDoc, type FleetNoticeImage } from './notice.model';
import { type FleetNoticeSettingsDoc } from './notice-settings.model';

/**
 * A notice with what the registry adds: the car's code — what the table lists it by — and where the
 * car's and the driver's licence images come from.
 */
export type FleetNoticeWithCode = FleetNoticeDoc & {
  vehicleCode: string | null;
  vehicleLicense: FleetNoticeLicenceSource;
  driverLicense: FleetNoticeLicenceSource;
};

/** Which stored field each image is. */
const IMAGE_FIELD = {
  notice: 'noticeImage',
  check: 'checkImage',
  vehicleLicense: 'vehicleLicenseImage',
  driverLicense: 'driverLicenseImage',
} as const;

const IMAGE_NAME: Record<FleetNoticeImageKind, string> = {
  notice: 'notice — signed form',
  check: 'notice — cheque',
  vehicleLicense: 'notice — car licence',
  driverLicense: 'notice — driver licence',
};

/** The day after — a «to» date counts its whole day. */
const dayAfter = (day: Date): Date => new Date(day.getTime() + 24 * 60 * 60 * 1000);

/** The notices table's filters, as one database filter. */
const noticeFilter = async (
  query: FleetNoticesSummaryQuery,
): Promise<FilterQuery<FleetNoticeDoc>> => {
  const filter: FilterQuery<FleetNoticeDoc> = {};
  const templates = [
    ...(query.templates ?? []),
    ...(query.template === undefined ? [] : [query.template]),
  ];
  if (templates.length > 0) filter.template = { $in: templates };
  if (query.vehicleCodes !== undefined) {
    const ids = await fleetVehicleRepository.idsByCodes(query.vehicleCodes);
    filter.vehicleId = { $in: ids.map((id) => new Types.ObjectId(id)) };
  }
  if (query.noticeNumber !== undefined && query.noticeNumber !== '') {
    filter.noticeNumber = {
      $regex: query.noticeNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      $options: 'i',
    };
  }
  if (query.from !== undefined || query.to !== undefined) {
    filter.noticeDate = {
      ...(query.from === undefined ? {} : { $gte: query.from }),
      ...(query.to === undefined ? {} : { $lt: dayAfter(query.to) }),
    };
  }
  if (query.status === 'done') filter.completedAt = { $ne: null };
  if (query.status === 'open') filter.completedAt = null;
  if (query.checkImage === 'has') filter.checkImage = { $ne: null };
  if (query.checkImage === 'missing') filter.checkImage = null;
  return filter;
};

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'notice', entityId: id });

const idOrNull = (value: string | null | undefined): Types.ObjectId | null =>
  value === null || value === undefined ? null : new Types.ObjectId(value);
const stringOrNull = (value: Types.ObjectId | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

/** Only the boxes that say something — an emptied box is dropped rather than stored as ''. */
const filled = (values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).filter(([, text]) => text.trim() !== ''));
const ticked = (checks: Record<string, string[]>): Record<string, string[]> =>
  Object.fromEntries(Object.entries(checks).filter(([, chosen]) => chosen.length > 0));

const snapshot = (doc: FleetNoticeDoc) => ({
  template: doc.template,
  values: doc.values,
  checks: doc.checks,
  vehicleId: stringOrNull(doc.vehicleId),
  driverEmployeeId: stringOrNull(doc.driverEmployeeId),
  accidentId: stringOrNull(doc.accidentId),
  noticeNumber: doc.noticeNumber ?? null,
  noticeDate: doc.noticeDate == null ? null : doc.noticeDate.toISOString(),
  completedAt: doc.completedAt == null ? null : doc.completedAt.toISOString(),
});

const imageDto = (image: FleetNoticeImage | null | undefined): FleetLicenseImageDto | null =>
  image == null
    ? null
    : {
        fileId: String(image.fileId),
        fileName: image.fileName,
        mime: image.mime,
        size: image.size,
        uploadedAt: image.uploadedAt.toISOString(),
      };

/** «رقم الإخطار» as typed; an emptied box is no number at all. */
const numberOrNull = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value.trim() === '' ? null : value.trim();

export const toNoticeDto = (doc: FleetNoticeDoc | FleetNoticeWithCode): FleetNoticeDto => ({
  id: String(doc._id),
  template: doc.template,
  values: doc.values ?? {},
  checks: doc.checks ?? {},
  vehicleId: stringOrNull(doc.vehicleId),
  vehicleCode: 'vehicleCode' in doc ? doc.vehicleCode : null,
  driverEmployeeId: stringOrNull(doc.driverEmployeeId),
  accidentId: stringOrNull(doc.accidentId),
  noticeNumber: doc.noticeNumber ?? null,
  noticeDate: doc.noticeDate == null ? null : doc.noticeDate.toISOString(),
  noticeImage: imageDto(doc.noticeImage),
  vehicleLicense: 'vehicleLicense' in doc ? doc.vehicleLicense : null,
  driverLicense: 'driverLicense' in doc ? doc.driverLicense : null,
  checkImage: imageDto(doc.checkImage),
  completedAt: doc.completedAt == null ? null : doc.completedAt.toISOString(),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const toNoticeSettingsDto = (
  template: FleetNoticeTemplate,
  doc: FleetNoticeSettingsDoc | null,
): FleetNoticeSettingsDto => ({
  template,
  defaults: doc?.defaults ?? {},
  links: doc?.links ?? [],
  numberField: doc?.numberField ?? null,
  dateField: doc?.dateField ?? null,
  version: doc === null ? null : doc.__v,
  updatedAt: doc === null ? null : doc.updatedAt.toISOString(),
});

/**
 * The car codes for a page of notices, and where each licence image comes from — one registry read
 * and one driver read, not one per row.
 */
/**
 * Whether the caller may read a registry licence — the vehicles' or the drivers' own grant, which
 * the file's authorizer asks again. Without it the notice's own copy stands, or the upload is
 * offered: no caller is shown a licence it would then be refused. No caller — an internal read —
 * reads them all.
 */
const mayReadRegistry = (
  ctx: AuthContext | undefined,
  kind: 'vehicleLicense' | 'driverLicense',
): boolean =>
  ctx === undefined ||
  hasPermission(ctx, kind === 'vehicleLicense' ? 'fleetVehicle.view' : 'fleetDriver.view');

const withCodes = async (
  docs: FleetNoticeDoc[],
  ctx?: AuthContext,
): Promise<FleetNoticeWithCode[]> => {
  const ids = [
    ...new Set(docs.flatMap((doc) => (doc.vehicleId === null ? [] : [String(doc.vehicleId)]))),
  ];
  const employees = [
    ...new Set(
      docs.flatMap((doc) => (doc.driverEmployeeId == null ? [] : [String(doc.driverEmployeeId)])),
    ),
  ];
  const [vehicles, drivers] = await Promise.all([
    ids.length === 0 ? [] : fleetVehicleRepository.findByIdsSystem(ids),
    fleetDriverProfileRepository.findForEmployeesSystem(employees),
  ]);
  const byVehicle = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle]));
  const licensed = new Set(
    drivers.flatMap((driver) => (driver.licenseImage == null ? [] : [String(driver.employeeId)])),
  );
  return docs.map((doc) => {
    const vehicle = doc.vehicleId === null ? undefined : byVehicle.get(String(doc.vehicleId));
    const vehicleLicense: FleetNoticeLicenceSource =
      vehicle?.licenseImage != null && !vehicle.isDeleted && mayReadRegistry(ctx, 'vehicleLicense')
        ? 'registry'
        : doc.vehicleLicenseImage != null
          ? 'notice'
          : null;
    const driverLicense: FleetNoticeLicenceSource =
      doc.driverEmployeeId != null &&
      licensed.has(String(doc.driverEmployeeId)) &&
      mayReadRegistry(ctx, 'driverLicense')
        ? 'registry'
        : doc.driverLicenseImage != null
          ? 'notice'
          : null;
    return Object.assign(doc, {
      vehicleCode: vehicle?.code ?? null,
      vehicleLicense,
      driverLicense,
    });
  });
};

class FleetNoticeService {
  async list(
    query: ListFleetNoticesQuery,
    ctx?: AuthContext,
  ): Promise<Paginated<FleetNoticeWithCode>> {
    const page = await fleetNoticeRepository.list({
      filter: await noticeFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'createdAt',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['updatedAt', 'createdAt', 'noticeDate', 'noticeNumber'],
    });
    return { ...page, items: await withCodes(page.items, ctx) };
  }

  /** «الإحصائيات» — over the notices the filters leave. */
  async summary(
    query: FleetNoticesSummaryQuery,
    ctx?: AuthContext,
  ): Promise<FleetNoticesSummaryDto> {
    const docs = await withCodes(
      await fleetNoticeRepository.findLive(await noticeFilter(query)),
      ctx,
    );
    const byTemplate = new Map<FleetNoticeTemplate, number>();
    const byMonth = new Map<string, number>();
    for (const doc of docs) {
      byTemplate.set(doc.template, (byTemplate.get(doc.template) ?? 0) + 1);
      if (doc.noticeDate != null) {
        const month = doc.noticeDate.toISOString().slice(0, 7);
        byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
      }
    }
    const done = docs.filter((doc) => doc.completedAt != null).length;
    return {
      total: docs.length,
      done,
      open: docs.length - done,
      missingLicences: docs.filter(
        (doc) => doc.vehicleLicense === null || doc.driverLicense === null,
      ).length,
      missingCheckImage: docs.filter((doc) => doc.checkImage == null).length,
      byTemplate: [...byTemplate.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([template, count]) => ({ template, count })),
      months: [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, count]) => ({ month, count })),
    };
  }

  async get(id: string, ctx?: AuthContext): Promise<FleetNoticeWithCode> {
    const [doc] = await withCodes([await fleetNoticeRepository.getById(id)], ctx);
    return doc as FleetNoticeWithCode;
  }

  async create(input: CreateFleetNotice, by: string): Promise<FleetNoticeDoc> {
    const doc = await fleetNoticeRepository.create(
      {
        template: input.template,
        values: filled(input.values),
        checks: ticked(input.checks),
        vehicleId: idOrNull(input.vehicleId),
        driverEmployeeId: idOrNull(input.driverEmployeeId),
        accidentId: idOrNull(input.accidentId),
        noticeNumber: numberOrNull(input.noticeNumber),
        noticeDate: input.noticeDate ?? null,
        noticeImage: null,
        checkImage: null,
        vehicleLicenseImage: null,
        driverLicenseImage: null,
        completedAt: null,
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

  async update(id: string, input: UpdateFleetNotice, by: string): Promise<FleetNoticeDoc> {
    const before = await fleetNoticeRepository.getById(id);
    const set: Partial<FleetNoticeDoc> = {};
    if (input.values !== undefined) set.values = filled(input.values);
    if (input.checks !== undefined) set.checks = ticked(input.checks);
    if (input.vehicleId !== undefined) set.vehicleId = idOrNull(input.vehicleId);
    if (input.driverEmployeeId !== undefined) {
      set.driverEmployeeId = idOrNull(input.driverEmployeeId);
    }
    if (input.accidentId !== undefined) set.accidentId = idOrNull(input.accidentId);
    if (input.noticeNumber !== undefined) set.noticeNumber = numberOrNull(input.noticeNumber);
    if (input.noticeDate !== undefined) set.noticeDate = input.noticeDate ?? null;
    const updated = await fleetNoticeRepository.updateById(id, set, {
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

  async remove(id: string, by: string): Promise<void> {
    const before = await fleetNoticeRepository.getById(id);
    await fleetNoticeRepository.softDeleteById(id, { by });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges(snapshot(before), {}),
    });
  }

  // ── «✓» ─────────────────────────────────────────────────────────────────────────────────────
  //
  // «مقدرش اعمل صح لو مفيش صوره شيك»: a notice closes only once the insurer's cheque is in. Opening
  // it again needs nothing.
  async setDone(
    id: string,
    input: SetFleetNoticeDone,
    by: string,
    ctx?: AuthContext,
  ): Promise<FleetNoticeWithCode> {
    const before = await fleetNoticeRepository.getById(id);
    if (input.done && before.checkImage == null) {
      throw new ValidationError([
        {
          field: 'body.done',
          code: 'CHECK_IMAGE_REQUIRED',
          message: 'a notice is closed only once the cheque scan is uploaded',
        },
      ]);
    }
    const completedAt = input.done ? (before.completedAt ?? new Date()) : null;
    const updated = await fleetNoticeRepository.updateById(
      id,
      { completedAt },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return this.get(id, ctx);
  }

  // ── The two scans (Files owns the bytes, the notice owns the link) — as the dealership's ─────

  async setImage(
    ctx: AuthContext,
    id: string,
    kind: FleetNoticeImageKind,
    binary: UploadedBinary,
  ): Promise<FleetNoticeWithCode> {
    const field = IMAGE_FIELD[kind];
    const before = await fleetNoticeRepository.getById(id);
    const current = before[field] ?? null;
    const isFirst = current === null;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'fleet',
          entityType: 'fleetNotice',
          entityId: id,
          categoryId: await resolveNoticeDocsCategoryId(),
          displayName: IMAGE_NAME[kind],
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }
    try {
      await fleetNoticeRepository.updateById(
        id,
        {
          [field]: {
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
        { field, old: current === null ? null : String(current.fileId), new: String(file._id) },
      ],
    });
    return this.get(id, ctx);
  }

  async readImage(
    ctx: AuthContext,
    id: string,
    kind: FleetNoticeImageKind,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const row = await fleetNoticeRepository.getById(id);
    // A licence is the registry's own when it has one the caller may read; the notice's copy
    // stands in without it — and when the registry's cannot be read after all.
    const own = row[IMAGE_FIELD[kind]];
    const registry =
      (kind === 'vehicleLicense' || kind === 'driverLicense') && mayReadRegistry(ctx, kind)
        ? await this.registryLicence(row, kind)
        : null;
    if (registry !== null) {
      try {
        const { doc, buffer } = await fileService.readEntityOwnedBuffer(
          ctx,
          String(registry.fileId),
        );
        return { buffer, mime: doc.mime, fileName: doc.originalName };
      } catch (error) {
        if (own == null) throw error;
      }
    }
    if (own == null) throw new NotFoundError('this notice has no such scan');
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(ctx, String(own.fileId));
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  /** The car's or the driver's licence as the registry holds it, for a licence kind. */
  private async registryLicence(
    row: FleetNoticeDoc,
    kind: FleetNoticeImageKind,
  ): Promise<{ fileId: Types.ObjectId } | null> {
    if (kind === 'vehicleLicense' && row.vehicleId !== null) {
      const [vehicle] = await fleetVehicleRepository.findByIdsSystem([String(row.vehicleId)]);
      return vehicle === undefined || vehicle.isDeleted ? null : (vehicle.licenseImage ?? null);
    }
    if (kind === 'driverLicense' && row.driverEmployeeId != null) {
      const driver = await fleetDriverProfileRepository.findDriverByEmployeeId(
        String(row.driverEmployeeId),
      );
      return driver?.licenseImage ?? null;
    }
    return null;
  }

  async deleteImage(
    ctx: AuthContext,
    id: string,
    kind: FleetNoticeImageKind,
  ): Promise<FleetNoticeWithCode> {
    const field = IMAGE_FIELD[kind];
    const before = await fleetNoticeRepository.getById(id);
    const image = before[field];
    if (image == null) throw new ConflictError('this notice has no such scan to delete');
    // A closed notice keeps its cheque: taking it away would leave a «✓» with nothing behind it.
    if (kind === 'check' && before.completedAt != null) {
      throw new ConflictError('reopen the notice before removing its cheque');
    }
    const fileId = String(image.fileId);
    await fleetNoticeRepository.updateById(
      id,
      { [field]: null },
      { by: ctx.userId, version: before.__v },
    );
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field, old: fileId, new: null }],
    });
    return this.get(id, ctx);
  }

  // ── A form's set-up ─────────────────────────────────────────────────────────────────────────

  async getSettings(template: FleetNoticeTemplate): Promise<FleetNoticeSettingsDto> {
    const doc = await fleetNoticeSettingsRepository.findOne({ template });
    return toNoticeSettingsDto(template, doc);
  }

  async saveSettings(
    template: FleetNoticeTemplate,
    input: SaveFleetNoticeSettings,
    by: string,
  ): Promise<FleetNoticeSettingsDto> {
    // A box set to nothing is no default at all — kept out rather than stored as an empty rule.
    const defaults = Object.fromEntries(
      Object.entries(input.defaults).filter(
        ([, rule]) => rule.mode !== 'fixed' || rule.value.trim() !== '',
      ),
    );
    const links = input.links.map((link) => ({ name: link.name, keys: [...new Set(link.keys)] }));
    const numberField = input.numberField ?? null;
    const dateField = input.dateField ?? null;
    const before = await fleetNoticeSettingsRepository.findOne({ template });
    const saved =
      before === null
        ? await fleetNoticeSettingsRepository.create(
            { template, defaults, links, numberField, dateField },
            { by },
          )
        : await fleetNoticeSettingsRepository.updateById(
            String(before._id),
            { defaults, links, numberField, dateField },
            { by, version: input.version ?? before.__v },
          );
    await auditService.record({
      entityRef: { moduleId: 'fleet', entityType: 'noticeSettings', entityId: String(saved._id) },
      action: before === null ? 'create' : 'update',
      changes: diffChanges(
        before === null
          ? {}
          : {
              defaults: before.defaults,
              links: before.links,
              numberField: before.numberField ?? null,
              dateField: before.dateField ?? null,
            },
        {
          defaults: saved.defaults,
          links: saved.links,
          numberField: saved.numberField ?? null,
          dateField: saved.dateField ?? null,
        },
      ),
    });
    return toNoticeSettingsDto(template, saved);
  }
}

export const fleetNoticeService = new FleetNoticeService();
