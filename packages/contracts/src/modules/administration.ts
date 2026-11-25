// Administrative Affairs — what the whole module shares (docs/12-planning/administration-module-design.md
// §2.8, §11.4, §19.4): the master codes (P1a.2, the supplier's in P1b.1), the people it names
// (P1a.3) and the bound every typed attachment list keeps (P1b.1). An item is «ITM-00001» and a
// supplier «SUP-00001» (OD-05 A), generated, global, permanent and never reused, the way IT's asset
// and consumable codes are. The formatter and the parser live here, not in the API, because a
// screen reads a code too (a scanned label, a search) — IT's `formatConsumableMemoNumber`
// precedent.
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
