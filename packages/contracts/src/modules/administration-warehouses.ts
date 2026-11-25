// Administrative Affairs — warehouses (docs/12-planning/administration-module-design.md §2.3.5,
// §19.3, §19.4): the stores of each branch, «المخازن» (P1a.3).
//
// A warehouse is a branch record: it belongs to one branch, set when it is created and never
// moved, because from P5 the stock ledger copies the branch onto every row and never re-files one —
// a store that moves branch is a new warehouse (OD-10 A). So the update schema has no `branchId` at
// all. It is never deleted either: `isActive: false` retires it and keeps its code and name. It
// holds no quantity; stock lives in the ledger's projection (ADR-024). No schema takes `nameKey`:
// the service folds it from `name.ar` (§2.1).
//
// The web cannot work out what a key reaches in a given branch — the session carries one scope per
// key and the union of every grant's branches — so the server answers it: each warehouse says
// whether the reader may edit it (`canEdit`), and the branch options say, per branch, whether the
// reader may read its warehouses and create one there.
import { z } from 'zod';
import { type LocalizedString } from '../common/localized.js';
import { PaginationQuerySchema, booleanQuery, objectId } from '../common/index.js';
import { AdministrationNameSchema } from './administration-catalog.js';
import { type AdministrationPersonDto } from './administration.js';

/**
 * The kinds of store (OD-10 A): a branch's main store, a branch store, a sub-store. A quarantine
 * store joins only if goods rejected at receipt are held apart (OD-34 B).
 */
export const ADMINISTRATION_WAREHOUSE_TYPES = ['main', 'branch', 'sub'] as const;
export const AdministrationWarehouseTypeSchema = z.enum(ADMINISTRATION_WAREHOUSE_TYPES);
export type AdministrationWarehouseType = z.infer<typeof AdministrationWarehouseTypeSchema>;

/**
 * Why a warehouse may not retire (`ADMINISTRATION_DEACTIVATION_BLOCKED`'s detail `code`, OD-70 B):
 * stock on hand or in transit, or a document not yet ended that names it. Nothing holds one in
 * Phase 1; the stock (P5) and each document feature answer as they ship.
 */
export const ADMINISTRATION_DEACTIVATION_PROBLEMS = ['holdsStock', 'openDocument'] as const;
export type AdministrationDeactivationProblem =
  (typeof ADMINISTRATION_DEACTIVATION_PROBLEMS)[number];

/**
 * A warehouse's code (OD-05 A): typed, in the org units' pattern — upper-case letters and digits,
 * a dash inside, up to 20 — and one per live warehouse across the company.
 */
export const AdministrationWarehouseCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/, 'uppercase letters/digits, e.g. MAIN or CAI-01');

/** Where the store sits within its branch — free text, as the owner's request lists it. */
const location = z.string().trim().max(200);
const notes = z.string().trim().max(2000);

/** The keeper as the directory answers today: who, and whether they still work here. */
export type AdministrationWarehouseKeeperDto = Pick<
  AdministrationPersonDto,
  'employeeId' | 'code' | 'fullNameAr' | 'status'
>;

export interface AdministrationWarehouseDto {
  id: string;
  code: string;
  name: LocalizedString;
  /** The branch it belongs to, for good. */
  branchId: string;
  /** The branch's name, resolved at read time (a retired branch still names itself). */
  branchName: LocalizedString | null;
  type: AdministrationWarehouseType;
  /** The owning department copy, reference-only (OD-10 department (i)): it grants nothing. */
  departmentId: string | null;
  /** «أمين المخزن» (OD-10 keeper (i)): accountability, not authority. */
  responsibleEmployeeId: string | null;
  /**
   * The keeper as HR answers today, read fresh and never stored. Null when there is no keeper —
   * and when the id resolves to nobody (after a workforce reset, OD-64 keeper (i)), which a screen
   * tells apart by `responsibleEmployeeId` and flags until a keeper is named again.
   */
  keeper: AdministrationWarehouseKeeperDto | null;
  location: string | null;
  notes: string | null;
  isActive: boolean;
  /** Whether the reader's `administrationWarehouse.edit` reaches this warehouse's branch. */
  canEdit: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The branch is the body's, checked against the create key's reach (OD-10 A); the code is typed.
 * A keeper must still work here; the department is the branch's own copy.
 */
export const CreateAdministrationWarehouseSchema = z
  .object({
    code: AdministrationWarehouseCodeSchema,
    name: AdministrationNameSchema,
    branchId: objectId(),
    type: AdministrationWarehouseTypeSchema,
    departmentId: objectId().nullable().optional(),
    responsibleEmployeeId: objectId().nullable().optional(),
    location: location.optional(),
    notes: notes.optional(),
  })
  .strict();
export type CreateAdministrationWarehouse = z.infer<typeof CreateAdministrationWarehouseSchema>;

/**
 * No `branchId`: a warehouse never changes branch, so a body that sends one is refused rather than
 * dropped. `null` clears the department, the keeper, the location or the notes; `isActive: false`
 * retires the warehouse (§5.3, OD-70 B).
 */
export const UpdateAdministrationWarehouseSchema = z
  .object({
    code: AdministrationWarehouseCodeSchema.optional(),
    name: AdministrationNameSchema.optional(),
    type: AdministrationWarehouseTypeSchema.optional(),
    departmentId: objectId().nullable().optional(),
    responsibleEmployeeId: objectId().nullable().optional(),
    location: location.nullable().optional(),
    notes: notes.nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAdministrationWarehouse = z.infer<typeof UpdateAdministrationWarehouseSchema>;

/**
 * `search` reads the code, both names and the folded Arabic name. `branchId` only narrows: a branch
 * outside the reader's reach is a 400 `OUT_OF_REACH`, never a widening and never an empty page.
 */
export const ListAdministrationWarehousesQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  branchId: objectId().optional(),
  type: AdministrationWarehouseTypeSchema.optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListAdministrationWarehousesQuery = z.infer<
  typeof ListAdministrationWarehousesQuerySchema
>;

/**
 * One active branch, named and ordered as the top bar's branch switcher names and orders them.
 * `canView`: the reader's `administrationWarehouse.view` reaches it under the top bar's choice —
 * what the register's branch filter offers. `canCreate`: their `administrationWarehouse.create`
 * reaches it — what the create dialog's branch offers. A branch outside both carries both false.
 */
export interface AdministrationWarehouseBranchOptionDto {
  branchId: string;
  name: LocalizedString;
  canView: boolean;
  canCreate: boolean;
}
