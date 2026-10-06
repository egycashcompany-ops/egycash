// Filled insurance notices — create, read, edit, soft-delete, the two scans, «✓», and each form's
// set-up. Audited like every Fleet record.
import { Types } from 'mongoose';
import {
  type CreateFleetNotice,
  type FleetLicenseImageDto,
  type FleetNoticeDto,
  type FleetNoticeImageKind,
  type FleetNoticeSettingsDto,
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
import { type AuthContext } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetNoticeRepository } from './notice.repository';
import { fleetNoticeSettingsRepository } from './notice-settings.repository';
import { resolveNoticeDocsCategoryId } from './notice-files';
import { type FleetNoticeDoc, type FleetNoticeImage } from './notice.model';
import { type FleetNoticeSettingsDoc } from './notice-settings.model';

/** A notice with the car's code read from the registry — what the table lists it by. */
export type FleetNoticeWithCode = FleetNoticeDoc & { vehicleCode: string | null };

/** Which stored field each scan is. */
const IMAGE_FIELD = { notice: 'noticeImage', check: 'checkImage' } as const;

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
  version: doc === null ? null : doc.__v,
  updatedAt: doc === null ? null : doc.updatedAt.toISOString(),
});

/** The car codes for a page of notices — one registry read, not one per row. */
const withCodes = async (docs: FleetNoticeDoc[]): Promise<FleetNoticeWithCode[]> => {
  const ids = [
    ...new Set(docs.flatMap((doc) => (doc.vehicleId === null ? [] : [String(doc.vehicleId)]))),
  ];
  const vehicles = ids.length === 0 ? [] : await fleetVehicleRepository.findByIdsSystem(ids);
  const codes = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle.code]));
  return docs.map((doc) =>
    Object.assign(doc, {
      vehicleCode: doc.vehicleId === null ? null : (codes.get(String(doc.vehicleId)) ?? null),
    }),
  );
};

class FleetNoticeService {
  async list(query: ListFleetNoticesQuery): Promise<Paginated<FleetNoticeWithCode>> {
    const page = await fleetNoticeRepository.list({
      filter: query.template === undefined ? {} : { template: query.template },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'createdAt',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['updatedAt', 'createdAt', 'noticeDate', 'noticeNumber'],
    });
    return { ...page, items: await withCodes(page.items) };
  }

  async get(id: string): Promise<FleetNoticeWithCode> {
    const [doc] = await withCodes([await fleetNoticeRepository.getById(id)]);
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
  async setDone(id: string, input: SetFleetNoticeDone, by: string): Promise<FleetNoticeWithCode> {
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
    return this.get(id);
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
          displayName: kind === 'check' ? 'notice — cheque' : 'notice — signed form',
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
    return this.get(id);
  }

  async readImage(
    ctx: AuthContext,
    id: string,
    kind: FleetNoticeImageKind,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const row = await fleetNoticeRepository.getById(id);
    const image = row[IMAGE_FIELD[kind]];
    if (image == null) throw new NotFoundError('this notice has no such scan');
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(ctx, String(image.fileId));
    return { buffer, mime: doc.mime, fileName: doc.originalName };
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
    return this.get(id);
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
    const before = await fleetNoticeSettingsRepository.findOne({ template });
    const saved =
      before === null
        ? await fleetNoticeSettingsRepository.create({ template, defaults, links }, { by })
        : await fleetNoticeSettingsRepository.updateById(
            String(before._id),
            { defaults, links },
            { by, version: input.version ?? before.__v },
          );
    await auditService.record({
      entityRef: { moduleId: 'fleet', entityType: 'noticeSettings', entityId: String(saved._id) },
      action: before === null ? 'create' : 'update',
      changes: diffChanges(
        before === null ? {} : { defaults: before.defaults, links: before.links },
        { defaults: saved.defaults, links: saved.links },
      ),
    });
    return toNoticeSettingsDto(template, saved);
  }
}

export const fleetNoticeService = new FleetNoticeService();
