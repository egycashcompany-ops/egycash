// A supplier's pure rules (design §2.3.6, §5.3, §5.15; §19.7): the OD-11 A shape — the fields
// §2.3.6 lists and no bank, IBAN, account or national-id field; contacts stored with every part
// they were not given as null; categories as canonical ids, each once, and only those named anew
// judged, a retired one refused with its id; a papers list that holds at most 20; a retired
// supplier hidden only from new references; and no rule against retiring one (OD-12 A).
import { ErrorCodes } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import {
  activeFor,
  canonicalCategoryIds,
  categoryReferenceRefusal,
  contactsFrom,
  deactivationProblem,
  isPaperListFull,
  newlyNamed,
  paperLimitRefusal,
} from './supplier-rules';
import { AdministrationSupplierModel } from './supplier.model';

describe('the OD-11 A shape (§2.3.6)', () => {
  const paths = Object.keys(AdministrationSupplierModel.schema.paths).filter(
    (path) => !path.startsWith('_') && path !== '__v',
  );

  it('stores exactly §2.3.6’s fields, beside the standard ones', () => {
    const standard = [
      'schemaVersion',
      'isDeleted',
      'deletedAt',
      'deletedBy',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
    ];
    expect(paths.filter((path) => !standard.includes(path)).sort()).toEqual(
      [
        'code',
        'name.ar',
        'name.en',
        'nameKey',
        'phone',
        'email',
        'address',
        'contacts',
        'categoryIds',
        'taxNumber',
        'commercialRegistry',
        'vatStatus',
        'paymentTerms',
        'attachments',
        'notes',
        'isActive',
      ].sort(),
    );
  });

  it('keeps no bank, IBAN or account data, and no national id (§6.8)', () => {
    for (const path of paths) {
      expect(path, path).not.toMatch(/bank|iban|account|nationalId|swift/i);
    }
  });

  it('stores each contact as name, role, phone and email — nothing more', () => {
    const contact = AdministrationSupplierModel.schema.path('contacts') as unknown as {
      // An array of subdocuments exposes its own schema here; the cast reads only its paths.
      schema: { paths: Record<string, unknown> };
    };
    expect(Object.keys(contact.schema.paths).sort()).toEqual(['email', 'name', 'phone', 'role']);
  });
});

describe('contacts', () => {
  it('stores every part a contact was not given as null, never missing', () => {
    expect(
      contactsFrom([{ name: 'أحمد' }, { name: 'منى', phone: '0100', role: 'مبيعات' }]),
    ).toEqual([
      { name: 'أحمد', role: null, phone: null, email: null },
      { name: 'منى', role: 'مبيعات', phone: '0100', email: null },
    ]);
    expect(contactsFrom([])).toEqual([]);
  });
});

describe('the categories a supplier names', () => {
  const A = '64a0000000000000000000a1';
  const B = '64a0000000000000000000b2';

  it('spells each id as the database does, and names each once, in the order first given', () => {
    expect(canonicalCategoryIds([B.toUpperCase(), A, B])).toEqual([B, A]);
    expect(canonicalCategoryIds([])).toEqual([]);
  });

  it('judges only what a write names anew — a category already named is kept', () => {
    expect(newlyNamed([A, B], [A])).toEqual([B]);
    expect(newlyNamed([A], [A, B])).toEqual([]);
    expect(newlyNamed([], [A])).toEqual([]);
  });

  it('refuses retired categories with 422 ADMINISTRATION_REFERENCE_INACTIVE, one detail each', () => {
    expect(categoryReferenceRefusal([])).toBeNull();
    expect(categoryReferenceRefusal([A, B])).toMatchObject({
      code: ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE,
      httpStatus: 422,
      details: [
        { field: 'categoryIds', code: 'inactive', message: A },
        { field: 'categoryIds', code: 'inactive', message: B },
      ],
    });
  });
});

describe('the papers list (§11.4)', () => {
  it('holds at most 20', () => {
    expect(isPaperListFull(19)).toBe(false);
    expect(isPaperListFull(20)).toBe(true);
    expect(isPaperListFull(21)).toBe(true);
  });

  it('a full list answers 422 ADMINISTRATION_ATTACHMENT_LIMIT on its field', () => {
    expect(paperLimitRefusal()).toMatchObject({
      code: ErrorCodes.ADMINISTRATION_ATTACHMENT_LIMIT,
      httpStatus: 422,
      details: [{ field: 'attachments', code: 'limit' }],
    });
  });
});

describe('status (OD-12 A, §5.3)', () => {
  it('hides a retired supplier from new references only', () => {
    expect(activeFor({ isActive: true }, 'newReference')).toBe(true);
    expect(activeFor({ isActive: false }, 'newReference')).toBe(false);
    expect(activeFor({ isActive: false }, 'existingReference')).toBe(true);
  });

  it('has no rule against retiring a supplier', () => {
    expect(deactivationProblem({ isActive: true })).toBeNull();
  });
});
