// The kinds of request the engine can run, as each module declares its own.
//
// A registry rather than an enum, for the same reason the permission registry is one: a module that
// wants approvals adds one call in its own folder and never edits a platform file. The alternative
// — a union type here listing `hr.leave | hr.regularization | fleet.…` — makes the platform know
// every module's business, and makes adding a request type a change to a shared file that every
// module's tests then re-run.
//
// `permissionKeys` is what the configuration screen offers as steps. Free text would let an
// administrator write a chain around a key that does not exist, which resolves to «nobody holds
// this» and is then SKIPPED — a chain that silently approves everything, which looks exactly like
// a chain that works.
import { type ApprovalRequestTypeDto } from '@ecms/contracts';

const types = new Map<string, ApprovalRequestTypeDto>();

/** Declared at module load, beside the module's own permissions. Re-registering replaces. */
export const registerApprovalRequestType = (type: ApprovalRequestTypeDto): void => {
  types.set(type.key, type);
};

export const listApprovalRequestTypes = (): ApprovalRequestTypeDto[] =>
  [...types.values()].sort((a, b) => a.key.localeCompare(b.key));

export const getApprovalRequestType = (key: string): ApprovalRequestTypeDto | null =>
  types.get(key) ?? null;

/** Test seam only — the registry is otherwise append-only for the life of the process. */
export const clearApprovalRequestTypes = (): void => types.clear();
