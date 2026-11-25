// The folder's files authorizer (ADR-023; design §6.1). Every file the module keeps — a document or
// a cover picture — is filed under `compliance/folder`, so the platform's own file paths ask THIS
// before returning a byte or a line of metadata:
//
//   * read  — the responsible person, or a person on the folder's list;
//   * write and delete — the responsible person alone.
//
// The module's own endpoints are how a reader reaches a file, and they record every opening. The
// platform's generic download path stays shut to a reader all the same: a document is a PRIVATE
// file, which the generic path serves only to holders of `file.download`, so the access log is not
// stepped around by a person the folder was merely shared with.
//
// A folder that does not exist (or was deleted) denies rather than throws: the caller learns nothing.
import { type FileEntityAuthorizer } from '../../../platform/files';
import { isComplianceManager } from '../shared/authority';
import { mayReadFolder } from './folder-rules';
import { complianceFolderRepository } from './folder.repository';

export const complianceFolderFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'folder',
  understandsDelete: true,
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const manager = isComplianceManager(ctx);
    if (intent !== 'read' && !manager) return false;
    const folder = await complianceFolderRepository.findById(entityId);
    if (folder === null) return false;
    return mayReadFolder(manager, ctx.userId, folder.viewerUserIds.map(String));
  },
};
