// Where leave sends a request on a configured chain, from the engine's answer (leave design §16.2,
// PXQ-1). Pure, so a unit spec covers each answer the engine can give, and the service only asks.
//
// The engine answers `unstaffed` or `noChain` and never "approved" for a chain nobody can decide
// (ADR-041 decisions 2 and 3); what a host does with that answer is the host's policy. Leave's is
// the owner's answer to PXQ-1: a request nobody on its chain can approve goes to HR, down the
// manager and HR path at submission and to HR's step after a decision.
import type { ChainStatus } from '../../../../platform/approvals';

/**
 * Where a new request starts: on the chain only when a rung of it is staffed (16.2 item 1).
 *
 * `unstaffed` routes as `noChain` does, because a chain nobody holds would leave the request
 * waiting with nobody told who could decide it. `approved` and `rejected` cannot come back before
 * any decision; they take the manager and HR path too, so the function is total.
 */
export const initialStatusFor = (
  chain: ChainStatus,
  hasManager: boolean,
): 'pendingApproval' | 'pendingManager' | 'pendingHr' =>
  chain === 'pending' ? 'pendingApproval' : hasManager ? 'pendingManager' : 'pendingHr';

/**
 * Where a request on the chain goes after the engine decides (16.2 item 2).
 *
 * Nobody left on the rungs that remain hands it to HR's step, never to the manager: the owner's
 * answer says "to HR for the remaining steps". `noChain` cannot follow a decision, because the
 * engine refuses to decide one, and maps with `unstaffed` so the function is total.
 */
export const statusAfterChainDecision = (
  status: ChainStatus,
): 'approved' | 'rejected' | 'pendingApproval' | 'pendingHr' =>
  status === 'approved' || status === 'rejected'
    ? status
    : status === 'pending'
      ? 'pendingApproval'
      : 'pendingHr';
