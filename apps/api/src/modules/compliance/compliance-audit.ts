// What the module's writes leave in the audit trail (design §9): one row per act, under the folder
// or the file it touched. LITERAL entity pairs, so the realtime registry's scan can classify them.
// A person opening or downloading a file is NOT audited here — that is the access log's (§7), and
// a trail row per opening would bury the writes in reads.
import { auditService } from '../../platform/audit';
import { diffChanges } from '../../shared/utils/diff';

export const folderEntityRef = (id: string) => ({
  moduleId: 'compliance',
  entityType: 'folder',
  entityId: id,
});

export const documentEntityRef = (id: string) => ({
  moduleId: 'compliance',
  entityType: 'document',
  entityId: id,
});

/** A folder's facts as the trail compares them: its name and who it is shown to. */
export interface FolderSnapshot {
  name: string;
  viewerUserIds: string[];
  cover: string | null;
}

export const auditFolderCreated = async (id: string, after: FolderSnapshot): Promise<void> => {
  await auditService.record({
    entityRef: folderEntityRef(id),
    action: 'create',
    changes: diffChanges({}, { ...after }),
  });
};

export const auditFolderUpdated = async (
  id: string,
  before: FolderSnapshot,
  after: FolderSnapshot,
): Promise<void> => {
  const changes = diffChanges({ ...before }, { ...after });
  if (changes.length === 0) return;
  await auditService.record({ entityRef: folderEntityRef(id), action: 'update', changes });
};

export const auditFolderDeleted = async (id: string, before: FolderSnapshot): Promise<void> => {
  await auditService.record({
    entityRef: folderEntityRef(id),
    action: 'delete',
    changes: diffChanges({ ...before }, {}),
  });
};

export interface DocumentSnapshot {
  folderId: string;
  name: string;
  fileName: string;
  size: number;
}

export const auditDocumentCreated = async (id: string, after: DocumentSnapshot): Promise<void> => {
  await auditService.record({
    entityRef: documentEntityRef(id),
    action: 'create',
    changes: diffChanges({}, { ...after }),
  });
};

export const auditDocumentRenamed = async (
  id: string,
  before: string,
  after: string,
): Promise<void> => {
  if (before === after) return;
  await auditService.record({
    entityRef: documentEntityRef(id),
    action: 'update',
    changes: [{ field: 'name', old: before, new: after }],
  });
};

export const auditDocumentDeleted = async (id: string, before: DocumentSnapshot): Promise<void> => {
  await auditService.record({
    entityRef: documentEntityRef(id),
    action: 'delete',
    changes: diffChanges({ ...before }, {}),
  });
};
