// The supplier form's state, proven payload by payload (design §2.3.6, OD-11 A): the record read
// into the form, the two names and every contact's name required, an e-mail that is no address
// marked before a round trip, the create's body with nothing it was not given, an edit that sends
// only what moved — the contacts and the categories whole — and the tax-number warning, which only
// follows the number the record holds.
import { describe, expect, it } from 'vitest';
import { supplier, supplierDetail } from '../supplier-fixtures';
import {
  EMPTY_CONTACT,
  MAX_CONTACTS,
  emailProblems,
  hasEmailProblem,
  looksLikeEmail,
  supplierChanges,
  supplierCreateBody,
  supplierFormFrom,
  supplierRequired,
  taxNumberHolders,
} from './supplier-form';

const blank = supplierFormFrom(null);

describe('the form read from a supplier', () => {
  it('starts empty and active for a new one, with no contact and no category', () => {
    expect(blank).toEqual({
      nameAr: '',
      nameEn: '',
      phone: '',
      email: '',
      address: '',
      taxNumber: '',
      commercialRegistry: '',
      paymentTerms: '',
      notes: '',
      categoryIds: [],
      contacts: [],
      isActive: true,
    });
  });

  it('holds every fact of a record as text, the categories by id in its own order', () => {
    const form = supplierFormFrom(supplier({ notes: null }));
    expect(form.nameAr).toBe('شركة النور للأدوات المكتبية');
    expect(form.taxNumber).toBe('123-456-789');
    expect(form.notes).toBe('');
    expect(form.categoryIds).toEqual(['c-ink', 'c-paper']);
    expect(form.contacts).toEqual([
      {
        name: 'هشام فؤاد',
        role: 'مدير المبيعات',
        phone: '01198765432',
        email: 'hesham@alnour.example',
      },
    ]);
  });

  it('bounds the contact people as the contract does — twenty', () => {
    expect(MAX_CONTACTS).toBe(20);
  });
});

describe('what Save asks for', () => {
  it('both names, and a name for every contact person listed', () => {
    expect(supplierRequired(blank)).toEqual({ nameAr: false, nameEn: false, contacts: [] });
    const form = {
      ...supplierFormFrom(supplier()),
      contacts: [
        { ...EMPTY_CONTACT, phone: '0100' },
        { ...EMPTY_CONTACT, name: ' سلمى ' },
      ],
    };
    expect(supplierRequired(form)).toEqual({ nameAr: true, nameEn: true, contacts: [false, true] });
  });

  it('marks an e-mail that is no address — the supplier’s own and each contact’s — and leaves an empty one alone', () => {
    expect(looksLikeEmail('sales@alnour.example')).toBe(true);
    expect(looksLikeEmail('sales@alnour')).toBe(false);
    expect(looksLikeEmail('sales alnour.example')).toBe(false);
    const form = {
      ...blank,
      email: 'sales@',
      contacts: [
        { ...EMPTY_CONTACT, name: 'أ', email: '' },
        { ...EMPTY_CONTACT, name: 'ب', email: 'b@x' },
      ],
    };
    expect(emailProblems(form)).toEqual({ email: true, contacts: [false, true] });
    expect(hasEmailProblem(form)).toBe(true);
    expect(hasEmailProblem(supplierFormFrom(supplier()))).toBe(false);
  });
});

describe('the create', () => {
  it('sends the names, the contacts and the categories, and only the optional facts given', () => {
    const body = supplierCreateBody({
      ...blank,
      nameAr: ' مورد ',
      nameEn: ' Supplier ',
      taxNumber: ' 555 ',
      categoryIds: ['c-paper'],
      contacts: [{ name: ' سلمى ', role: '', phone: ' 0100 ', email: '' }],
    });
    expect(body).toEqual({
      name: { ar: 'مورد', en: 'Supplier' },
      contacts: [{ name: 'سلمى', phone: '0100' }],
      categoryIds: ['c-paper'],
      taxNumber: '555',
    });
  });

  it('never sends a code, papers, a VAT status, a status or bank data', () => {
    const body = supplierCreateBody(supplierFormFrom(supplier())) as Record<string, unknown>;
    for (const key of ['code', 'attachments', 'vatStatus', 'isActive', 'iban', 'bankAccount']) {
      expect(body, key).not.toHaveProperty(key);
    }
  });
});

describe('the edit', () => {
  const record = supplier();

  it('sends nothing for a form left as it was read', () => {
    expect(supplierChanges(supplierFormFrom(record), record)).toEqual({});
  });

  it('sends a moved fact, and null for an emptied one', () => {
    const form = {
      ...supplierFormFrom(record),
      phone: '0222',
      paymentTerms: '  ',
      isActive: false,
    };
    expect(supplierChanges(form, record)).toEqual({
      phone: '0222',
      paymentTerms: null,
      isActive: false,
    });
  });

  it('sends the contact people whole when any of them moved', () => {
    const form = supplierFormFrom(record);
    form.contacts = [...form.contacts, { name: 'سلمى', role: '', phone: '', email: '' }];
    expect(supplierChanges(form, record)).toEqual({
      contacts: [
        {
          name: 'هشام فؤاد',
          role: 'مدير المبيعات',
          phone: '01198765432',
          email: 'hesham@alnour.example',
        },
        { name: 'سلمى' },
      ],
    });
    const cleared = { ...supplierFormFrom(record), contacts: [] };
    expect(supplierChanges(cleared, record)).toEqual({ contacts: [] });
  });

  it('sends the categories whole when one is added, removed or reordered', () => {
    const reordered = { ...supplierFormFrom(record), categoryIds: ['c-paper', 'c-ink'] };
    expect(supplierChanges(reordered, record)).toEqual({ categoryIds: ['c-paper', 'c-ink'] });
    const fewer = { ...supplierFormFrom(record), categoryIds: ['c-ink'] };
    expect(supplierChanges(fewer, record)).toEqual({ categoryIds: ['c-ink'] });
  });
});

describe('the tax-number warning beside the box (OD-11 (i))', () => {
  const holder = {
    id: 's-2',
    code: 'SUP-00002',
    name: { ar: 'فرع النور', en: 'Nour branch' },
    isActive: true,
  };
  const record = supplierDetail({ taxNumberMatches: [holder] });

  it('names the other holders while the box holds the record’s own number', () => {
    expect(taxNumberHolders(supplierFormFrom(record), record)).toEqual([holder]);
  });

  it('says nothing once the number is changed, for a register row, or for a new supplier', () => {
    expect(taxNumberHolders({ ...supplierFormFrom(record), taxNumber: '999' }, record)).toEqual([]);
    expect(taxNumberHolders(supplierFormFrom(supplier()), supplier())).toEqual([]);
    expect(taxNumberHolders(blank, null)).toEqual([]);
  });
});
