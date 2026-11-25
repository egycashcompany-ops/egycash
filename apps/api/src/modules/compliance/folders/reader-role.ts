// The reader's grant follows the folders' lists (design §4.2).
//
// A person sees «الملفات» in their sidebar when, and only when, at least one live folder is shared
// with them. The sidebar is the set of applications whose key the caller holds, so the module keeps
// `complianceFile.view` in step with the lists: given — as the managed reader role, at `own` scope
// — the moment a person is first named, taken back the moment they are on no list.
//
// Only the module's own grant is ever taken back: one of the same role an administrator made at
// another scope is theirs and stays (`rbacService.removeAssignment` matches the scope).
//
// What a reader may open is never decided here: every read asks the folder's list. A grant left
// behind costs a sidebar row and opens nothing; a grant MISSING closes the page to a listed person
// (its routes take the key) — which is why a removal is re-checked (`syncOne`) and the boot
// reconciles every grant.
import { logger } from '../../../infrastructure/logging/logger';
import { rbacService } from '../../../platform/rbac';
import { COMPLIANCE_READER_ROLE } from '../compliance-roles';
import { complianceFolderRepository } from './folder.repository';

const READER_SCOPE = 'own' as const;

let readerRoleId: string | null = null;

/** The reader role's id, ensured once per process. */
const roleId = async (): Promise<string> => {
  if (readerRoleId !== null) return readerRoleId;
  const role = await rbacService.ensureManagedRole(
    COMPLIANCE_READER_ROLE.key,
    COMPLIANCE_READER_ROLE.name,
    [...COMPLIANCE_READER_ROLE.permissionKeys],
  );
  readerRoleId = String(role._id);
  return readerRoleId;
};

/**
 * Bring one person's grant in line with the lists as they are now. A removal is checked again
 * after it lands: two writes naming the same person at the same moment can interleave — one reads
 * «on no list», the other adds them and finds the grant still there, then the first takes it away —
 * and the second look puts the grant back, so the two converge on the lists' last word.
 */
const syncOne = async (userId: string, id: string): Promise<void> => {
  if (await complianceFolderRepository.isViewerAnywhere(userId)) {
    await rbacService.ensureAssignment(userId, id, READER_SCOPE);
    return;
  }
  const removed = await rbacService.removeAssignment(userId, id, READER_SCOPE);
  if (removed && (await complianceFolderRepository.isViewerAnywhere(userId))) {
    await rbacService.ensureAssignment(userId, id, READER_SCOPE);
  }
};

/**
 * After a write that changed who is on a list: each person named is brought in line. Never throws —
 * the write it follows has happened; a person whose grant could not be changed is a line in the log
 * and is put right at the next boot (`reconcileReaderGrants`).
 */
export const syncReaderGrants = async (userIds: Iterable<string>): Promise<void> => {
  const people = [...new Set(userIds)];
  if (people.length === 0) return;
  let id: string;
  try {
    id = await roleId();
  } catch (err) {
    logger.warn({ module: 'compliance', err }, 'the reader role could not be ensured');
    return;
  }
  for (const userId of people) {
    try {
      await syncOne(userId, id);
    } catch (err) {
      logger.warn({ module: 'compliance', err, userId }, 'a reader grant was not brought in line');
    }
  }
};

/**
 * At boot: everyone on a list holds the grant, and everyone holding the module's grant is on a
 * list. What a failed `syncReaderGrants` left behind is put right here.
 */
export const reconcileReaderGrants = async (): Promise<void> => {
  const id = await roleId();
  const [viewers, holders] = await Promise.all([
    complianceFolderRepository.allViewerIds(),
    rbacService.userIdsWithRoleAtScope(id, READER_SCOPE),
  ]);
  await syncReaderGrants([...viewers, ...holders]);
};

/** Test-only: forget the cached role id, as a fresh process would. */
export const resetReaderRoleCache = (): void => {
  readerRoleId = null;
};
