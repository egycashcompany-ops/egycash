// Administrative Affairs — what the whole module shares (docs/12-planning/administration-module-design.md
// §2.8, §11.4, §19.4): the master codes (P1a.2, the supplier's in P1b.1), the yearly document
// numbers (P2.1), the people it names (P1a.3), the bound every typed attachment list keeps
// (P1b.1), and what every document shares from P2.2 — its lines' cap, the acts its record offers
// and the locks its lines put on an item. An item is «ITM-00001» and a supplier «SUP-00001»
// (OD-05 A), generated, global, permanent and never reused, the way IT's asset and consumable
// codes are; a purchase request is «PR-2026-000001». The formatters and the parsers live here, not
// in the API, because a screen reads a code or a number too (a scanned label, a search) — IT's
// `formatConsumableMemoNumber` precedent.
//
// Names are not folded here: the module folds them with the shared `foldName`
// (`common/fold-name.ts`), so there is one fold for every module (PC-13).
import { z } from 'zod';
import { PaginationQuerySchema, objectId } from '../common/index.js';

/** Each master that takes a generated code: the item (P1a.2) and the supplier (P1b.1). */
export const ADMINISTRATION_MASTER_KINDS = ['item', 'supplier'] as const;
export type AdministrationMasterKind = (typeof ADMINISTRATION_MASTER_KINDS)[number];

/** Each master's prefix: one per kind, and a kind without one does not compile. */
export const ADMINISTRATION_MASTER_CODE_PREFIXES = {
  item: 'ITM',
  supplier: 'SUP',
} as const satisfies Record<AdministrationMasterKind, string>;

/**
 * The width a code pads to. A number past it simply grows wider — «ITM-100000» — rather than
 * being cut, so a code is never ambiguous; only the order of the strings stops being numeric.
 */
export const ADMINISTRATION_MASTER_CODE_DIGITS = 5;

/** A number a code may carry: a whole number from 1, small enough to be counted exactly. */
const isCodeNumber = (seq: number): boolean => Number.isSafeInteger(seq) && seq >= 1;

/**
 * «ITM-00001». Throws on a number no code may carry (0, a negative, a fraction, or one past the
 * safe integers): the counter hands out 1, 2, 3 …, so anything else is a bug upstream, and a
 * code made of it would be stored for ever.
 */
export const formatAdministrationMasterCode = (
  kind: AdministrationMasterKind,
  seq: number,
): string => {
  if (!isCodeNumber(seq)) {
    throw new RangeError(`a ${kind} code takes a whole number from 1, not ${String(seq)}`);
  }
  const digits = String(seq).padStart(ADMINISTRATION_MASTER_CODE_DIGITS, '0');
  return `${ADMINISTRATION_MASTER_CODE_PREFIXES[kind]}-${digits}`;
};

const MASTER_CODE = /^([A-Z]+)-(\d+)$/;

/**
 * The master and number a code names, or null. Only the code the formatter would write is read:
 * «ITM-1» and «ITM-000001» are not «ITM-00001», and a typed code must not find an item under a
 * second spelling of its number. 0, signs, fractions and numbers past the safe integers are null.
 */
export const parseAdministrationMasterCode = (
  code: string,
): { kind: AdministrationMasterKind; seq: number } | null => {
  const match = MASTER_CODE.exec(code);
  if (match === null) return null;
  const kind = ADMINISTRATION_MASTER_KINDS.find(
    (candidate) => ADMINISTRATION_MASTER_CODE_PREFIXES[candidate] === match[1],
  );
  if (kind === undefined) return null;
  const seq = Number(match[2]);
  if (!isCodeNumber(seq)) return null;
  return formatAdministrationMasterCode(kind, seq) === code ? { kind, seq } : null;
};

// ── Document numbers — the yearly series (design §2.8) ──────────────────────
//
// A document takes «PR-2026-000001» when it leaves draft (OD-58 A): one series per document type
// for the whole company, restarted each year, gap-free, never reused. The year is the Cairo
// calendar year of the act's business date (OD-57 A), which the server works out once from the
// act's instant; the formatter takes it as given, so a screen and the server print one number
// one way. More kinds join with their phases (the RFQ in P3, the PO in P4 …), each with its
// prefix.

/** Each document that takes a yearly number: the purchase request (P2). */
export const ADMINISTRATION_DOCUMENT_KINDS = ['purchaseRequest'] as const;
export type AdministrationDocumentKind = (typeof ADMINISTRATION_DOCUMENT_KINDS)[number];

/** Each document's prefix: one per kind, and a kind without one does not compile. */
export const ADMINISTRATION_DOCUMENT_PREFIXES = {
  purchaseRequest: 'PR',
} as const satisfies Record<AdministrationDocumentKind, string>;

/**
 * The width a document's sequence pads to. As with the master codes, a number past it grows
 * wider — «PR-2026-1000000» — rather than being cut.
 */
export const ADMINISTRATION_DOCUMENT_DIGITS = 6;

/**
 * A year a number may carry: four digits exactly, as `{YYYY}` prints it. The server's year is a
 * Cairo calendar year, so anything else is a bug upstream, and a number made of it would be
 * stored for ever.
 */
const isNumberYear = (year: number): boolean =>
  Number.isSafeInteger(year) && year >= 1000 && year <= 9999;

/**
 * «PR-2026-000001». Throws on a year that is not four digits, and on a sequence no counter hands
 * out (0, a negative, a fraction, one past the safe integers), for the master codes' reason.
 */
export const formatAdministrationNumber = (
  kind: AdministrationDocumentKind,
  year: number,
  seq: number,
): string => {
  if (!isNumberYear(year)) {
    throw new RangeError(`a ${kind} number takes a four-digit year, not ${String(year)}`);
  }
  if (!isCodeNumber(seq)) {
    throw new RangeError(`a ${kind} number takes a whole number from 1, not ${String(seq)}`);
  }
  const digits = String(seq).padStart(ADMINISTRATION_DOCUMENT_DIGITS, '0');
  return `${ADMINISTRATION_DOCUMENT_PREFIXES[kind]}-${String(year)}-${digits}`;
};

const DOCUMENT_NUMBER = /^([A-Z]+)-(\d{4})-(\d+)$/;

/**
 * The document, year and sequence a number names, or null. Only the number the formatter would
 * write is read, as with the master codes: «PR-2026-1» and «PR-2026-0000001» are not
 * «PR-2026-000001», so a typed number never finds a document under a second spelling, and a
 * number typed into the database by hand cannot floor its series (`shared/document-number.ts`).
 */
export const parseAdministrationNumber = (
  value: string,
): { kind: AdministrationDocumentKind; year: number; seq: number } | null => {
  const match = DOCUMENT_NUMBER.exec(value);
  if (match === null) return null;
  const kind = ADMINISTRATION_DOCUMENT_KINDS.find(
    (candidate) => ADMINISTRATION_DOCUMENT_PREFIXES[candidate] === match[1],
  );
  if (kind === undefined) return null;
  const year = Number(match[2]);
  const seq = Number(match[3]);
  if (!isNumberYear(year) || !isCodeNumber(seq)) return null;
  return formatAdministrationNumber(kind, year, seq) === value ? { kind, year, seq } : null;
};

// ── People — the employees the module names (design §7.8) ───────────────────
//
// A warehouse names its keeper (OD-10 keeper (i)), and from P2 documents name their requesters and
// recipients. The module asks the platform directory, never HR (no `employee.view`, no import of
// HR), under its own keys, and publishes exactly the facts below: who, and where HR places them.
// Nothing about a person is stored here or written by the module.

/** HR's employment status, as the directory answers it; a screen marks `exited` as «left». */
export const ADMINISTRATION_PERSON_STATUSES = [
  'probation',
  'active',
  'onLeave',
  'suspended',
  'exited',
] as const;
export type AdministrationPersonStatus = (typeof ADMINISTRATION_PERSON_STATUSES)[number];

/**
 * The picker's search: the code or the name, matched the way HR's own register matches them, within
 * the reach of the keys that open it. Only the people who work here today are offered — a new
 * reference never names a leaver — so the query has no status. `branchId` narrows to one branch.
 */
export const ListAdministrationPeopleQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  branchId: objectId().optional(),
  sortBy: z.enum(['name', 'code']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
}).strict();
export type ListAdministrationPeopleQuery = z.infer<typeof ListAdministrationPeopleQuerySchema>;

export const AdministrationPersonIdParamSchema = z.object({ employeeId: objectId() }).strict();

/** One person, as the module's screens print them (§7.8): these seven facts and nothing else. */
export interface AdministrationPersonDto {
  employeeId: string;
  code: string;
  fullNameAr: string;
  status: AdministrationPersonStatus;
  branchId: string | null;
  departmentId: string | null;
  jobTitleId: string | null;
}

/**
 * The most entries one typed attachment list holds (design §11.4, list B): a supplier's papers now,
 * a request's and a receipt's later. It bounds the record's size and keeps one list inside a single
 * read of its files' scan states (§11.5); the write that would add one more is refused
 * (`ADMINISTRATION_ATTACHMENT_LIMIT`), its filter carrying the bound so two racing adds cannot
 * both pass it.
 */
export const ADMINISTRATION_MAX_LIST_ATTACHMENTS = 20;

// ── What every document shares (design §2.1, §5.1.4; P2.2) ─────────────────

/**
 * The most lines one document holds (design §2.1, Lines): Fleet's vehicle supply contract's 100,
 * so one posting transaction stays bounded (RK-33, measured in P5). A purchase request is the
 * first document to keep it; a count is the one exception (§2.6).
 */
export const ADMINISTRATION_MAX_DOCUMENT_LINES = 100;

/**
 * One act a document's record offers its reader (design §5.1.4), recruitment's `WorkflowActionDto`
 * shape: the act, the key it runs under, and whether this reader may run it now — with the reason
 * when not, so a screen shows the button disabled and says why instead of hiding it. Computed on
 * the server from the document's whole lifecycle table, so the web never re-implements one.
 */
export interface AdministrationAvailableActionDto {
  key: string;
  permission: string;
  enabled: boolean;
  /** Null when `enabled`; otherwise one of the document's own reasons. */
  reason: string | null;
}

/**
 * Why an item's base unit may not change now (`ADMINISTRATION_ITEM_UNIT_LOCKED`'s detail `code`,
 * design §2.3.4): a document line names the item in that unit. A purchase request's line from
 * P2.2; the receipt, issue and count lines join with their phases, each as its checker registers.
 */
export const ADMINISTRATION_ITEM_UNIT_LOCKS = ['purchaseRequestLine'] as const;
export type AdministrationItemUnitLock = (typeof ADMINISTRATION_ITEM_UNIT_LOCKS)[number];
