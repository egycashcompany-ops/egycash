// The chain a draft on the approval-chain screen replaces, as its save names it (`basedOn`).
//
// A save names the row it replaces, by its id and version, or null for a place where the screen
// showed no chain, and the server refuses any other basis as stale (ADR-041 decision 9). So the
// draft carries its basis and keeps it in step with where it would write: the request type and the
// place are the key of the one row per place, so changing either moves the draft onto another row,
// or onto none. The server remains the judge; this only says which row the screen was showing.
import { type ApprovalWorkflowDto, type SetApprovalWorkflow } from '@ecms/contracts';

/** What a draft names as the chain it replaces: a listed row, or null for none. */
export type ChainBasis = SetApprovalWorkflow['basedOn'];

/** A listed row, named as a save names the chain it replaces. */
export const basisOf = (row: ApprovalWorkflowDto): NonNullable<ChainBasis> => ({
  id: row.id,
  version: row.version,
});

/**
 * The chain the screen lists at one request type and place, or null when it lists none there.
 *
 * Matched exactly, and never by the rule that picks a request's chain: a department's own row and
 * the company default are two rows, and a draft for the department replaces only the first.
 */
export const basisAt = (
  rows: readonly ApprovalWorkflowDto[],
  requestType: string,
  departmentCatalogId: string | null,
  branchId: string | null,
): ChainBasis => {
  const row = rows.find(
    (candidate) =>
      candidate.requestType === requestType &&
      (candidate.department?.id ?? null) === departmentCatalogId &&
      (candidate.branch?.id ?? null) === branchId,
  );
  return row === undefined ? null : basisOf(row);
};
