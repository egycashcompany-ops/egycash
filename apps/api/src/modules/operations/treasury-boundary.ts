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

import {
  type OperationsVaultBagSealsPerBag,
  type OperationsVaultDenomination,
} from '@ecms/contracts';

/** The notes of one denomination a receipt counted (Round 18 — «عدد الورق من كل فئة»). */
export interface VaultDenominationCount {
  value: OperationsVaultDenomination;
  count: number;
}

/**
 * What the treasury records when it takes a secured shipment in.
 *
 * Round 18 — the legacy «إستلام محصنة» form, every field optional («كله اختيارى»): no receipt number
 * is null, and NO NAMES travel here any more («انا مش عاوز اى اسماء»). The receiver is the `by` of
 * `receive` — the signed-in user the route read from the token — and the provider records it as
 * `receivedById`. Q2's two treasurers (`receivedByPrimaryId` / `receivedBySecondaryId`, which had to
 * differ) are gone from the input; the rows that carry them stay readable (`VaultCustodyView`).
 */
export interface VaultReceiptInput {
  shipmentId: string;
  receiptNumber: string | null;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  /** «2×» / «3×» — the seals on each bag. */
  bagSealsPerBag: OperationsVaultBagSealsPerBag;
  /** As typed, already trimmed with the blank ones dropped (the contract's rule). */
  bagSeals: string[];
  boxSeals: string[];
  /** Any order, counts of 0 allowed — the provider stores only those above zero, smallest first. */
  denominations: VaultDenominationCount[];
}

/**
 * The custody facts Operations is allowed to see.
 *
 * Thin by default, and widened deliberately, each time for something Operations genuinely shows:
 *   · B4/B5 — the packaging counts and who received it, because the legacy vault screen listed
 *     bags, boxes and cartons per bank (contad_app.js:1437-1447) and the captain and bank reports
 *     totalled them (:5006-5023);
 *   · Round 18 — the note counts of each denomination and the seals-per-bag choice of the legacy
 *     receive form, which the receipt print («إيصال») and the vault inventory show;
 *   · Round 33 — who handed it over (`releasedById`, beside `releasedAt`), which the record of a past
 *     day on «تسليم المحصنات» names.
 *
 * WHO RECEIVED IT changed in Round 18. A receipt now records ONE person, the signed-in user
 * (`receivedById`) — the owner: «انا مش عاوز اى اسماء». A receipt taken before named two treasurers
 * (Q2's dual control); those two stay readable as they were stored, and are null on every newer
 * receipt, as `receivedById` is null on every older one.
 *
 * What stays out remains out: seal barcodes are the treasury's own record and no Operations screen
 * or report reads them, so they are not exposed here. Round 21b's `heldSeals` keeps it so: it
 * answers only about seals the caller already typed, never with a held custody's own list.
 */
export interface VaultCustodyView {
  id: string;
  shipmentId: string;
  state: 'held' | 'released';
  /** Null when the vault typed none (optional since Round 18). */
  receiptNumber: string | null;
  receivedAt: Date;
  releasedAt: Date | null;
  /**
   * Round 33 — who handed it over (the dispatch's signed-in user, from the token), or null while it
   * is held. «تسليم المحصنات»'s record of a past day names him beside `releasedAt`.
   */
  releasedById: string | null;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  /** Null on a receipt taken before Round 18, when the form did not ask. */
  bagSealsPerBag: OperationsVaultBagSealsPerBag | null;
  /** Only those above zero, smallest first; empty on a receipt taken before Round 18. */
  denominations: VaultDenominationCount[];
  /** The user who received it (Round 18); null on a receipt taken before. */
  receivedById: string | null;
  /** The two treasurers a receipt taken before Round 18 named; null on every newer receipt. */
  receivedByPrimaryId: string | null;
  receivedBySecondaryId: string | null;
  /**
   * Round 10 — when the receipt was CANCELLED, or null. Only `history` ever hands back a cancelled
   * custody: every other read is about what the treasury holds or took, and a cancelled receipt is
   * neither.
   */
  cancelledAt: Date | null;
}

/**
 * Round 21b — one of the caller's seals that the treasury HOLDS now, on another shipment's custody.
 * The port hands back only seals the caller already gave it, and where each is held: the seals of
 * the custody themselves stay behind the port, as on every other read.
 */
export interface VaultHeldSeal {
  /** The caller's seal, as given. */
  seal: string;
  /** Its position in the caller's list. */
  index: number;
  /** The shipment whose held custody carries the same seal. */
  shipmentId: string;
}

export interface VaultCustodyProvider {
  /**
   * Take a shipment into custody, received by `by` — the signed-in user (Round 18). Rejects a
   * shipment already held. Joins the caller's transaction
   * when given a session (Round 10: the vault's ✓ and the shipment's move to `inVault` are ONE
   * write, so a receive refused half-way — a stale version, a pickup ✓ taken back a moment before
   * — can no longer leave a held custody on a shipment still in draft); the caller announces it
   * (audit + event) after the commit, the `release` / `cancelReceipt` shape.
   */
  receive(input: VaultReceiptInput, by: string, session?: unknown): Promise<VaultCustodyView>;
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
  /**
   * Round 21b — which of `seals` are seals of a custody the treasury HOLDS now: «لو موجوده عندنا
   * لا ك محصنة يبقى مينفعش ولو دخلت وخرجت واتكرر يبقى عادى». The same set `listHeld` lists — a custody
   * released to its van, or a cancelled receipt, holds nothing — and the same seal by the contract's
   * `vaultSealKey`. `excludeShipmentId` leaves one shipment's custody out; blank seals are skipped.
   * Joins the caller's transaction when given a session, so a receipt decides on the snapshot it
   * writes in. In the caller's order; a seal given twice is answered at each place.
   */
  heldSeals(
    seals: readonly string[],
    options?: { excludeShipmentId?: string; session?: unknown },
  ): Promise<VaultHeldSeal[]>;
  /**
   * Every custody the treasury TOOK in the half-open window [from, toExclusive) — held or since
   * released — newest received first. A CANCELLED receipt is not one: the treasury took nothing
   * it kept, and the shipment's fresh receipt, if any, is its own row on its own day. Two readers:
   * the vault's receive queue asks for one Cairo day (the shipments received today, green beside
   * the ones still to receive), and the vault roll-up for its period («يجيب اللى اتسلم واللى متسلمش»).
   */
  receivedBetween(from: Date, toExclusive: Date): Promise<VaultCustodyView[]>;
  /**
   * Round 10 — CANCEL the receipt of a shipment the treasury holds: «صلاحية خاصة تقدر تلغى استلام
   * الخزينة». The custody is VOIDED, never erased — it keeps what was stamped and records when, who
   * and why — and from then on no live read sees it, so the shipment can be received afresh.
   * Rejects anything not currently held. Joins the caller's transaction when given a session; the
   * caller announces it (audit + event) after the commit.
   */
  cancelReceipt(
    shipmentId: string,
    reason: string,
    by: string,
    session?: unknown,
  ): Promise<VaultCustodyView>;
  /**
   * Every custody the treasury ever took for one shipment, a cancelled receipt included, oldest
   * first — the shipment's action log tells the whole story, including a receipt that was undone.
   */
  history(shipmentId: string): Promise<VaultCustodyView[]>;
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
