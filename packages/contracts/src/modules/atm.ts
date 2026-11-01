// ATM Operations — the domain vocabulary, DTOs and input schemas (module `atm`).
//
// This file is the normalized form of the legacy standalone ATM system
// (`egycashcompany-ops/ATM`: contad_app.js + models/ + views/events/*.ejs), ported by parity:
// the legacy behaviour is the specification, and every deliberate deviation is recorded in
// docs/12-planning/atm-operations-port.md (the gold-module-port precedent). File:line references
// below point into that repo.
//
// The legacy encodes an operation's lifecycle as `end: 0|1` plus a vestigial `status` that is
// written 0 at creation and never changed (models/atm_rep_log.js:19). Here the open state IS
// `closedAt: null` — the fleet maintenance-visit precedent ("no status field to forget to flip").
import { z } from 'zod';
import {
  PaginationQuerySchema,
  booleanQuery,
  objectId,
  type LocalizedString,
} from '../common/index.js';
// `import type`, not an inline `type` specifier: under verbatimModuleSyntax the inline form still
// emits `import {} from './atm-register.js'`, a runtime cycle (atm-register.ts imports this file).
import type { AtmBankCode } from './atm-register.js';

// ── Bank code shape (the register's bank catalog, DEC-35) ───────────────────────────────────────

/**
 * The shape of a catalog bank code — `AtmBankCodeSchema` and the catalog live in atm-register.ts.
 * Upper-case letter first, then 1–9 upper-case letters or digits: the six seeds (NBE … NXT) fit,
 * and the lower-case sentinels `none` (map) and `total` (report fold) never can. Declared here,
 * not there, because the ref-label schemas below need it and atm-register.ts already imports this
 * file (the reverse import would be a module cycle).
 */
export const ATM_BANK_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

// ── Machine identity ────────────────────────────────────────────────────────────────────────────

/**
 * The one code rule every legacy entry point applies: trim, then strip leading zeros — the form
 * does it per line (`atm_replenishment.ejs:2025-2028`) and the mail reader does it on both email
 * formats (`Automation/src/index.js:73,85`). Shared here so client, server and the mail parser
 * cannot disagree about what "the same machine" means.
 */
export const normalizeAtmMachineCode = (raw: string): string => raw.trim().replace(/^0+/, '');

/**
 * Multi-line textarea → machine codes, in input order. The legacy multi-row forms split on
 * newlines and align sibling textareas BY LINE NUMBER (contad_app.js:640-641, 1897-1899); blank
 * lines are kept as empty strings there, so alignment survives — parsing is shared for the same
 * reason the code rule is.
 */
export const splitAtmFormLines = (raw: string): string[] =>
  raw.split('\n').map((line) => line.trim());

// ── Mail ticket status ──────────────────────────────────────────────────────────────────────────

/** Legacy `atm_mails.status`: 0 = pending (unread), 1 = accepted, 2 = rejected — both terminal. */
export const ATM_MAIL_TICKET_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export const AtmMailTicketStatusSchema = z.enum(ATM_MAIL_TICKET_STATUSES);
export type AtmMailTicketStatus = z.infer<typeof AtmMailTicketStatusSchema>;

/** Numeric legacy encoding (contad_app.js:2773 reject=2, :2836 accept=1), for migration parity. */
export const LEGACY_ATM_MAIL_STATUS_BY_CODE: Record<number, AtmMailTicketStatus> = {
  0: 'pending',
  1: 'accepted',
  2: 'rejected',
};

// ── Maintenance source ──────────────────────────────────────────────────────────────────────────

/**
 * Where a maintenance operation came from: typed on the page (contad_app.js:1896) or accepted
 * from a mail ticket (:2829). NEW as a stored field — legacy rows are indistinguishable after the
 * fact, which is exactly why the port keeps the provenance.
 */
export const ATM_MAINTENANCE_SOURCES = ['manual', 'mail'] as const;
export const AtmMaintenanceSourceSchema = z.enum(ATM_MAINTENANCE_SOURCES);
export type AtmMaintenanceSource = z.infer<typeof AtmMaintenanceSourceSchema>;

// ── Timer thresholds (UI behaviour, preserved verbatim) ─────────────────────────────────────────

/**
 * The live "Taken Time" colour ladder on the open replenishment rows
 * (atm_replenishment.ejs:1915-1921): ≥1h green, ≥2h yellow, ≥3h crimson. Data here so the web
 * timer and its spec share one source.
 */
export const ATM_TIMER_THRESHOLD_HOURS = { green: 1, yellow: 2, red: 3 } as const;

// ── Machine (legacy `atm` master) ───────────────────────────────────────────────────────────────

export interface AtmMachineDto {
  id: string;
  /**
   * NEW: the ECMS organization branch. Legacy had no branch field — a branch WAS a separate
   * deployment (one server+DB per branch, contad_app.js:221-224); one central database makes the
   * branch explicit, and it is resolved server-side from the caller, never trusted from a form.
   */
  branchId: string;
  /** Legacy `bank` — a label from the ATM-owned bank list, stored verbatim on the machine. */
  bankName: string;
  /** Legacy `mach_id` — the machine identity every screen joins on. Normalized (no leading zeros). */
  machineCode: string;
  name: string;
  /** Legacy `zone` — written as '' by every live code path (contad_app.js:2443); kept for parity. */
  zone: string;
  /** Legacy `area` — the operational grouping the leader cascade works over. */
  area: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The legacy bulk add (contad_app.js:2412-2466): code+name line pairs plus one bank and one area
 * for the whole batch. Codes already registered are skipped, not errors (:2429-2451) — the result
 * names them so the operator finally SEES the skip the legacy performed silently.
 */
export const BulkCreateAtmMachinesSchema = z
  .object({
    bankName: z.string().min(1),
    area: z.string().min(1),
    machines: z
      .array(z.object({ machineCode: z.string().min(1), name: z.string().min(1) }).strict())
      .min(1)
      .max(500),
  })
  .strict();
export type BulkCreateAtmMachines = z.infer<typeof BulkCreateAtmMachinesSchema>;

// ── A data-edit add lands in the register (DEC-36) ──────────────────────────────────────────────
//
// The owner's call (final): a machine added on /atm/data-edit is recorded in the Efficiency
// register as an OPEN receipt dated the add day, linked to the machine and flagged «بيانات ناقصة»
// for Efficiency to complete. The add itself stays Operations' write (`atmMachine.manage`); the
// register entry is its side effect, so the answer says what happened on the register's side.

/**
 * `created` — a new open entry; `received` — a pending entry of this code was received; `linked` —
 * an open entry already here (an unlinked imported row, …) was linked to the machine; `existing` —
 * an open entry here already pointed at it; `none` — nothing was written (`reason` says why).
 */
export const ATM_MACHINE_REGISTER_ACTIONS = [
  'created',
  'received',
  'linked',
  'existing',
  'none',
] as const;
export type AtmMachineRegisterAction = (typeof ATM_MACHINE_REGISTER_ACTIONS)[number];

/**
 * Why `none`: no register code resolves to the branch (DEC-10 — the machine still works for
 * Operations; a code mapped to a branch linked to work as this one counts, `atm.branchLinks`), the
 * code is a placeholder (`#`, `********`), or the bank text maps to no catalog bank (the machine is
 * added; Efficiency receives it once the spelling is mapped).
 */
export const ATM_MACHINE_REGISTER_REASONS = [
  'branchUnmapped',
  'placeholderCode',
  'noBank',
] as const;
export type AtmMachineRegisterReason = (typeof ATM_MACHINE_REGISTER_REASONS)[number];

export interface AtmMachineRegisterOutcomeDto {
  action: AtmMachineRegisterAction;
  /** Set exactly when `action` is `none`. */
  reason: AtmMachineRegisterReason | null;
  /** The register entry written or linked; null when `none`. */
  entryId: string | null;
  /** The catalog bank the machine's bank text resolved to; null when it resolved to none. */
  bankCode: AtmBankCode | null;
}

/** POST /atm/machines (201) — the machine, whether it was an archived one brought back, and the register outcome. */
export interface AtmMachineCreateResultDto extends AtmMachineDto {
  /** True when the code was ARCHIVED in this branch and the add reactivated it with the form's data. */
  reactivated: boolean;
  register: AtmMachineRegisterOutcomeDto;
}

/** Why a bulk row was refused outright (nothing written for it): the code lives in another branch. */
export const ATM_MACHINE_BULK_REFUSALS = ['activeElsewhere', 'openElsewhere'] as const;
export type AtmMachineBulkRefusal = (typeof ATM_MACHINE_BULK_REFUSALS)[number];

export interface BulkCreateAtmMachinesResultDto {
  /** Machines newly created (an archived code brought back is in `reactivatedCodes` instead). */
  created: AtmMachineDto[];
  /** Codes already ACTIVE in the caller's branch — skipped exactly as legacy did. */
  skippedCodes: string[];
  /** Codes that were archived in this branch and are back at work with the batch's bank and area. */
  reactivatedCodes: string[];
  /**
   * Codes refused because the machine is active (`activeElsewhere`, DEC-9 — the mail matcher needs
   * one active machine per code) or has an open register period (`openElsewhere`, D6) in another
   * branch. Each row is its own unit, so one refusal does not undo the rest of the batch.
   */
  refused: { machineCode: string; reason: AtmMachineBulkRefusal }[];
  /** The register outcome per code, for every created or reactivated row. */
  register: {
    created: string[];
    received: string[];
    linked: string[];
    existing: string[];
    notRecorded: { machineCode: string; reason: AtmMachineRegisterReason }[];
  };
}

/**
 * Legacy machine delete (contad_app.js:2494-2508): soft delete AND rename the code to
 * `<code>-D`, which is what lets the same code be registered again later. Both preserved.
 */
export const BulkDeleteAtmMachinesSchema = z
  .object({ machineCodes: z.array(z.string().min(1)).min(1).max(500) })
  .strict();
export type BulkDeleteAtmMachines = z.infer<typeof BulkDeleteAtmMachinesSchema>;

export interface BulkDeleteAtmMachinesResultDto {
  deletedCodes: string[];
  /** Codes with no active machine in the caller's branch — legacy ignored these silently. */
  unknownCodes: string[];
}

/**
 * Single machine add — the per-item entry the data-edit screen offers alongside the legacy bulk
 * paste. Same fields the bulk form sets per row, plus the bank and area that the bulk form fixes
 * for the whole batch. `zone` is not offered: every legacy write stored '' (contad_app.js:2443).
 */
export const CreateAtmMachineSchema = z
  .object({
    bankName: z.string().min(1),
    area: z.string().min(1),
    machineCode: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
export type CreateAtmMachine = z.infer<typeof CreateAtmMachineSchema>;

/**
 * Edit one machine. `machineCode` is IDENTITY and is not editable — every operation row snapshots
 * it and the mail reader matches on it, so changing it would silently orphan history; a machine
 * registered under the wrong code is deleted (freeing the code via the `-D` rename) and re-added.
 *
 * `isActive` is the archive switch: an inactive machine disappears from the open forms and the
 * mail matcher (both read active only) while its code stays taken and its history stays readable
 * — which is the difference between this and delete.
 */
export const UpdateAtmMachineSchema = z
  .object({
    bankName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    area: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmMachine = z.infer<typeof UpdateAtmMachineSchema>;

/** Legacy "نقل ماكينة لمنطقة" (contad_app.js:2529-2541): rebase one machine onto another area. */
export const ReassignAtmMachineAreaSchema = z
  .object({ machineCode: z.string().min(1), area: z.string().min(1) })
  .strict();
export type ReassignAtmMachineArea = z.infer<typeof ReassignAtmMachineAreaSchema>;

/**
 * The same legacy move, area only, on one machine by id — the Operations path that survives the
 * data-edit split (efficiency register spec D2/DEC-3): `atmMachine.moveArea` may change WHERE a
 * machine is grouped without any other authority over the master. Versioned like every edit.
 */
export const UpdateAtmMachineAreaSchema = z
  .object({ area: z.string().trim().min(1), version: z.number().int().min(0) })
  .strict();
export type UpdateAtmMachineArea = z.infer<typeof UpdateAtmMachineAreaSchema>;

// ── Reference labels (legacy `atm_data_lists.bank[]` / `.area[]`) ───────────────────────────────
//
// The legacy singleton document held seven arrays; only `bank` and `area` are read or written by
// any live code path (contad_app.js:2477-2524 write them; data_edit_atm.ejs renders them). The
// other five (`zone`, `leaders`, `ops_emp`, `rep`, `maint`) are dead and are not carried —
// port doc GAP G4. These are ATM-OWNED lists, deliberately not the operations bank catalog:
// the legacy kept `atm_data_lists` separate from `data_lists`, the lists are administered by
// different teams, and `data_edit_atm` ADDS and REMOVES entries — a write no module may perform
// on another module's collection (port doc decision D1).

//
// Since the bank catalog (DEC-35) a `bank` label is an OPERATIONS SPELLING of a catalog bank
// (`NBE FOREX` → NBE, a legacy text …), per branch as before and now carrying its `bankCode`; the
// banks themselves are `atm_banks`. An `area` label gains display names in both languages (DEC-38):
// `name` stays the one string machines and operations store — for a new area the ENGLISH name
// (the owner: «الإنجليزي تمام»), since stored areas are Latin (MOHNDESSEN, ALEX) and the import's
// ` FX` rule needs Latin — and `nameAr`/`nameEn` are only what the pickers show.

export const ATM_REF_LABEL_KINDS = ['bank', 'area'] as const;
export type AtmRefLabelKind = (typeof ATM_REF_LABEL_KINDS)[number];

/**
 * Who wrote a label: typed on data-edit (`manual`), the boot backfill of areas already on machines
 * and open entries (`backfill`), a register save (`register`), a machine save (`machine`), or the
 * register import (`import`). A row stored before this field reads `manual`.
 */
export const ATM_REF_LABEL_ORIGINS = [
  'manual',
  'backfill',
  'register',
  'machine',
  'import',
] as const;
export type AtmRefLabelOrigin = (typeof ATM_REF_LABEL_ORIGINS)[number];

export interface AtmRefLabelDto {
  id: string;
  branchId: string;
  kind: AtmRefLabelKind;
  /** The canonical stored string — what a machine's `bankName`/`area` holds. */
  name: string;
  /** Areas: display names (null when not given). Banks: always null. */
  nameAr: string | null;
  nameEn: string | null;
  /** Areas: earlier canonical names, so a renamed name is never re-created by a later save. */
  formerNames: string[];
  /** Banks: the catalog bank this spelling stands for; null = not mapped yet. Areas: null. */
  bankCode: AtmBankCode | null;
  origin: AtmRefLabelOrigin;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A label's text: trimmed (JS `\s` covers NBSP and TAB); the register's area limit. */
const refLabelText = () => z.string().trim().min(1).max(120);

/** A spelling's bank as input — upper-cased, then the catalog code's shape. */
const refLabelBankCode = () => z.string().trim().toUpperCase().regex(ATM_BANK_CODE_PATTERN);

/**
 * POST /atm/ref-labels/:kind. Either the legacy `{ name }` — still accepted, so an older screen
 * keeps working — or the dialog's `{ nameAr, nameEn }` (both), from which the server takes the
 * English name as the stored `name`. The rules that depend on the kind (a spelling needs an ACTIVE
 * catalog bank; an area from a dialog needs both names) are the service's, because the kind is in
 * the path, not the body. `branchId` names the branch to file the label in; absent, the acting
 * branch, as before — the caller's key must reach it either way.
 */
export const CreateAtmRefLabelSchema = z
  .object({
    name: refLabelText().optional(),
    nameAr: refLabelText().optional(),
    nameEn: refLabelText().optional(),
    bankCode: refLabelBankCode().optional(),
    branchId: objectId().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || (v.nameAr !== undefined && v.nameEn !== undefined), {
    message: 'name, or both nameAr and nameEn',
    path: ['name'],
  });
export type CreateAtmRefLabel = z.infer<typeof CreateAtmRefLabelSchema>;

/** A display name on edit: absent keeps, '' or null clears. */
const refLabelDisplayName = () =>
  z
    .string()
    .max(120)
    .transform((s) => (s.trim() === '' ? null : s.trim()))
    .nullable()
    .optional();

/**
 * Edit one label. Renaming is deliberate and NOT a cascade: machines store the bank and area as
 * text (the legacy denormalized both, contad_app.js:2443), so a rename changes the list the forms
 * offer from now on and leaves already-registered machines saying what they said — and the old
 * name is kept in `formerNames`, so no later save brings it back as a new label. `isActive`
 * archives instead of removing — the list stops offering it, the machines keep it. `nameAr` /
 * `nameEn` change what the pickers show only; `bankCode` (spellings) maps or re-maps a spelling to
 * an ACTIVE catalog bank, `null` un-maps it.
 */
export const UpdateAtmRefLabelSchema = z
  .object({
    name: z.string().min(1).optional(),
    nameAr: refLabelDisplayName(),
    nameEn: refLabelDisplayName(),
    bankCode: refLabelBankCode().nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmRefLabel = z.infer<typeof UpdateAtmRefLabelSchema>;

/** `branchId` narrows to one branch — a user who reaches several no longer sees them all mixed. */
export const ListAtmRefLabelsQuerySchema = PaginationQuerySchema.extend({
  isActive: booleanQuery().optional(),
  branchId: objectId().optional(),
}).strict();
export type ListAtmRefLabelsQuery = z.infer<typeof ListAtmRefLabelsQuerySchema>;

/** GET /atm/ref-labels/options — absent `branchId` = the acting branch. */
export const AtmRefLabelOptionsQuerySchema = z.object({ branchId: objectId().optional() }).strict();
export type AtmRefLabelOptionsQuery = z.infer<typeof AtmRefLabelOptionsQuerySchema>;

/**
 * What the data-edit dialogs (and the register form) offer for ONE branch, whole — no page cap,
 * no other branch's labels, and readable without `atmMachine.view`.
 *
 * · `banks` — every ACTIVE catalog bank (`kind: 'bank'`, `value` = its `opsLabel`), then this
 *   branch's active spellings mapped to an active bank (`kind: 'spelling'`, `value` = the spelling).
 *   `value` is exactly what gets stored on the machine.
 * · `areas` — the branch's active area labels with their display names.
 * · `branch` — where an add from these dialogs is filed, named for the top of the add form
 *   («الفرع: …»). Without `?branchId` it is the acting branch by the ATM write rule: an
 *   organization-wide holder (no reach list) files where the TOP BAR points — never their home
 *   placement — and on «كل الشركة» in the company's only active branch, else nowhere: `branch` is
 *   null, the lists are empty and the dialog asks for a branch in the top bar before any add. A
 *   caller with a reach list keeps the acting branch it always had. Optional in the type only so an
 *   older server's answer still types.
 * · `branchId` — the branch the lists are for: the `?branchId` asked for (an edit's machine's own,
 *   resolved through `atm.branchLinks`), else `branch.id`; null exactly when `branch` is null.
 * · `registerMapped` — whether some register code RESOLVES to the branch (a code mapped to it, or
 *   to a branch linked to work as it), i.e. whether an add here can be recorded in the register at
 *   all (DEC-10). False when `branch` is null.
 * · `unmappedBankNames` — the bank texts active machines here carry that resolve to no bank (at
 *   most 100), so Operations can map each one to its bank.
 * · `unmappedBankLabels` — the same texts, each with the spelling row of THIS branch that already
 *   holds it (an archived one, or one not linked to a bank), else null. «ربط ببنك» edits that row
 *   instead of adding a second one (the unique name index still holds an archived row, so an add
 *   would be refused), and never a row of another branch or one the list's page or status filter
 *   happens to hide (review finding).
 */
export interface AtmRefLabelOptionsDto {
  branchId: string | null;
  branch?: { id: string; name: LocalizedString } | null;
  registerMapped: boolean;
  banks: { value: string; bankCode: AtmBankCode; kind: 'bank' | 'spelling' }[];
  areas: { name: string; nameAr: string | null; nameEn: string | null }[];
  unmappedBankNames: string[];
  unmappedBankLabels: { name: string; label: AtmRefLabelDto | null }[];
}

// ── Operations (replenishment + maintenance) shared shapes ──────────────────────────────────────

/**
 * The most rows one bulk request carries (close, edit, delete). A board read whole can hold more
 * checked rows than this; the screen sends them in consecutive requests of this size.
 */
export const ATM_BULK_MAX_IDS = 200;

/** Bulk id selection — the checkbox multi-select every legacy grid action supports. */
export const AtmOperationIdsSchema = z
  .object({ ids: z.array(objectId()).min(1).max(ATM_BULK_MAX_IDS) })
  .strict();
export type AtmOperationIds = z.infer<typeof AtmOperationIdsSchema>;

// ── Bank/area name lists (the open boards' two filters) ─────────────────────────────────────────
//
// A bank or an area is FREE TEXT — a label an administrator typed (`atm_ref_labels`), copied onto
// every machine and every operation as written. So a name may itself hold a comma («Raml,
// Station»), and the platform's `listQuery` — which splits on every comma — cut such a name in
// two and the filter matched nothing. The legacy sent these as an array (`selected_cities[]`,
// atm_replenishment.ejs:592), which had no such problem.
//
// The list keeps the platform's own shape — ONE comma-separated value, in the API query and in the
// board's address bar alike — and escapes the two characters that would break it: `\,` is a comma
// inside a name, `\\` a backslash. A list whose names hold neither (every link written before this
// existed) reads exactly as it always did, so a remembered filter or a bookmark keeps working.

const escapeAtmName = (name: string): string => name.replace(/\\/g, '\\\\').replace(/,/g, '\\,');

/** Names → one list value. The inverse of `splitAtmNameList`. */
export const joinAtmNameList = (names: readonly string[]): string =>
  names.map(escapeAtmName).join(',');

/**
 * One list value → the names it carries: split on the commas that are not escaped, each name
 * trimmed (as `listQuery` trims), empty ones dropped. A backslash before any character keeps that
 * character; a lone trailing backslash is kept as written.
 */
export const splitAtmNameList = (raw: string): string[] => {
  const names: string[] = [];
  let current = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === '\\' && index + 1 < raw.length) {
      current += raw.charAt(index + 1);
      index += 1;
    } else if (char === ',') {
      names.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  names.push(current);
  return names.map((name) => name.trim()).filter((name) => name !== '');
};

/**
 * A bank/area list as a query field — `listQuery`'s contract (absent or empty means "not
 * narrowed"; a repeated parameter is accepted too, each occurrence read the same way) with the
 * escape above, so a name holding a comma arrives whole.
 */
export const atmNameListQuery = (max = 50) =>
  z.preprocess(
    (raw) => {
      if (raw === undefined || raw === null) return undefined;
      const parts = Array.isArray(raw) ? raw : [raw];
      const names = parts.flatMap((part) => splitAtmNameList(String(part)));
      return names.length === 0 ? undefined : names;
    },
    z.array(z.string().min(1)).min(1).max(max).optional(),
  );

/**
 * Open replenishment/maintenance list — bank/area narrowing. The legacy stored these per user in
 * a `filters` collection (models/filters.js) and applied them server-side; the port carries them
 * as query parameters and lets the client persist its own choice, which keeps the same visible
 * behaviour without a server-side preference store.
 *
 * A name matches every stored spelling of it that differs only by surrounding spaces («NBE» and
 * «NBE ») — the board shows them identically, so the filter treats them as one bank.
 */
export const ListAtmOpenOperationsQuerySchema = PaginationQuerySchema.extend({
  banks: atmNameListQuery(),
  areas: atmNameListQuery(),
}).strict();
export type ListAtmOpenOperationsQuery = z.infer<typeof ListAtmOpenOperationsQuerySchema>;

// ── The machine list's filters (/atm/machines «كل الماكينات») ───────────────────────────────────
//
// One control per column of the table — Bank, ID, ATM Name, Area — in the vehicles registry's
// shape: the dropdowns take several answers (ORed within a column), the columns are ANDed with each
// other, and every filter is SERVER-side, so it holds across pages and reaches the export too. The
// list and its summary read the SAME parameters; the summary is the list's whole answer counted.

/** The columns the machine list sorts by — the table's four, and nothing a stranger can name. */
export const ATM_MACHINE_SORT_FIELDS = ['bankName', 'machineCode', 'name', 'area'] as const;

/** How many machine codes one filter may name — a pasted list off a message, not the directory. */
export const ATM_MACHINE_CODES_MAX = 200;

/**
 * Machine codes typed or pasted into the ID filter → the codes, normalized exactly as every entry
 * point normalizes them (`normalizeAtmMachineCode`), each once, in the order first written. A
 * machine code holds no space or comma, so whitespace, commas and semicolons (Latin or Arabic) all
 * separate; what is left empty — or only zeros — names no machine and is dropped.
 */
export const splitAtmMachineCodeList = (raw: string | readonly string[]): string[] => {
  const parts = Array.isArray(raw)
    ? (raw as readonly string[]).flatMap((part) => String(part).split(/[\s,،;؛]+/u))
    : String(raw).split(/[\s,،;؛]+/u);
  const out: string[] = [];
  for (const part of parts) {
    const code = normalizeAtmMachineCode(part);
    if (code !== '' && !out.includes(code)) out.push(code);
  }
  return out;
};

/** The machine codes as a query field: one comma-separated value or a repeated parameter. */
export const atmMachineCodesQuery = (max = ATM_MACHINE_CODES_MAX) =>
  z.preprocess(
    (raw) => {
      if (raw === undefined || raw === null) return undefined;
      const codes = splitAtmMachineCodeList(raw as string | readonly string[]);
      return codes.length === 0 ? undefined : codes;
    },
    z.array(z.string().min(1).max(50)).min(1).max(max).optional(),
  );

/**
 * The filters the list and its summary share.
 *
 * · `banks` / `areas` — the Bank and Area columns: names, exact, ORed, escaped like the open
 *   boards' (`atmNameListQuery`), each standing for every stored spelling that differs only by
 *   surrounding spaces. More of them than a board's: the directory holds every area at once.
 * · `codes` — the ID column: the machines named EXACTLY, normalized. A code no machine carries
 *   narrows to nothing rather than being dropped.
 * · `code` — a substring of the code, case-insensitive: what the ID picker SEARCHES as it is typed.
 * · `name` — the ATM Name column: a substring of the name, case-insensitive, taken literally.
 * · `isActive`, `search`, `bankName`, `area` — the list's existing parameters, unchanged.
 */
const atmMachineFilterFields = {
  isActive: booleanQuery().optional(),
  search: z.string().optional(),
  bankName: z.string().optional(),
  area: z.string().optional(),
  banks: atmNameListQuery(200),
  areas: atmNameListQuery(200),
  codes: atmMachineCodesQuery(),
  code: z.string().trim().max(50).optional(),
  name: z.string().trim().max(100).optional(),
};

export const ListAtmMachinesQuerySchema = PaginationQuerySchema.extend(
  atmMachineFilterFields,
).strict();
export type ListAtmMachinesQuery = z.infer<typeof ListAtmMachinesQuerySchema>;

/** The summary takes the list's filters and nothing about pages or order. */
export const AtmMachinesSummaryQuerySchema = z.object(atmMachineFilterFields).strict();
export type AtmMachinesSummaryQuery = z.infer<typeof AtmMachinesSummaryQuerySchema>;

/**
 * What the filter matched, counted over the WHOLE filtered set in the caller's scope — never the
 * page in hand — and the two dropdowns' sources.
 *
 * `counts.banks` / `counts.areas` are distinct names as the table shows them (surrounding spaces
 * ignored, blank names not counted). `options` follows the faceted rule: each dropdown offers the
 * names of the machines that match every OTHER filter — its own choice left out — so ticking a
 * second bank is always possible, while choosing an area narrows the banks to those it has (and
 * the reverse). A chosen name nothing matches is not offered; the screen still lists it, ticked.
 */
export interface AtmMachinesSummaryDto {
  counts: { machines: number; banks: number; areas: number };
  options: { banks: string[]; areas: string[] };
}

/** The filter dropdowns' source — `banks` narrows the AREAS offered (the cascade), nothing else. */
export const AtmOperationFacetsQuerySchema = z.object({ banks: atmNameListQuery() }).strict();
export type AtmOperationFacetsQuery = z.infer<typeof AtmOperationFacetsQuerySchema>;

/**
 * The filter dropdowns: distinct bank/area names of the OPEN rows in the caller's scope, each
 * name once however many spellings of it differ only by surrounding spaces.
 *
 * `banks` is every open row's bank (contad_app.js:261). `areas` is the open rows' areas — of the
 * SELECTED banks when there are any (the legacy saved filter's cascade, contad_app.js:262), and of
 * EVERY open row when there are none: the legacy saved filter offered nothing then, but the same
 * page's table-header filter row listed every area on the board (atm_replenishment.ejs:1001,
 * atm_maintenance.ejs:1285), so an area could always be chosen on its own.
 */
export interface AtmOperationFacetsDto {
  banks: string[];
  areas: string[];
}

/**
 * Done pages — `close_time` day range, both ends inclusive, defaulting to today when absent
 * (contad_app.js:941-964). Calendar dates, resolved against Africa/Cairo by the server.
 */
export const ListAtmDoneOperationsQuerySchema = PaginationQuerySchema.extend({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
}).strict();
export type ListAtmDoneOperationsQuery = z.infer<typeof ListAtmDoneOperationsQuerySchema>;

// ── Replenishment (legacy `atm_rep_log`) ────────────────────────────────────────────────────────

export interface AtmReplenishmentDto {
  id: string;
  branchId: string;
  /** The master row the snapshot came from — the snapshot fields stay the record (gold precedent). */
  machineId: string;
  machineCode: string;
  bankName: string;
  machineName: string;
  zone: string;
  area: string;
  openedAt: string;
  closedAt: string | null;
  /** Legacy `schedule_time` — free text, one per line of the open form. */
  scheduleTime: string | null;
  /** Legacy `leader` — free text on replenishments (atm_replenishment.ejs:1265). */
  leaderName: string | null;
  /** Legacy `ops_emp` ("Added By") — now the authenticated opener, snapshotted at write. */
  openedByName: string | null;
  /** Legacy `ops_emp2` ("Closed By"). Survives a reopen exactly as legacy left it. */
  closedByName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The multi-row open form (contad_app.js:637-768): one line per machine with its schedule text.
 * `forceDate` today/absent → opened now; another date → opened at 06:00 Africa/Cairo of that day
 * (:726, normalized from the legacy's fake-UTC composition — port doc quirk T1).
 */
export const OpenAtmReplenishmentsSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            machineCode: z.string().min(1),
            scheduleTime: z.string().nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    forceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type OpenAtmReplenishments = z.infer<typeof OpenAtmReplenishmentsSchema>;

/** Codes with no active machine are reported back, not silently shared state (quirk G-race). */
export interface OpenAtmReplenishmentsResultDto {
  opened: AtmReplenishmentDto[];
  unknownCodes: string[];
  /**
   * The owner's rule (2026-10-13, «مينفعش أضيف ماكينة مرتين»; per day since 2026-10-27): one entry
   * per submitted line that was NOT opened because its machine already has an open replenishment
   * ON THE BATCH'S DAY — anywhere in the company — or because the same code appeared earlier in
   * this batch (that earlier line opened).
   * The other lines still open, the same partial semantics as `unknownCodes`. A code only, never
   * where the open operation is.
   */
  alreadyOpenCodes: string[];
}

export const UpdateAtmReplenishmentSchema = z
  .object({
    scheduleTime: z.string().nullable().optional(),
    openedAt: z.coerce.date().optional(),
    /**
     * Setting a DIFFERENT leader cascades to every open replenishment of the same area within the
     * same shift window (06:00–16:00 / 16:00–06:00 Cairo — contad_app.js:854-868), exactly as
     * legacy. The cascade fires only when `openedAt` is not being changed in the same submit —
     * the legacy's own precedence (:854-859), preserved.
     */
    leaderName: z.string().nullable().optional(),
    /**
     * The dialog's «الوردية» box (2026-10-27): ticked — the default, and what an absent value
     * means — the leader cascades over the shift exactly as above; unticked, it is written on THIS
     * row only, whether or not the open time moves in the same submit.
     */
    cascadeLeader: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmReplenishment = z.infer<typeof UpdateAtmReplenishmentSchema>;

/**
 * Checked-rows edit (contad_app.js:870-889): schedule/open time on all, leader on all if changed.
 * `cascadeLeader: true` (the dialog's «الوردية» box, ticked) also carries the leader over the
 * shift of EVERY checked row — each one's area and shift window, as the single edit does, and
 * under its rule: not when the open time is moved in the same submit. Absent or false: the
 * checked rows only, the legacy's own asymmetry.
 */
export const BulkUpdateAtmReplenishmentsSchema = z
  .object({
    ids: z.array(objectId()).min(1).max(ATM_BULK_MAX_IDS),
    scheduleTime: z.string().nullable().optional(),
    openedAt: z.coerce.date().optional(),
    leaderName: z.string().nullable().optional(),
    cascadeLeader: z.boolean().optional(),
  })
  .strict();
export type BulkUpdateAtmReplenishments = z.infer<typeof BulkUpdateAtmReplenishmentsSchema>;

// ── Maintenance (legacy `atm_maint_log`) ────────────────────────────────────────────────────────

export interface AtmMaintenanceDto {
  id: string;
  branchId: string;
  machineId: string;
  machineCode: string;
  bankName: string;
  machineName: string;
  zone: string;
  area: string;
  openedAt: string;
  closedAt: string | null;
  /** Legacy `service_type` — per-line on the open form; the mail issue text on accepted tickets. */
  serviceType: string | null;
  notes: string | null;
  referenceNumber: string | null;
  source: AtmMaintenanceSource;
  /** The accepted mail ticket behind a `mail` row — the join the legacy lost after acceptance. */
  mailTicketId: string | null;
  /**
   * Closing a maintenance REQUIRES assigning an employee (contad_app.js:1972, the modal's
   * required datalist at atm_maintenance.ejs:1186-1194) — the one structural difference from
   * replenishment close. The edit dialog may also write the display name as free text (:1627).
   */
  leaderEmployeeId: string | null;
  leaderName: string | null;
  openedByName: string | null;
  closedByName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The maintenance open form (contad_app.js:1896-1957): per-line service type and reference
 * number, and a free datetime (datetime-local) instead of replenishment's date-only.
 * `openedAt` absent → now.
 */
export const OpenAtmMaintenancesSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            machineCode: z.string().min(1),
            serviceType: z.string().nullable().default(null),
            referenceNumber: z.string().nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    openedAt: z.coerce.date().nullable().default(null),
  })
  .strict();
export type OpenAtmMaintenances = z.infer<typeof OpenAtmMaintenancesSchema>;

export interface OpenAtmMaintenancesResultDto {
  opened: AtmMaintenanceDto[];
  unknownCodes: string[];
  /** The owner's rule, as on `OpenAtmReplenishmentsResultDto.alreadyOpenCodes` — per kind. */
  alreadyOpenCodes: string[];
}

/** Close: single or checked set, always with the assigned employee (contad_app.js:1963-1983). */
export const CloseAtmMaintenancesSchema = z
  .object({
    ids: z.array(objectId()).min(1).max(ATM_BULK_MAX_IDS),
    leaderEmployeeId: objectId(),
  })
  .strict();
export type CloseAtmMaintenances = z.infer<typeof CloseAtmMaintenancesSchema>;

export const UpdateAtmMaintenanceSchema = z
  .object({
    serviceType: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    openedAt: z.coerce.date().optional(),
    /** Cascades by area+shift like replenishment, but with NO time-unchanged guard (:2019-2032). */
    leaderName: z.string().nullable().optional(),
    /** The «الوردية» box, as on `UpdateAtmReplenishmentSchema`: false = this row only. */
    cascadeLeader: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmMaintenance = z.infer<typeof UpdateAtmMaintenanceSchema>;

/**
 * Checked-rows maintenance edit. Legacy also wrote `schedule_time` here (contad_app.js:2042-2044)
 * — a field the maintenance schema never declared, so Mongoose strict mode dropped it silently on
 * every submit. A write that never landed is not behaviour; it is not carried (port doc T6).
 */
export const BulkUpdateAtmMaintenancesSchema = z
  .object({
    ids: z.array(objectId()).min(1).max(ATM_BULK_MAX_IDS),
    leaderName: z.string().nullable(),
    /** True: the leader also cascades over each checked row's area and shift (no time guard here). */
    cascadeLeader: z.boolean().optional(),
  })
  .strict();
export type BulkUpdateAtmMaintenances = z.infer<typeof BulkUpdateAtmMaintenancesSchema>;

/** One row of the close modal's employee datalist (atm_maintenance.ejs:1189-1193). */
export interface AtmLeaderOptionDto {
  employeeId: string;
  name: string;
}

// ── Mail tickets (legacy `atm_mails`) ───────────────────────────────────────────────────────────

export interface AtmMailTicketDto {
  id: string;
  branchId: string;
  /** Null when the machine matched at ingest was later deleted; the snapshot fields remain. */
  machineId: string | null;
  machineCode: string;
  bankName: string;
  machineName: string;
  area: string;
  /** Legacy `open_time` — when the reader stored the mail. */
  receivedAt: string;
  status: AtmMailTicketStatus;
  /** Legacy `status_txt` — the ticket issue extracted from the email body. */
  issueText: string;
  senderEmail: string;
  /** Legacy `found` — machine existed in the master at ingest. Stored, never rendered (GAP G2). */
  foundInMaster: boolean;
  /**
   * Legacy `duplication` — "this machine already has an OPEN maintenance", on ANY day and in any
   * branch. The legacy asked "opened TODAY" (contad_app.js:2674); the owner's rule (2026-10-13,
   * «مينفعش أضيف ماكينة مرتين») made it exactly the condition under which accept REFUSES the
   * ticket, so what the screen flags is what accept will refuse (port doc OD-1). Recomputed at
   * every pending-list read as the legacy GET did; the ingest-time value is kept on the row for
   * the log page (decision D5).
   */
  duplication: boolean;
  /** Legacy `action_by` + NEW `actionAt` — the legacy log never recorded WHEN (GAP G1). */
  actionByName: string | null;
  actionAt: string | null;
  /** Graph message id — the ingest idempotency key. Null on rows migrated from legacy. */
  providerMessageId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Accept/reject a checked set (or one row) — mail_maintenance.ejs:884-936. */
export const DecideAtmMailTicketsSchema = z
  .object({ ids: z.array(objectId()).min(1).max(200) })
  .strict();
export type DecideAtmMailTickets = z.infer<typeof DecideAtmMailTicketsSchema>;

/**
 * Why a selected ticket was NOT accepted and stays pending. One reason today: the owner's rule —
 * the ticket's machine already has an open maintenance (the row the screen flags `duplication`).
 * A ticket already decided, or outside the caller's scope, is skipped silently as before.
 */
export const ATM_MAIL_ACCEPT_REFUSAL_REASONS = ['maintenanceAlreadyOpen'] as const;
export const AtmMailAcceptRefusalReasonSchema = z.enum(ATM_MAIL_ACCEPT_REFUSAL_REASONS);
export type AtmMailAcceptRefusalReason = z.infer<typeof AtmMailAcceptRefusalReasonSchema>;

export interface AtmMailAcceptRefusalDto {
  ticketId: string;
  /** The ticket's own machine code — never where the blocking maintenance is. */
  machineCode: string;
  reason: AtmMailAcceptRefusalReason;
}

/**
 * The accept answer's `meta`. The `data` stays the array of tickets ACCEPTED, exactly as before,
 * so a client that reads only `data` keeps working; the refusals ride beside it.
 */
export interface AtmMailAcceptMetaDto {
  refused: AtmMailAcceptRefusalDto[];
}

/**
 * Put decided tickets back to PENDING from the log — «إسترجاع ويقدر يرجعه مفتوح لو قبل أو رفض
 * غلط» (2026-10-28). A rejected ticket simply reopens; an accepted one also removes the
 * maintenance it opened, which is only possible while that maintenance is still open — and only
 * when the ticket HAS one to take back. A ticket already pending, or outside the caller's scope, is
 * skipped silently, as accept/reject do.
 */
export const RestoreAtmMailTicketsSchema = DecideAtmMailTicketsSchema;
export type RestoreAtmMailTickets = DecideAtmMailTickets;

/**
 * Why a selected ticket was NOT restored:
 *   · `maintenanceClosed` — the maintenance it opened is already closed (work done is never erased);
 *   · `noLinkedMaintenance` — it was accepted but no maintenance, live or deleted, carries it: an
 *     accept from the legacy system (its import links no maintenance to its ticket). Returning it
 *     would leave that maintenance on the board while saying it was taken back, and a second
 *     accept could open another one.
 */
export const ATM_MAIL_RESTORE_REFUSAL_REASONS = [
  'maintenanceClosed',
  'noLinkedMaintenance',
] as const;
export const AtmMailRestoreRefusalReasonSchema = z.enum(ATM_MAIL_RESTORE_REFUSAL_REASONS);
export type AtmMailRestoreRefusalReason = z.infer<typeof AtmMailRestoreRefusalReasonSchema>;

export interface AtmMailRestoreRefusalDto {
  ticketId: string;
  machineCode: string;
  reason: AtmMailRestoreRefusalReason;
}

/** The restore answer's `meta` — `data` is the array of tickets RESTORED, as accept's is. */
export interface AtmMailRestoreMetaDto {
  refused: AtmMailRestoreRefusalDto[];
}

/** The log page range — legacy filters `open_time`, default today (contad_app.js:2909-2928). */
export const ListAtmMailLogQuerySchema = PaginationQuerySchema.extend({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
}).strict();
export type ListAtmMailLogQuery = z.infer<typeof ListAtmMailLogQuerySchema>;

/** The unread badge every legacy ATM page renders (contad_app.js:266-268). */
export interface AtmMailUnreadCountDto {
  count: number;
}

// ── Mail ingestion (the automation seam — contract now, transport later) ────────────────────────

/**
 * What the central mail reader hands ECMS per message. Parsing, machine matching, branch
 * resolution and the found/duplication flags are ECMS's job (the ingestion service), so the
 * transport stays a dumb pipe — port doc §9. `providerMessageId` is the idempotency key: the same
 * message delivered twice creates one ticket.
 */
export const AtmMailIngestSchema = z
  .object({
    providerMessageId: z.string().min(1),
    receivedAt: z.coerce.date(),
    senderEmail: z.string().min(1),
    subject: z.string().default(''),
    bodyText: z.string().min(1),
  })
  .strict();
export type AtmMailIngest = z.infer<typeof AtmMailIngestSchema>;

/**
 * `created` — ticket stored, message may be marked read + branch-categorized.
 * `duplicateMessage` — this providerMessageId was already ingested; nothing new stored.
 * `unmatched` — no machine code / no active machine matched. THE MESSAGE MUST STAY UNREAD in the
 * mailbox (the owner's rule), and unlike the legacy reader — which dropped these on the floor
 * (Automation/src/index.js:199-201) — the outcome says so explicitly.
 */
export const ATM_MAIL_INGEST_OUTCOMES = ['created', 'duplicateMessage', 'unmatched'] as const;
export const AtmMailIngestOutcomeSchema = z.enum(ATM_MAIL_INGEST_OUTCOMES);
export type AtmMailIngestOutcome = z.infer<typeof AtmMailIngestOutcomeSchema>;

export interface AtmMailIngestResultDto {
  outcome: AtmMailIngestOutcome;
  ticketId: string | null;
  /**
   * The branch the ticket was filed under — THE machine's branch, which is the whole of "classify
   * by branch" in one central reader, as ATM resolves it: a machine still filed under a linked
   * source is its target's (`atm.branchLinks`), so its mail is filed — and switched on, and
   * coloured — as the target's. The transport reads it to tag the message with that branch's
   * mailbox colour; null when nothing was filed.
   */
  branchId: string | null;
  /** Why an `unmatched` message did not match — for the reader's log, never for the mailbox. */
  reason: string | null;
}

// ── Module settings ─────────────────────────────────────────────────────────────────────────────

export const AtmSettingKeys = {
  /**
   * HR department ids whose employees populate the maintenance close-modal's assignee list. The
   * legacy hardcoded the Arabic department NAME — `department: "الصراف الالى"`
   * (contad_app.js:1110-1112); a name cannot be hardcoded against ECMS's org chart, so the port
   * of that constant is this setting (the operations CrewDepartmentIds precedent). DEFAULT EMPTY,
   * meaning an unconfigured install offers nobody — closing maintenance names a real employee or
   * does not happen, which is the legacy rule.
   */
  MaintenanceLeaderDepartmentIds: 'atm.maintenanceLeaderDepartmentIds',
  /**
   * branchId → the mailbox category name that marks a mail as that branch's.
   *
   * The legacy reader tagged every message it stored with one hard-coded "Green Category"
   * (Automation/src/index.js:224) — which was enough when each branch had its own reader and its
   * own mailbox. One central reader serving every branch needs the tag to say WHICH branch, which
   * is the owner's "كل Branch يتم تمييزه بالـcolor الخاص به". Empty means nothing is tagged;
   * messages are still marked read, because the tag is a convenience and the ticket is the record.
   *
   * Since the mailbox screen (`atm_mailbox_config`, atm-settings.ts) a switched-on branch carries
   * its own category there; this setting answers for a branch that has none, and is the only
   * source while the reader runs on the deployment's environment.
   */
  MailBranchCategories: 'atm.mail.branchCategories',
  /**
   * The ATM-only branch links `[{ branchId, actsAsBranchId }]` (value schema
   * `AtmBranchLinksSettingSchema` in atm-settings.ts). The owner (2026-10-28): «فرع أكتوبر شغال هو
   * والمهندسين مع بعض بكل بياناتهم والبيانات دي متسجله إنها المهندسين». On an ATM request a user
   * placed in `branchId` is answered as if placed in `actsAsBranchId`: they see its ATM data and
   * what they write is filed under it. DEFAULT EMPTY — no branch acts as another until linked.
   *
   * The ids that come from storage follow it too — the register's code mapping, a mail's machine,
   * a branch a request names — and data filed under a source before its link existed is moved to
   * the target by «نقل البيانات» (GET/POST /atm/branch-links/:sourceBranchId/move, atm-settings.ts).
   */
  BranchLinks: 'atm.branchLinks',
  /**
   * The efficiency register's `EGYCASH-1..7` → ECMS branch (D4; value schema
   * `AtmRegisterBranchCodesSettingSchema` in atm-register.ts). DEFAULT EMPTY — no branch is guessed
   * (EG-18), so an unconfigured install receives nothing and the import is blocked. Read through
   * `BranchLinks`: a code mapped to a linked source is its target's.
   */
  RegisterBranchCodes: 'atm.register.branchCodes',
  /**
   * RETIRED (DEC-35) — read once by the bank catalog seed. It used to map the register's bankCode
   * → the label written on `atm_machines.bankName` (D5); the catalog's `opsLabel` does that now.
   * Still declared, so a stored value keeps validating (value schema
   * `AtmRegisterBankLabelsSettingSchema`, default `ATM_DEFAULT_BANK_LABELS_SETTING`).
   */
  RegisterBankLabels: 'atm.register.bankLabels',
  /**
   * The banks the Settlements, Preparation and Control pages offer (docs/12-planning/
   * atm-settlements-phase1.md DS-24, §7.4). Defaults to `['BRK']`: Al Baraka first (S-10); a bank is
   * added once its import profile exists.
   */
  SettlementBanks: 'atm.settlements.banks',
} as const;

// ── Daily report (legacy /reports_atm) ──────────────────────────────────────────────────────────
//
// The legacy screen (contad_app.js:2208-2351, views/events/reports_atm.ejs) is ONE number pair per
// bank, for TODAY, for each of the two operation kinds: `not_end` (still open, painted red) over
// `all` (everything opened that day, painted green) — grouped by the `bank` string, deleted rows
// excluded. That is the whole report; there is no range, no drill-down and nothing stored.
//
// One read-only widening (port doc D7): the day is a PARAMETER defaulting to today. The legacy
// could only ever show today, which made "what did yesterday look like" a question the screen
// could not answer; a date on a read changes no behaviour and stores nothing.

export interface AtmBankCountsDto {
  /** The `bank` label the operations were opened under — the legacy `_id` of the $group. */
  bankName: string;
  /** Legacy `all` — every non-deleted operation opened that day. */
  total: number;
  /** Legacy `not_end` — those still open. */
  open: number;
}

export interface AtmDailyReportDto {
  /** The Cairo calendar day the counts cover (`YYYY-MM-DD`). */
  date: string;
  /** Empty when the caller may not read that half — the report never leaks past a grant. */
  replenishments: AtmBankCountsDto[];
  maintenances: AtmBankCountsDto[];
}

export const AtmDailyReportQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
export type AtmDailyReportQuery = z.infer<typeof AtmDailyReportQuerySchema>;
