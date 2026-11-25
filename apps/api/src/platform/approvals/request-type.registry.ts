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
// this»: its rung is only ever passed over, and with no staffed rung above it a request that
// reaches it waits `unstaffed` for an override — a chain that looks configured and does not run as
// written.
import { type ApprovalRequestTypeDto } from '@ecms/contracts';

/**
 * Who writes a decision's audit row (ADR-041 decision 7). `'engine'` has `decide` record it before
 * it returns, so before the host's own write: a host that refuses afterwards leaves the row behind,
 * and the row's only link to the host's document is the HTTP request id. `'host'` has `decide`
 * record nothing and hand the changes back, for the host to record on its own document after its
 * commit.
 */
type ApprovalAuditMode = 'engine' | 'host';

const types = new Map<string, ApprovalRequestTypeDto>();
// Beside the DTOs rather than on them: the DTO is what the configuration screen is sent, and who
// writes the audit row is between the engine and the host, not the administrator's to see.
const auditModes = new Map<string, ApprovalAuditMode>();

/**
 * Declared at module load, beside the module's own permissions. Re-registering replaces, the audit
 * option included, so a type registered again without it is back to `'engine'`.
 *
 * The option is declared once per type rather than chosen at each `decide` call, so every decision
 * of one type is audited alike: a call site that forgot it would audit twice, or not at all.
 */
export const registerApprovalRequestType = (
  type: ApprovalRequestTypeDto,
  options?: { audit?: ApprovalAuditMode },
): void => {
  types.set(type.key, type);
  auditModes.set(type.key, options?.audit ?? 'engine');
};

export const listApprovalRequestTypes = (): ApprovalRequestTypeDto[] =>
  [...types.values()].sort((a, b) => a.key.localeCompare(b.key));

export const getApprovalRequestType = (key: string): ApprovalRequestTypeDto | null =>
  types.get(key) ?? null;

/**
 * Who audits a decision of this type, for the service. Internal to this folder: the barrel does not
 * export it, because no host has a reason to ask. A key nobody registered reads `'engine'`, so a
 * decision on it is audited as every decision was before the option existed.
 */
export const auditModeOf = (key: string): ApprovalAuditMode => auditModes.get(key) ?? 'engine';

/** Test seam only — the registry is otherwise append-only for the life of the process. */
export const clearApprovalRequestTypes = (): void => {
  types.clear();
  auditModes.clear();
};
