// A memo («مذكرة صرف مستهلكات») after its issue: read back, printed again, and its signed copy
// filed once the employee has signed — the line acknowledgment's service for the paper an issue
// writes. The issue itself, which records the memo with the movements it lists, is
// `consumable-issue.service`; this is everything about the PAPER.
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { itConsumableMemoRepository } from './consumable-memo.repository';
import { resolveConsumableMemoCategoryId } from './consumable-memo-files';
import { consumableMemoEntityRef } from './consumable-history';
import { type ItConsumableMemoDoc } from './consumable-memo.model';

class ItConsumableMemoService {
  /** A memo — scoped like every custody read, on the store its items came from. */
  async get(id: string, scope: ScopeSelector): Promise<ItConsumableMemoDoc> {
    const memo = await itConsumableMemoRepository.findById(id, scope);
    if (memo === null) throw new NotFoundError('memo not found');
    return memo;
  }

  /**
   * Print it again. Nothing is written: the memo was numbered by the issue that recorded it, and a
   * copy of the paper the employee signed is the same paper, under the same number.
   */
  async print(id: string, scope: ScopeSelector): Promise<ItConsumableMemoDoc> {
    return this.get(id, scope);
  }

  // ── The signed copy (Files owns the bytes, the memo owns the link) ────────

  /** The signed paper, scanned — a first upload files it, a later one adds a version. */
  async setSignedCopy(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<ItConsumableMemoDoc> {
    const before = await this.get(id, scope);
    const current = before.signedCopy;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'it',
          entityType: 'consumableMemo',
          entityId: id,
          categoryId: await resolveConsumableMemoCategoryId(),
          displayName: `consumable memo ${String(before.memoNumber)}`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }
    let updated: ItConsumableMemoDoc;
    try {
      updated = await itConsumableMemoRepository.updateById(
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
      // A first upload the memo never came to point at is an orphan — withdrawn. A replace added a
      // version to the group the memo already points at, which is history.
      if (current === null) {
        await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      }
      throw error;
    }
    await auditService.record({
      entityRef: consumableMemoEntityRef(id),
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
    const memo = await this.get(id, scope);
    if (memo.signedCopy === null) throw new NotFoundError('this memo has no signed copy yet');
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(
      ctx,
      String(memo.signedCopy.fileId),
    );
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  async deleteSignedCopy(
    ctx: AuthContext,
    id: string,
    scope: ScopeSelector,
  ): Promise<ItConsumableMemoDoc> {
    const before = await this.get(id, scope);
    if (before.signedCopy === null) {
      throw new ConflictError('this memo has no signed copy to delete');
    }
    const fileId = String(before.signedCopy.fileId);
    const updated = await itConsumableMemoRepository.updateById(
      id,
      { signedCopy: null },
      { by: ctx.userId, version: before.__v, scope },
    );
    // After the memo's write, so a failed detach never leaves it pointing at a deleted file.
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: consumableMemoEntityRef(id),
      action: 'update',
      changes: [{ field: 'signedCopy', old: fileId, new: null }],
    });
    return updated;
  }
}

export const itConsumableMemoService = new ItConsumableMemoService();
