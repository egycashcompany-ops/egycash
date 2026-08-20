// بوابة العملاء والصناديق — everything a vault CUSTOMER is allowed to receive.
//
// One file on purpose: this is the whole outward-facing surface of the gold module, so a reviewer
// asking "what can a customer see?" reads exactly this and is done. The staff DTOs in `gold.ts`
// are never reused here, and that is the point — narrowing by allow-list means a field added to a
// staff DTO tomorrow cannot leak outward by inheritance.
//
// What the gold system's own portal returned and this deliberately does NOT:
//
//   · the vault's internal notes on a receipt, and the two custodians who signed it — staff names
//     and internal remarks on a document the customer only needs the totals of;
//   · the crew leader and the vehicle plate — EGYCASH's own operations, not the customer's;
//   · `createdBy` / `printCount` / branch ids — bookkeeping about how WE handled the paper;
//   · the counterparty's delegates on a transfer — another customer's people;
//   · every bar's movement history — it names the staff who moved it.
//
// gold returned all of that because its portal read the same `.lean()` documents the staff screens
// did. Nothing a customer actually looked at is lost.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';
import {
  GoldMetalTypeSchema,
  type GoldBarStatus,
  type GoldCompanyType,
  type GoldDocumentStatus,
  type GoldKeyStatus,
  type GoldMetalTotalDto,
} from './gold.js';

/** Who the customer is, as the portal header greets them. */
export interface GoldPortalMeDto {
  companyId: string;
  companyName: string;
  companyType: GoldCompanyType;
  /** The customer's own logo, if they gave us one — the header renders it beside the name. */
  logoFileId: string | null;
  /** The signed-in person's own name, for the account menu. */
  accountName: string;
}

/** The tiles across the top of the portal — gold's `portalOverview`, field for field. */
export interface GoldPortalOverviewDto {
  totalBars: number;
  totalWeight: number;
  goldWeight: number;
  silverWeight: number;
  totalDrawers: number;
  receivingCount: number;
  deliveryCount: number;
  transferCount: number;
  keysCount: number;
  representativesCount: number;
  byMetal: Record<string, GoldMetalTotalDto>;
}

export interface GoldPortalBarDto {
  id: string;
  serialNumber: string;
  brand: string | null;
  metalType: string;
  purity: string | null;
  weight: number;
  status: GoldBarStatus;
  /** Where it sits — by NAME and LABEL only; the customer has no use for our ids. */
  vaultName: string | null;
  drawerLabel: string | null;
}

/**
 * One drawer holding the customer's metal.
 *
 * The counts are the CUSTOMER's, not the drawer's: a drawer may hold three owners' bars, and each
 * of them sees only their own share of it. gold's aggregation did the same, which is why its
 * column headers read «عدد سبائكي» and «وزن سبائكي».
 */
export interface GoldPortalDrawerDto {
  drawerId: string;
  number: number;
  label: string;
  vaultName: string | null;
  myBarsCount: number;
  myWeight: number;
}

/** Receiving and delivery share one shape — the customer reads them as the same kind of paper. */
export interface GoldPortalReceiptDto {
  id: string;
  receiptNumber: string;
  receiptDate: string;
  /** The customer's OWN delegate who attended — never our staff. */
  representativeName: string | null;
  barsCount: number;
  totalWeight: number;
  status: GoldDocumentStatus;
}

export interface GoldPortalTransferDto {
  id: string;
  transferNumber: string;
  transferDate: string;
  /** Which way the metal's ownership moved, from THIS customer's point of view. */
  direction: 'in' | 'out';
  /** The other side's name only — no contact details, no delegates. */
  counterpartyName: string | null;
  barsCount: number;
  totalWeight: number;
  status: GoldDocumentStatus;
}

export interface GoldPortalKeyDto {
  id: string;
  vaultName: string | null;
  drawerNumber: number | null;
  drawerLabel: string | null;
  /** The customer's own delegate holding the key. */
  representativeName: string | null;
  status: GoldKeyStatus;
  handoverDate: string;
  returnDate: string | null;
}

/**
 * The customer's own delegates.
 *
 * The national id is carried, as gold's portal carried it: these are the customer's own people and
 * the customer registered those numbers with us in the first place. It is the one piece of personal
 * data on this surface, and it is theirs.
 */
export interface GoldPortalRepresentativeDto {
  id: string;
  fullName: string;
  nationalId: string | null;
  phone: string | null;
  jobTitle: string | null;
  status: string;
}

// ── Queries ────────────────────────────────────────────────────────────────
//
// Every schema is `.strict()` and none of them declares a company, a fund or a branch. That is the
// enforcement, not a convention: a customer who appends `?companyId=…` is answered with a 400 by
// the validator rather than having the value quietly ignored downstream.

export const GoldPortalListQuerySchema = PaginationQuerySchema.strict();
export type GoldPortalListQuery = z.infer<typeof GoldPortalListQuerySchema>;

export const GoldPortalBarsQuerySchema = PaginationQuerySchema.extend({
  metalType: GoldMetalTypeSchema.optional(),
  search: z.string().trim().max(200).optional(),
}).strict();
export type GoldPortalBarsQuery = z.infer<typeof GoldPortalBarsQuerySchema>;

export const GoldPortalMovementQuerySchema = z
  .object({
    metalType: GoldMetalTypeSchema.default('gold'),
    year: z.coerce.number().int().min(2000).max(2100),
    fromMonth: z.coerce.number().int().min(1).max(12).default(1),
    toMonth: z.coerce.number().int().min(1).max(12).default(12),
  })
  .strict();
export type GoldPortalMovementQuery = z.infer<typeof GoldPortalMovementQuerySchema>;

export const GoldPortalClosingQuerySchema = z
  .object({ metalType: GoldMetalTypeSchema.default('gold') })
  .strict();
export type GoldPortalClosingQuery = z.infer<typeof GoldPortalClosingQuerySchema>;

// ── Portal account administration (the STAFF side) ─────────────────────────

/** A customer login, as the staff screen lists it. */
export interface GoldPortalAccountDto {
  id: string;
  companyId: string;
  companyName: string | null;
  fullName: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  /** The platform account's own state — invited / active / suspended / archived. */
  status: string;
  /** Whether a setup link is outstanding, expired, consumed, or the account is locked out. */
  accountStatus: string;
  lastLoginAt: string | null;
  version: number;
}

/** Returned once, on creation — the link staff hand to the customer. */
export interface GoldPortalAccountCreatedDto extends GoldPortalAccountDto {
  activationToken: string;
}

const portalAccountName = z.object({
  ar: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120),
});

export const CreateGoldPortalAccountSchema = z
  .object({
    companyId: objectId(),
    firstName: portalAccountName,
    lastName: portalAccountName,
    /** The customer signs in by username; an email is optional and only used to send the link. */
    username: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/),
    email: z.string().trim().email().max(200).optional(),
    phone: z.string().trim().min(6).max(30).optional(),
  })
  .strict();
export type CreateGoldPortalAccount = z.infer<typeof CreateGoldPortalAccountSchema>;

export const UpdateGoldPortalAccountSchema = z
  .object({
    /** Re-pointing the account at another customer — a merger, or a correction. */
    companyId: objectId().optional(),
    firstName: portalAccountName.optional(),
    lastName: portalAccountName.optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    phone: z.string().trim().min(6).max(30).nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateGoldPortalAccount = z.infer<typeof UpdateGoldPortalAccountSchema>;

export const ChangeGoldPortalAccountStatusSchema = z
  .object({
    status: z.enum(['active', 'suspended']),
    version: z.number().int().min(0),
  })
  .strict();
export type ChangeGoldPortalAccountStatus = z.infer<typeof ChangeGoldPortalAccountStatusSchema>;

export const ListGoldPortalAccountsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  companyId: objectId().optional(),
}).strict();
export type ListGoldPortalAccountsQuery = z.infer<typeof ListGoldPortalAccountsQuerySchema>;
