// A line's «إقرار استلام»: the paper printed BEFORE the hand-over, read back to print it again
// after, and the signed copy filed against it once the employee has signed — the device receipt's
// service (`assets/receipt.service.ts`) for a paper that names one line instead of devices.
//
// The hand-over itself is a custody transition and lives in `line-custody.service`; this is
// everything about the PAPER.
import {
  type ItMobileLineReceiptDocumentDto,
  type PreviewItMobileLineReceipt,
} from '@ecms/contracts';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { refuseLeaver } from '../assets/custody.service';
import { readReceiptHolder } from '../assets/receipt-holder';
import { nextReceiptNumber } from '../assets/receipt-number';
import { itMobileLineRepository } from './mobile-line.repository';
import { itMobileLineReceiptRepository } from './line-receipt.repository';
import { resolveMobileLineReceiptCategoryId } from './line-receipt-files';
import { refuseUnlessInStock } from './line-custody.service';
import { type ItMobileLineReceiptDoc } from './line-receipt.model';

const entityRef = (id: string) => ({
  moduleId: 'it',
  entityType: 'mobileLineReceipt',
  entityId: id,
});

class ItMobileLineReceiptService {
  /**
   * The paper, before anything is recorded — printed first, as a device's is («طباعة إيصال الأول»).
   *
   * Refuses exactly what the hand-over to an employee would refuse (a leaver, a line not in stock,
   * one the caller cannot see), so nobody signs for a hand-over the system then turns down. The one
   * thing it writes is the counter — every print takes the next F-14 number («كل طباعة زود رقم»),
   * LAST, once nothing above has refused: a paper never printed takes no number.
   */
  async preview(
    input: PreviewItMobileLineReceipt,
    scope: ScopeSelector,
  ): Promise<ItMobileLineReceiptDocumentDto> {
    const holder = await readReceiptHolder(input.employeeId);
    refuseLeaver(holder.employee);
    const line = await itMobileLineRepository.findById(input.lineId, scope);
    if (line === null) throw new NotFoundError('mobile line not found');
    refuseUnlessInStock(line);

    return {
      formNumber: await nextReceiptNumber(),
      issuedAt: (input.assignedAt ?? new Date()).toISOString(),
      employeeId: input.employeeId,
      employeeName: holder.employeeName,
      employeeCode: holder.employeeCode,
      jobTitle: holder.jobTitle,
      // Raw here; the controller withholds it from a caller without `itAsset.viewNationalId`.
      nationalId: holder.nationalId,
      nationalIdVisible: true,
      section: holder.section,
      department: holder.department,
      line: {
        lineId: String(line._id),
        assignmentId: null,
        network: line.network,
        phoneNumber: line.phoneNumber,
        simKind: line.simKind,
        simSerial: line.simSerial ?? null,
        ratePlan: line.ratePlan ?? null,
        accountNumber: line.accountNumber ?? null,
      },
    };
  }

  /** A stored acknowledgment. Scoped like every custody read. */
  async get(id: string, scope: ScopeSelector): Promise<ItMobileLineReceiptDoc> {
    const receipt = await itMobileLineReceiptRepository.findById(id, scope);
    if (receipt === null) throw new NotFoundError('receipt not found');
    return receipt;
  }

  /**
   * Print it again: it keeps the number it was handed over on — a copy of the paper the employee
   * signed is the same paper. A paper without one is given the next number on its first print,
   * once, as a device receipt from before numbering is.
   */
  async print(id: string, ctx: AuthContext, scope: ScopeSelector): Promise<ItMobileLineReceiptDoc> {
    const receipt = await this.get(id, scope);
    if (receipt.formNumber != null) return receipt;
    await itMobileLineReceiptRepository.ensureCollection();
    return itMobileLineReceiptRepository.updateById(
      id,
      { formNumber: await nextReceiptNumber() },
      { by: ctx.userId, version: receipt.__v, scope },
    );
  }

  // ── The signed copy (Files owns the bytes, the paper owns the link) ───────

  /** The signed paper, scanned — a first upload files it, a later one adds a version. */
  async setSignedCopy(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<ItMobileLineReceiptDoc> {
    const before = await this.get(id, scope);
    const current = before.signedCopy;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'it',
          entityType: 'mobileLineReceipt',
          entityId: id,
          categoryId: await resolveMobileLineReceiptCategoryId(),
          displayName: `mobile line receipt ${before.employeeCode ?? String(before.employeeId)}`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }
    let updated: ItMobileLineReceiptDoc;
    try {
      updated = await itMobileLineReceiptRepository.updateById(
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
      // A first upload the paper never came to point at is an orphan — withdrawn. A replace added
      // a version to the group the paper already points at, which is history.
      if (current === null) {
        await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      }
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
    if (receipt.signedCopy === null) {
      throw new NotFoundError('this acknowledgment has no signed copy yet');
    }
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
  ): Promise<ItMobileLineReceiptDoc> {
    const before = await this.get(id, scope);
    if (before.signedCopy === null) {
      throw new ConflictError('this acknowledgment has no signed copy to delete');
    }
    const fileId = String(before.signedCopy.fileId);
    const updated = await itMobileLineReceiptRepository.updateById(
      id,
      { signedCopy: null },
      { by: ctx.userId, version: before.__v, scope },
    );
    // After the paper's write, so a failed detach never leaves it pointing at a deleted file.
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'signedCopy', old: fileId, new: null }],
    });
    return updated;
  }
}

export const itMobileLineReceiptService = new ItMobileLineReceiptService();
