// A supplier's pure rules (design §2.3.6, §5.3, §5.15): the shape a write leaves its contacts and
// categories in, what it may newly name, what a retired supplier still allows, and what keeps one
// from retiring. No database and no clock: the service reads the facts — the row before, the
// categories a write names — and these decide.
//
// The bounds themselves (20 contacts, the field lengths, ids that are ids) are the contract's: a
// malformed body never reaches a rule. What is judged here needs the row the write leaves.
import {
  ADMINISTRATION_MAX_LIST_ATTACHMENTS,
  ErrorCodes,
  type AdministrationSupplierContact,
  type AdministrationSupplierReferenceField,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { AppError } from '../../../../shared/errors';
import { type AdministrationSupplierContactSub } from './supplier.model';

/** A contact as the record stores it: every part it was not given is null, never missing. */
export const contactsFrom = (
  contacts: readonly AdministrationSupplierContact[],
): AdministrationSupplierContactSub[] =>
  contacts.map((contact) => ({
    name: contact.name,
    role: contact.role ?? null,
    phone: contact.phone ?? null,
    email: contact.email ?? null,
  }));

/**
 * The categories a write names, as the database spells their ids (the contract takes A-F too, and
 * ids compare as strings), each once and in the order first given: a list is a set the screen
 * shows in its own order, and «stationery, stationery» is one category.
 */
export const canonicalCategoryIds = (ids: readonly string[]): string[] => [
  ...new Set(ids.map((id) => String(new Types.ObjectId(id)))),
];

/**
 * Which of `next` the write names anew — a category the row did not already name. Only those are
 * judged: a supplier keeps a category that retired after it was named, as an item keeps its own.
 */
export const newlyNamed = (next: readonly string[], before: readonly string[]): string[] => {
  const kept = new Set(before);
  return next.filter((id) => !kept.has(id));
};

/**
 * The 422 for retired categories a write names anew, one detail each — its `message` the
 * category's id, so a screen marks the very chip — or null. Which those are is the category's own
 * `activeFor` (a retired category "stays out of every new choice"), so the service asks it and
 * hands the refused ids here.
 */
export const categoryReferenceRefusal = (retiredIds: readonly string[]): AppError | null => {
  if (retiredIds.length === 0) return null;
  const field: AdministrationSupplierReferenceField = 'categoryIds';
  return new AppError(
    ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE,
    422,
    'a retired item category cannot be given to a supplier',
    {
      details: retiredIds.map((id) => ({ field, code: 'inactive', message: id })),
    },
  );
};

/** Does the papers list already hold all it may (§11.4)? Then nothing more is linked. */
export const isPaperListFull = (count: number): boolean =>
  count >= ADMINISTRATION_MAX_LIST_ATTACHMENTS;

/** The 422 a full papers list answers: remove a paper before linking another. */
export const paperLimitRefusal = (): AppError => {
  const message = `a supplier holds at most ${String(ADMINISTRATION_MAX_LIST_ATTACHMENTS)} papers`;
  return new AppError(ErrorCodes.ADMINISTRATION_ATTACHMENT_LIMIT, 422, message, {
    details: [{ field: 'attachments', code: 'limit', message }],
  });
};

/**
 * The acts that name a supplier. A retired supplier is hidden from NEW references — invitations
 * and orders from P3 and P4 — while what already names it keeps it (§5.3); those acts arrive with
 * their phases.
 */
export type SupplierAct = 'newReference' | 'existingReference';

export const activeFor = (supplier: { isActive: boolean }, act: SupplierAct): boolean =>
  act === 'existingReference' || supplier.isActive;

/**
 * Why this supplier may not retire: never (§5.3). Retiring one cancels nothing already approved or
 * issued, and whether a supplier can also be blocked is OD-12 (A: no).
 */
export const deactivationProblem = (_supplier: { isActive: boolean }): null => null;
