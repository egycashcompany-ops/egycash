// The supplier form's state (design §2.3.6, OD-11 A, OD-12 A), mirroring the contracts: what the
// dialog holds as text, which values are missing or malformed, the body a create sends, and the
// fields an edit changes. Pure, so a spec proves each payload and each mark without a browser.
//
// No code field: the server takes «SUP-00001» inside the create (OD-05 A). No papers either: a
// paper is filed on the record, with its file, through its own endpoint. No VAT status: its values
// arrive with OD-29, and until then the contract takes nothing but null — so the form asks nothing.
// No bank data of any kind (OD-11 A). A repeated tax number is a WARNING, never a block (OD-11
// (i)): the form saves it, and the answer names the other holders.
import {
  ADMINISTRATION_SUPPLIER_MAX_CONTACTS,
  type AdministrationSupplierContact,
  type AdministrationSupplierDetailDto,
  type AdministrationSupplierDto,
  type CreateAdministrationSupplier,
  type UpdateAdministrationSupplier,
} from '@ecms/contracts';

/** The contracts' bounds, so a long value stops at the box rather than at a 400. */
export const PHONE_MAX = 30;
export const EMAIL_MAX = 200;
export const ADDRESS_MAX = 500;
export const REGISTRY_NUMBER_MAX = 50;
export const PAYMENT_TERMS_MAX = 500;
export const SUPPLIER_NOTES_MAX = 2000;
export const CONTACT_NAME_MAX = 120;
export const CONTACT_ROLE_MAX = 120;
export const MAX_CONTACTS = ADMINISTRATION_SUPPLIER_MAX_CONTACTS;

/** One contact person as the form holds it: every part text, empty for «not given». */
export interface SupplierContactRow {
  name: string;
  role: string;
  phone: string;
  email: string;
}

export interface SupplierForm {
  nameAr: string;
  nameEn: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  commercialRegistry: string;
  paymentTerms: string;
  notes: string;
  /** The item categories it supplies, in the order chosen. */
  categoryIds: string[];
  contacts: SupplierContactRow[];
  isActive: boolean;
}

export const EMPTY_CONTACT: SupplierContactRow = { name: '', role: '', phone: '', email: '' };

export const supplierFormFrom = (supplier: AdministrationSupplierDto | null): SupplierForm => ({
  nameAr: supplier?.name.ar ?? '',
  nameEn: supplier?.name.en ?? '',
  phone: supplier?.phone ?? '',
  email: supplier?.email ?? '',
  address: supplier?.address ?? '',
  taxNumber: supplier?.taxNumber ?? '',
  commercialRegistry: supplier?.commercialRegistry ?? '',
  paymentTerms: supplier?.paymentTerms ?? '',
  notes: supplier?.notes ?? '',
  categoryIds: supplier?.categories.map((category) => category.id) ?? [],
  contacts: (supplier?.contacts ?? []).map((contact) => ({
    name: contact.name,
    role: contact.role ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
  })),
  isActive: supplier?.isActive ?? true,
});

/**
 * What a supplier cannot be saved without (`CreateAdministrationSupplierSchema`): both names, and a
 * name for every contact person listed — a blank row is a mistake, not an empty contact.
 */
export const supplierRequired = (
  form: SupplierForm,
): { nameAr: boolean; nameEn: boolean; contacts: boolean[] } => ({
  nameAr: form.nameAr.trim() !== '',
  nameEn: form.nameEn.trim() !== '',
  contacts: form.contacts.map((contact) => contact.name.trim() !== ''),
});

/**
 * An e-mail the server would refuse as no address at all — told beside its box on Save rather than
 * after a round trip. Loose on purpose: the server's own check decides, this only catches a slip.
 */
export const looksLikeEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value.trim());

/** Which e-mail boxes hold something that is no address: the supplier's own, and each contact's. */
export const emailProblems = (form: SupplierForm): { email: boolean; contacts: boolean[] } => {
  const wrong = (value: string): boolean => value.trim() !== '' && !looksLikeEmail(value);
  return {
    email: wrong(form.email),
    contacts: form.contacts.map((contact) => wrong(contact.email)),
  };
};

export const hasEmailProblem = (form: SupplierForm): boolean => {
  const problems = emailProblems(form);
  return problems.email || problems.contacts.some(Boolean);
};

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** The contact people as the contract takes them: a part not given is left out. */
export const contactsBody = (
  contacts: readonly SupplierContactRow[],
): AdministrationSupplierContact[] =>
  contacts.map((row) => {
    const contact: AdministrationSupplierContact = { name: row.name.trim() };
    const role = orNull(row.role);
    if (role !== null) contact.role = role;
    const phone = orNull(row.phone);
    if (phone !== null) contact.phone = phone;
    const email = orNull(row.email);
    if (email !== null) contact.email = email;
    return contact;
  });

/** The optional text fields, by the contract's names. */
const TEXT_FIELDS = [
  'phone',
  'email',
  'address',
  'taxNumber',
  'commercialRegistry',
  'paymentTerms',
  'notes',
] as const;

export const supplierCreateBody = (form: SupplierForm): CreateAdministrationSupplier => {
  const body: CreateAdministrationSupplier = {
    name: { ar: form.nameAr.trim(), en: form.nameEn.trim() },
    contacts: contactsBody(form.contacts),
    categoryIds: [...form.categoryIds],
  };
  for (const field of TEXT_FIELDS) {
    const value = orNull(form[field]);
    if (value !== null) body[field] = value;
  }
  return body;
};

const sameContacts = (
  a: readonly AdministrationSupplierContact[],
  b: AdministrationSupplierDto['contacts'],
): boolean =>
  a.length === b.length &&
  a.every(
    (contact, i) =>
      contact.name === b[i]?.name &&
      (contact.role ?? null) === b[i]?.role &&
      (contact.phone ?? null) === b[i]?.phone &&
      (contact.email ?? null) === b[i]?.email,
  );

/**
 * What an edit changes — only the facts that moved; an emptied optional box is `null`. The contact
 * people and the categories are each sent whole when anything in them moved (the contract replaces
 * either list whole).
 */
export const supplierChanges = (
  form: SupplierForm,
  supplier: AdministrationSupplierDto,
): Omit<UpdateAdministrationSupplier, 'version'> => {
  const changes: Omit<UpdateAdministrationSupplier, 'version'> = {};
  const name = { ar: form.nameAr.trim(), en: form.nameEn.trim() };
  if (name.ar !== supplier.name.ar || name.en !== supplier.name.en) changes.name = name;
  for (const field of TEXT_FIELDS) {
    const value = orNull(form[field]);
    if (value !== supplier[field]) changes[field] = value;
  }
  const contacts = contactsBody(form.contacts);
  if (!sameContacts(contacts, supplier.contacts)) changes.contacts = contacts;
  const before = supplier.categories.map((category) => category.id);
  if (
    form.categoryIds.length !== before.length ||
    form.categoryIds.some((id, i) => id !== before[i])
  ) {
    changes.categoryIds = [...form.categoryIds];
  }
  if (form.isActive !== supplier.isActive) changes.isActive = form.isActive;
  return changes;
};

/**
 * The other holders of the tax number the form still holds, when the record it edits names some
 * (OD-11 (i)) — the warning beside the box. A number typed anew is checked by the server on Save,
 * and its answer names them.
 */
export const taxNumberHolders = (
  form: SupplierForm,
  supplier: AdministrationSupplierDto | AdministrationSupplierDetailDto | null,
): AdministrationSupplierDetailDto['taxNumberMatches'] => {
  if (supplier === null || !('taxNumberMatches' in supplier)) return [];
  return orNull(form.taxNumber) === supplier.taxNumber ? supplier.taxNumberMatches : [];
};
