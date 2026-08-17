// The shipment lifecycle (discovery §6, design §16) as a pure decision — testable without a
// database. The map is derived from the OBSERVED legacy transitions, not invented:
//
//   daily   : draft → completed (main_ops receive, :564) · completed → draft (un-receive, :555)
//   secured : draft → inVault (receive_mohsana, :1220) → dispatched (deliver_mohsana, :1737)
//             → completed (main_ops receive, :564) · completed → dispatched (un-receive, :559)
//
// The legacy "receive" toggle writes status 1 with NO state guard at all (quirk Q30) — a mohsana
// could be jumped to completed from any state. That is the one approved NORMALIZE here: the
// transitions below are the observed HAPPY paths, enforced; the vault steps (draft→inVault,
// inVault→dispatched) are performed by the vault-custody slice, not the generic shipment surface.
import { type OperationsShipmentStatus, type OperationsShipmentType } from '@ecms/contracts';

type TransitionMap = Readonly<
  Record<OperationsShipmentStatus, readonly OperationsShipmentStatus[]>
>;

const DAILY: TransitionMap = {
  draft: ['completed'],
  inVault: [],
  dispatched: [],
  completed: ['draft'],
};

const SECURED: TransitionMap = {
  draft: ['inVault'],
  inVault: ['dispatched'],
  dispatched: ['completed'],
  completed: ['dispatched'],
};

export const canTransitionShipment = (
  shipmentType: OperationsShipmentType,
  from: OperationsShipmentStatus,
  to: OperationsShipmentStatus,
): boolean => (shipmentType === 'daily' ? DAILY : SECURED)[from].includes(to);

/** The state completion returns to on reopen — the legacy un-receive parity (:555 vs :559). */
export const reopenTarget = (shipmentType: OperationsShipmentType): OperationsShipmentStatus =>
  shipmentType === 'daily' ? 'draft' : 'dispatched';
