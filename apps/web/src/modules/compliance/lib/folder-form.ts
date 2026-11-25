// The folder form's pure rules, so a spec reaches them without a browser.
import { type ComplianceFolderDto } from '@ecms/contracts';

/** The longest name a folder or a file takes (`ComplianceNameSchema`). */
export const COMPLIANCE_NAME_MAX = 150;

/**
 * What an edit sends: the name when it changed, the list when it changed (order aside), or null
 * when nothing did — the picture is its own call.
 */
export const folderChanges = (
  folder: Pick<ComplianceFolderDto, 'name' | 'viewers'>,
  name: string,
  viewerUserIds: readonly string[],
): { name?: string; viewerUserIds?: string[] } | null => {
  const changes: { name?: string; viewerUserIds?: string[] } = {};
  const trimmed = name.trim();
  if (trimmed !== folder.name) changes.name = trimmed;
  const before = folder.viewers.map((person) => person.userId).sort();
  const after = [...viewerUserIds].sort();
  if (before.length !== after.length || before.some((id, i) => id !== after[i])) {
    changes.viewerUserIds = [...viewerUserIds];
  }
  return Object.keys(changes).length === 0 ? null : changes;
};

/** A file's own name without its extension — what a document is called when none is typed. */
export const baseNameOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
};
