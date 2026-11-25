// The folder's pure rules (design §3.1, §4.3), apart from any database so they can be tested alone.
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../shared/errors';

/** Ids compared as the database spells them: lower-case hex. */
const canonical = (id: string): string => id.toLowerCase();

/** Who a new list adds and who it takes off, against the list as it stands. */
export const viewerChanges = (
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } => {
  const was = new Set(before.map(canonical));
  const now = new Set(after.map(canonical));
  return {
    added: [...now].filter((id) => !was.has(id)),
    removed: [...was].filter((id) => !now.has(id)),
  };
};

/**
 * May the caller see this folder? The responsible person sees every folder; anyone else only a
 * folder whose list names them.
 */
export const mayReadFolder = (
  isManager: boolean,
  callerId: string,
  viewerIds: readonly string[],
): boolean => isManager || viewerIds.map(canonical).includes(canonical(callerId));

/** 409 — another live folder already carries this name. */
export const folderNameTaken = (): AppError =>
  new AppError(ErrorCodes.COMPLIANCE_FOLDER_NAME_TAKEN, 409, 'another folder has this name', {
    details: [{ field: 'name', code: 'taken', message: 'another folder has this name' }],
  });

/** 422 — the list names people who may not be added to it, each named in a detail. */
export const viewersRefused = (ids: readonly string[]): AppError =>
  new AppError(
    ErrorCodes.COMPLIANCE_VIEWER_INVALID,
    422,
    'a folder is shared only with active employee accounts',
    {
      details: ids.map((id) => ({ field: 'viewerUserIds', code: 'notEligible', message: id })),
    },
  );
