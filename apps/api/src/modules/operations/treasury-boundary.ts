// The Operations ↔ Treasury boundary.
//
// WHY THIS FILE EXISTS. The legacy system splits secured-cash work across two owners: Operations
// plans and delivers (`/mohsana`, `/tash4ela_mohasana`), while the treasury receives into and
// releases from the vault (`/receive_mohsana`, `/deliver_mohsana`, `/vault1`). ECMS has NO
// treasury module today — verified, not assumed: no module, collection, permission or contract
// under `apps/api/src/modules` or `packages/contracts` owns a vault.
//
// So rather than dissolve that split into Operations, the custody hand-off is expressed as a PORT.
// Operations calls this interface and never the implementation; the interim implementation
// (`vault/vault-custody.service.ts`) is Operations-owned ONLY because nobody else exists to own
// it yet. This mirrors the platform's existing seam pattern (`registerEmployeeLookup`,
// `registerLeaveLookup` in platform/directory): a named interface, a registrable provider, a
// default that works today.
//
// WHEN A TREASURY MODULE ARRIVES it calls `registerVaultCustodyProvider(...)` at module load and
// owns `operations_vault_custody` (or its own collection) from that point. Operations' call sites
// — `secured.service.ts` — do not change, because they only ever knew this interface.
//
// WHAT THE PORT DELIBERATELY DOES NOT EXPOSE: no reconciliation, no balances, no vault location,
// no inter-vault transfer. Those are treasury concerns and none of them exist in the legacy
// behaviour being ported. The port is the hand-off, nothing more.

/** What the treasury records when it takes a secured shipment in. */
export interface VaultReceiptInput {
  shipmentId: string;
  receiptNumber: string;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  bagSeals: string[];
  boxSeals: string[];
  /** Dual control (Q2 NORMALIZE) — two DIFFERENT treasurers, enforced by the provider. */
  receivedByPrimaryId: string;
  receivedBySecondaryId: string;
}

/**
 * The custody facts Operations is allowed to see.
 *
 * Thin by default, and widened ONCE, deliberately (B4/B5): the packaging counts and the two
 * receiving treasurers are here because Operations genuinely reports on them — the legacy vault
 * screen listed bags, boxes and cartons per bank (contad_app.js:1437-1447) and the captain and
 * bank reports totalled them (:5006-5023). Dual control is also only meaningful if BOTH names can
 * be shown, which is the point of having required two of them (Q2).
 *
 * What stays out remains out: seal barcodes are the treasury's own record and no Operations screen
 * or report reads them, so they are not exposed here.
 */
export interface VaultCustodyView {
  id: string;
  shipmentId: string;
  state: 'held' | 'released';
  receiptNumber: string;
  receivedAt: Date;
  releasedAt: Date | null;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  receivedByPrimaryId: string;
  receivedBySecondaryId: string;
}

export interface VaultCustodyProvider {
  /** Take a shipment into custody. Rejects a shipment already held. */
  receive(input: VaultReceiptInput, by: string): Promise<VaultCustodyView>;
  /** Hand a shipment back out for delivery. Rejects anything not currently held. */
  release(shipmentId: string, by: string, session?: unknown): Promise<VaultCustodyView>;
  /** Current custody for a shipment, or null when the treasury never held it. */
  find(shipmentId: string): Promise<VaultCustodyView | null>;
  /**
   * Custody for a SET of shipments, keyed by shipment id. Shipments the treasury never held are
   * simply absent. Exists so a month's report is one question, not one per shipment.
   */
  findMany(shipmentIds: string[]): Promise<Map<string, VaultCustodyView>>;
  /** Everything the treasury is holding right now — the legacy /vault1 inventory question. */
  listHeld(page: number, pageSize: number): Promise<{ items: VaultCustodyView[]; total: number }>;
}

let provider: VaultCustodyProvider | null = null;

/** Registered once at module load, the directory-seam way. A second call replaces the provider. */
export const registerVaultCustodyProvider = (next: VaultCustodyProvider): void => {
  provider = next;
};

export const vaultCustody = (): VaultCustodyProvider => {
  if (provider === null) {
    throw new Error('no vault custody provider registered');
  }
  return provider;
};
