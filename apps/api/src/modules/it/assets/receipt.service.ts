// Custody receipts — إيصال استلام (FR-18): the paper printed BEFORE a hand-over, read back to print
// it again after, and the signed copy filed against it once the employee has signed.
//
// The hand-over itself is a custody transition and lives in `custody.service` with the other
// three; this is everything about the PAPER.
import { Types } from 'mongoose';
import { type ItCustodyReceiptDocumentDto, type PreviewItCustodyReceipt } from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { itAssetRepository } from './asset.repository';
import { itAssetAssignmentRepository } from './assignment.repository';
import { itCustodyReceiptRepository } from './receipt.repository';
import { resolveCustodyReceiptCategoryId } from './receipt-files';
import { readReceiptHolder } from './receipt-holder';
import { auditReceiptIssued, refuseLeaver, refuseUnlessInStock } from './custody.service';
import { type ItCustodyReceiptDoc } from './receipt.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'custodyReceipt', entityId: id });

class ItCustodyReceiptService {
  /**
   * The paper, before anything is recorded — «طباعة إيصال الأول».
   *
   * Refuses exactly what the hand-over would refuse (a leaver, an asset out of stock, one the
   * caller cannot see), so nobody signs a receipt for a hand-over the system then turns down.
   * Writes nothing: the receipt only exists once the hand-over does.
   */
  async preview(
    input: PreviewItCustodyReceipt,
    scope: ScopeSelector,
  ): Promise<ItCustodyReceiptDocumentDto> {
    const holder = await readReceiptHolder(input.employeeId);
    refuseLeaver(holder.employee);

    const ids = input.lines.map((line) => line.assetId);
    const found = new Map(
      (await itAssetRepository.findManyByIds(ids, scope)).map((asset) => [
        String(asset._id),
        asset,
      ]),
    );
    const lines = [];
    for (const line of input.lines) {
      const asset = found.get(line.assetId);
      if (asset === undefined) throw new NotFoundError('asset not found');
      if (asset.status === 'disposed') {
        throw new BusinessRuleError(
          `asset ${asset.assetCode} is disposed; a disposed asset accepts no further custody operation (FR-4)`,
        );
      }
      if (input.kind === 'handOver') {
        await refuseUnlessInStock(asset);
      } else {
        // A transfer's paper: the asset is out, with somebody other than the person signing.
        const open = await itAssetAssignmentRepository.findOpenForAsset(line.assetId);
        if (open === null) {
          throw new ConflictError(
            `asset ${asset.assetCode} is not currently assigned; assign it rather than transferring it`,
          );
        }
        if (String(open.assignedToEmployeeId) === input.employeeId) {
          throw new BusinessRuleError(`asset ${asset.assetCode} is already held by this employee`);
        }
      }
      lines.push({
        assetId: line.assetId,
        assignmentId: null,
        assetCode: asset.assetCode,
        name: asset.name,
        serialNumber: asset.serialNumber,
        conditionOnIssue: line.conditionOnIssue ?? null,
        notes: line.notes ?? null,
      });
    }

    return {
      issuedAt: (input.assignedAt ?? new Date()).toISOString(),
      employeeId: input.employeeId,
      employeeName: holder.employeeName,
      employeeCode: holder.employeeCode,
      jobTitle: holder.jobTitle,
      lines,
    };
  }

  /** A stored receipt — to print it again. Scoped like every custody read. */
  async get(id: string, scope: ScopeSelector): Promise<ItCustodyReceiptDoc> {
    const receipt = await itCustodyReceiptRepository.findById(id, scope);
    if (receipt === null) throw new NotFoundError('receipt not found');
    return receipt;
  }

  /**
   * A receipt for custody handed over BEFORE receipts existed: one open interval, one line, dated
   * the day it was handed over. Only for an interval still open — a returned asset needs no paper
   * — and only once, which the interval's own version enforces under concurrency.
   */
  async issueForAssignment(
    assignmentId: string,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItCustodyReceiptDoc> {
    const assignment = await itAssetAssignmentRepository.findById(assignmentId, scope);
    if (assignment === null) throw new NotFoundError('assignment not found');
    if (assignment.returnedAt !== null) {
      throw new ConflictError(
        'the asset has been returned; a receipt is issued for custody still held',
      );
    }
    if (assignment.receiptId != null) {
      throw new ConflictError('this hand-over already has a receipt; print it again instead');
    }
    const [asset] = await itAssetRepository.findByIdsSystem([String(assignment.assetId)]);
    if (asset === undefined) throw new NotFoundError('asset not found');
    const holder = await readReceiptHolder(String(assignment.assignedToEmployeeId));
    await itCustodyReceiptRepository.ensureCollection();

    const receiptId = new Types.ObjectId();
    return unitOfWork(async (session) => {
      // The version check is what makes «only once» hold: a second issue racing this one finds
      // the interval already moved on and is refused as stale.
      await itAssetAssignmentRepository.updateById(
        assignmentId,
        { receiptId },
        { by: ctx.userId, version: assignment.__v, session, scope },
      );
      const receipt = await itCustodyReceiptRepository.create(
        {
          _id: receiptId,
          employeeId: assignment.assignedToEmployeeId,
          employeeCode: holder.employeeCode,
          employeeName: holder.employeeName,
          jobTitle: holder.jobTitle,
          issuedAt: assignment.assignedAt,
          issuedByUserId: new Types.ObjectId(ctx.userId),
          branchId: assignment.branchId,
          lines: [
            {
              assetId: asset._id,
              assignmentId: assignment._id,
              assetCode: asset.assetCode,
              name: asset.name,
              serialNumber: asset.serialNumber,
              conditionOnIssue: assignment.conditionOnIssue,
              notes: assignment.notes,
            },
          ],
          signedCopy: null,
        },
        { by: ctx.userId, session },
      );
      await auditReceiptIssued(receiptId, String(assignment.assignedToEmployeeId), [
        asset.assetCode,
      ]);
      return receipt;
    });
  }

  // ── The signed copy (Files owns the bytes, the receipt owns the link) ─────

  /** «رفع صورة الإيصال بعد توقيع الموظف» — a first upload files it, a later one adds a version. */
  async setSignedCopy(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<ItCustodyReceiptDoc> {
    const before = await this.get(id, scope);
    const current = before.signedCopy;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'it',
          entityType: 'custodyReceipt',
          entityId: id,
          categoryId: await resolveCustodyReceiptCategoryId(),
          displayName: `custody receipt ${before.employeeCode ?? String(before.employeeId)}`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }
    let updated: ItCustodyReceiptDoc;
    try {
      updated = await itCustodyReceiptRepository.updateById(
        id,
        {
          signedCopy: {
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
      // A first upload the receipt never came to point at is an orphan — withdrawn. A replace
      // added a version to the group the receipt already points at, which is history.
      if (current === null)
        await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw error;
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'signedCopy',
          old: current === null ? null : String(current.fileId),
          new: String(file._id),
        },
      ],
    });
    return updated;
  }

  async readSignedCopy(
    ctx: AuthContext,
    id: string,
    scope: ScopeSelector,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const receipt = await this.get(id, scope);
    if (receipt.signedCopy === null) throw new NotFoundError('this receipt has no signed copy yet');
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(
      ctx,
      String(receipt.signedCopy.fileId),
    );
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  async deleteSignedCopy(
    ctx: AuthContext,
    id: string,
    scope: ScopeSelector,
  ): Promise<ItCustodyReceiptDoc> {
    const before = await this.get(id, scope);
    if (before.signedCopy === null) {
      throw new ConflictError('this receipt has no signed copy to delete');
    }
    const fileId = String(before.signedCopy.fileId);
    const updated = await itCustodyReceiptRepository.updateById(
      id,
      { signedCopy: null },
      { by: ctx.userId, version: before.__v, scope },
    );
    // After the receipt write, so a failed detach never leaves it pointing at a deleted file.
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'signedCopy', old: fileId, new: null }],
    });
    return updated;
  }
}

export const itCustodyReceiptService = new ItCustodyReceiptService();
