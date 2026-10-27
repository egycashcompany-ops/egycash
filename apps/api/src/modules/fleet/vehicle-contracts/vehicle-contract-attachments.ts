// «مرفقات العقد» — a contract's scanned pages. Files owns the bytes; the contract owns the links,
// in their display order. Every link write is audited under the contract.
//
// NEVER VERSIONED. No attachment write bumps the contract's version, so an upload never makes an
// open editor or delivery dialog stale. A reorder is guarded instead by the live set it was built
// from: an upload or a removal landing in between makes it a 409, never a silent drop.
import { Types } from 'mongoose';
import {
  type FleetVehicleContractDto,
  type FleetVehicleContractFileDto,
  type OrderFleetVehicleContractFiles,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { fileService, type UploadedBinary } from '../../../platform/files';
import { NotFoundError, StaleDocumentError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { toVehicleContractFileDto } from './vehicle-contract.dto';
import { resolveVehicleContractDocsCategoryId } from './vehicle-contract-files';
import { fleetVehicleContractRepository } from './vehicle-contract.repository';
import { fleetVehicleContractService, refused } from './vehicle-contract.service';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'vehicleContract',
  entityId: id,
});

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id.toLowerCase());

class FleetVehicleContractAttachments {
  async addFile(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
  ): Promise<FleetVehicleContractFileDto> {
    await fleetVehicleContractRepository.getById(id);
    const dot = binary.originalName.lastIndexOf('.');
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'fleet',
        entityType: 'vehicleContract',
        entityId: id,
        categoryId: await resolveVehicleContractDocsCategoryId(),
        // The download adds the stored extension itself: «صفحة 1» + «.png», not «.png.png».
        displayName: dot > 0 ? binary.originalName.slice(0, dot) : binary.originalName,
        visibility: 'private',
        tags: [],
      },
      binary,
    );
    const link = {
      fileId: file._id,
      fileName: binary.originalName,
      mime: file.mime,
      size: file.size,
      addedAt: new Date(),
      addedBy: oid(ctx.userId),
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    };
    if (!(await fleetVehicleContractRepository.pushFile(id, link))) {
      // The contract went while the bytes were stored: an orphan nobody can reach — put it away.
      await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw new NotFoundError();
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        { field: 'files', old: null, new: { fileId: String(file._id), name: link.fileName } },
      ],
    });
    return toVehicleContractFileDto(link);
  }

  async readFile(
    ctx: AuthContext,
    id: string,
    fileId: string,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const doc = await fleetVehicleContractRepository.getById(id);
    const link = doc.files.find(
      (entry) => String(entry.fileId) === fileId.toLowerCase() && entry.isDeleted !== true,
    );
    if (link === undefined) throw new NotFoundError('this contract has no such attachment');
    const { doc: file, buffer } = await fileService.readEntityOwnedBuffer(ctx, String(link.fileId));
    return { buffer, mime: file.mime, fileName: link.fileName };
  }

  /** Soft: the link is hidden and the platform file soft-deleted — the bytes are kept. */
  async removeFile(ctx: AuthContext, id: string, fileId: string): Promise<void> {
    if (!(await fleetVehicleContractRepository.softDeleteFile(id, fileId, ctx.userId))) {
      await fleetVehicleContractRepository.getById(id);
      throw new NotFoundError('this contract has no such attachment');
    }
    await fileService.softDelete(ctx, fileId.toLowerCase()).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'files', old: { fileId: fileId.toLowerCase() }, new: null }],
    });
  }

  /** The attachments' new order — every live attachment, each once. */
  async orderFiles(
    id: string,
    input: OrderFleetVehicleContractFiles,
  ): Promise<FleetVehicleContractDto> {
    const doc = await fleetVehicleContractRepository.getById(id);
    const live = doc.files.filter((link) => link.isDeleted !== true);
    const hidden = doc.files.filter((link) => link.isDeleted === true);
    const byId = new Map(live.map((link) => [String(link.fileId), link]));
    const asked = input.fileIds.map((fileId) => byId.get(fileId.toLowerCase()));
    if (asked.length !== live.length || asked.some((link) => link === undefined)) {
      throw refused('the order must name every attachment of this contract, each once', [
        { field: 'fileIds', code: 'NOT_THE_LIVE_SET', message: 'name every live attachment once' },
      ]);
    }
    const ordered = asked.filter((link): link is NonNullable<typeof link> => link !== undefined);
    if (!(await fleetVehicleContractRepository.reorderFiles(id, ordered, hidden)))
      throw new StaleDocumentError();
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'files.order',
          old: live.map((link) => String(link.fileId)),
          new: ordered.map((link) => String(link.fileId)),
        },
      ],
    });
    return fleetVehicleContractService.get(id, new Date());
  }
}

export const fleetVehicleContractAttachments = new FleetVehicleContractAttachments();
