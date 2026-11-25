// The folder form's pure rules, so a spec reaches them without a browser.
import { type ComplianceFolderDto, type CompliancePersonDto } from '@ecms/contracts';

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

/**
 * After a save refused because the folder was saved elsewhere: the person's own edits — measured
 * against the folder the form opened on — laid over the folder as it now is. A name they did not
 * touch takes the new one; people they added stay added and people they removed stay removed, and
 * every other change to the list is the other save's, kept.
 */
export const carryFolderEdits = (
  opened: Pick<ComplianceFolderDto, 'name' | 'viewers'>,
  typed: { name: string; viewers: readonly CompliancePersonDto[] },
  fresh: Pick<ComplianceFolderDto, 'name' | 'viewers'>,
): { name: string; viewers: CompliancePersonDto[] } => {
  const before = new Set(opened.viewers.map((person) => person.userId));
  const now = new Set(typed.viewers.map((person) => person.userId));
  const removed = new Set([...before].filter((id) => !now.has(id)));
  const added = typed.viewers.filter((person) => !before.has(person.userId));
  const kept = fresh.viewers.filter((person) => !removed.has(person.userId));
  const keptIds = new Set(kept.map((person) => person.userId));
  return {
    name: typed.name.trim() === opened.name ? fresh.name : typed.name,
    viewers: [...kept, ...added.filter((person) => !keptIds.has(person.userId))],
  };
};
