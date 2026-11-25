// The master codes (design §2.8, §19.7; OD-05 A): «ITM-00001» and «SUP-00001» format and parse,
// one spelling per number, each prefix naming its own master, and no number a counter never hands
// out — 0, a negative, a fraction, an overflow — makes or reads a code (the
// `consumable-number.spec.ts` shape). The yearly document numbers (§2.8; OD-57 A, OD-58 A),
// «PR-2026-000001», on the same rules, with a four-digit year. And the people the module names
// (§7.8): a search with no status, since only the employed are offered, and an id parameter. And
// what every document shares (P2.2): its lines' cap and the locks its lines put on an item. And
// from P2.3 why a document may not go to its chain, its events and its notices.
import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATION_APPROVAL_CHAIN_PROBLEMS,
  ADMINISTRATION_DOCUMENT_DIGITS,
  ADMINISTRATION_DOCUMENT_KINDS,
  ADMINISTRATION_DOCUMENT_PREFIXES,
  ADMINISTRATION_MASTER_CODE_DIGITS,
  ADMINISTRATION_MASTER_CODE_PREFIXES,
  ADMINISTRATION_ITEM_UNIT_LOCKS,
  ADMINISTRATION_MASTER_KINDS,
  ADMINISTRATION_MAX_DOCUMENT_LINES,
  ADMINISTRATION_MAX_LIST_ATTACHMENTS,
  ADMINISTRATION_PERSON_STATUSES,
  AdministrationEvents,
  AdministrationPersonIdParamSchema,
  AdministrationPurchaseRequestSubmittedPayloadV1,
  AdministrationTemplates,
  ListAdministrationPeopleQuerySchema,
  formatAdministrationMasterCode,
  formatAdministrationNumber,
  parseAdministrationMasterCode,
  parseAdministrationNumber,
} from './administration.js';

describe('the master codes', () => {
  it('codes an item «ITM-00001», five digits, generated (OD-05 A)', () => {
    expect(ADMINISTRATION_MASTER_KINDS).toEqual(['item', 'supplier']);
    expect(ADMINISTRATION_MASTER_CODE_PREFIXES).toEqual({ item: 'ITM', supplier: 'SUP' });
    expect(ADMINISTRATION_MASTER_CODE_DIGITS).toBe(5);
    expect(formatAdministrationMasterCode('item', 1)).toBe('ITM-00001');
    expect(formatAdministrationMasterCode('item', 4321)).toBe('ITM-04321');
  });

  it('codes a supplier «SUP-00001», on the same rules (OD-05 A)', () => {
    expect(formatAdministrationMasterCode('supplier', 1)).toBe('SUP-00001');
    expect(formatAdministrationMasterCode('supplier', 123_456)).toBe('SUP-123456');
    expect(parseAdministrationMasterCode('SUP-00042')).toEqual({ kind: 'supplier', seq: 42 });
  });

  it('reads each prefix as its own master — a supplier code is never an item’s', () => {
    expect(parseAdministrationMasterCode('ITM-00007')?.kind).toBe('item');
    expect(parseAdministrationMasterCode('SUP-00007')?.kind).toBe('supplier');
  });

  it('grows wider past five digits rather than cutting the number', () => {
    expect(formatAdministrationMasterCode('item', 99_999)).toBe('ITM-99999');
    expect(formatAdministrationMasterCode('item', 123_456)).toBe('ITM-123456');
  });

  it.each([
    ['zero', 0],
    ['a negative', -1],
    ['a fraction', 1.5],
    ['an overflow', Number.MAX_SAFE_INTEGER + 1],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
  ])('refuses to format %s', (_label, seq) => {
    for (const kind of ADMINISTRATION_MASTER_KINDS) {
      expect(() => formatAdministrationMasterCode(kind, seq), kind).toThrow(RangeError);
    }
  });

  it('parses what it formats, back to the same master and number', () => {
    for (const kind of ADMINISTRATION_MASTER_KINDS) {
      for (const seq of [1, 42, 99_999, 100_000, Number.MAX_SAFE_INTEGER]) {
        const code = formatAdministrationMasterCode(kind, seq);
        expect(parseAdministrationMasterCode(code), code).toEqual({ kind, seq });
      }
    }
  });

  it.each([
    ['zero', 'ITM-00000'],
    ['a negative', 'ITM--0001'],
    ['a fraction', 'ITM-00001.5'],
    ['an overflow', 'ITM-99999999999999999999'],
    ['too few digits', 'ITM-1'],
    ['a padding the formatter never writes', 'ITM-000001'],
    ['an unknown prefix', 'ABC-00001'],
    ['lower case', 'itm-00001'],
    ['a supplier code of zero', 'SUP-00000'],
    ['a supplier padding the formatter never writes', 'SUP-000001'],
    ['a lower-case supplier prefix', 'sup-00001'],
    ['a space', 'ITM- 00001'],
    ['nothing after the dash', 'ITM-'],
    ['Arabic-Indic digits', 'ITM-٠٠٠٠١'],
    ['an empty string', ''],
  ])('reads %s as no code', (_label, code) => {
    expect(parseAdministrationMasterCode(code)).toBeNull();
  });
});

describe('the yearly document numbers', () => {
  it('numbers a purchase request «PR-2026-000001»: its year, then six digits (OD-58 A)', () => {
    expect(ADMINISTRATION_DOCUMENT_KINDS).toEqual(['purchaseRequest']);
    expect(ADMINISTRATION_DOCUMENT_PREFIXES).toEqual({ purchaseRequest: 'PR' });
    expect(ADMINISTRATION_DOCUMENT_DIGITS).toBe(6);
    expect(formatAdministrationNumber('purchaseRequest', 2026, 1)).toBe('PR-2026-000001');
    expect(formatAdministrationNumber('purchaseRequest', 2027, 4321)).toBe('PR-2027-004321');
    expect(parseAdministrationNumber('PR-2026-000001')).toEqual({
      kind: 'purchaseRequest',
      year: 2026,
      seq: 1,
    });
  });

  it('grows wider past six digits rather than cutting the number', () => {
    expect(formatAdministrationNumber('purchaseRequest', 2026, 999_999)).toBe('PR-2026-999999');
    expect(formatAdministrationNumber('purchaseRequest', 2026, 1_234_567)).toBe('PR-2026-1234567');
    expect(parseAdministrationNumber('PR-2026-1234567')).toEqual({
      kind: 'purchaseRequest',
      year: 2026,
      seq: 1_234_567,
    });
  });

  it.each([
    ['zero', 0],
    ['a negative', -1],
    ['a fraction', 1.5],
    ['an overflow', Number.MAX_SAFE_INTEGER + 1],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
  ])('refuses to format %s as the sequence', (_label, seq) => {
    expect(() => formatAdministrationNumber('purchaseRequest', 2026, seq)).toThrow(RangeError);
  });

  it.each([
    ['three digits', 999],
    ['five digits', 10_000],
    ['zero', 0],
    ['a negative', -2026],
    ['a fraction', 2026.5],
    ['not a number', Number.NaN],
  ])('refuses to format a year of %s — `{YYYY}` is four digits', (_label, year) => {
    expect(() => formatAdministrationNumber('purchaseRequest', year, 1)).toThrow(RangeError);
  });

  it('parses what it formats, back to the same document, year and number', () => {
    for (const kind of ADMINISTRATION_DOCUMENT_KINDS) {
      for (const year of [1000, 2026, 2027, 9999]) {
        for (const seq of [1, 42, 999_999, 1_000_000, Number.MAX_SAFE_INTEGER]) {
          const number = formatAdministrationNumber(kind, year, seq);
          expect(parseAdministrationNumber(number), number).toEqual({ kind, year, seq });
        }
      }
    }
  });

  it.each([
    ['zero', 'PR-2026-000000'],
    ['a negative', 'PR-2026--00001'],
    ['a fraction', 'PR-2026-000001.5'],
    ['an overflow', 'PR-2026-99999999999999999999'],
    ['too few digits', 'PR-2026-1'],
    ['a padding the formatter never writes', 'PR-2026-0000001'],
    ['a two-digit year', 'PR-26-000001'],
    ['a five-digit year', 'PR-20260-000001'],
    ['a year padded from three digits', 'PR-0999-000001'],
    ['no year', 'PR-000001'],
    ['an unknown prefix', 'PO-2026-000001'],
    ['a master code’s prefix', 'ITM-2026-000001'],
    ['lower case', 'pr-2026-000001'],
    ['a space', 'PR-2026- 000001'],
    ['nothing after the year', 'PR-2026-'],
    ['Arabic-Indic digits', 'PR-٢٠٢٦-٠٠٠٠٠١'],
    ['an empty string', ''],
  ])('reads %s as no number', (_label, value) => {
    expect(parseAdministrationNumber(value)).toBeNull();
  });

  it('never reads a master code as a number, nor a number as a master code', () => {
    expect(parseAdministrationNumber('ITM-00001')).toBeNull();
    expect(parseAdministrationNumber('SUP-00001')).toBeNull();
    expect(parseAdministrationMasterCode('PR-2026-000001')).toBeNull();
  });
});

describe('the people the module names (§7.8)', () => {
  const oid = (n: number): string => n.toString(16).padStart(24, '0');

  it('reads HR’s five employment statuses, `exited` among them', () => {
    expect(ADMINISTRATION_PERSON_STATUSES).toEqual([
      'probation',
      'active',
      'onLeave',
      'suspended',
      'exited',
    ]);
  });

  it('searches by the code or the name, by name first, a page at a time', () => {
    expect(
      ListAdministrationPeopleQuerySchema.parse({ search: ' أحمد ', branchId: oid(1) }),
    ).toEqual({
      search: 'أحمد',
      branchId: oid(1),
      page: 1,
      pageSize: 25,
      sortBy: 'name',
      sortDir: 'asc',
    });
    expect(
      ListAdministrationPeopleQuerySchema.parse({ sortBy: 'code', sortDir: 'desc' }),
    ).toMatchObject({ sortBy: 'code', sortDir: 'desc' });
  });

  it.each([
    ['a status — only the employed are offered to a new reference', { status: 'all' }],
    ['a sort the directory cannot give', { sortBy: 'hiredAt' }],
    ['a branch that is not an id', { branchId: 'cairo' }],
    ['a page past 100', { pageSize: 101 }],
  ])('refuses %s', (_label, query) => {
    expect(ListAdministrationPeopleQuerySchema.safeParse(query).success).toBe(false);
  });

  it('names one person by an id, and nothing else', () => {
    expect(AdministrationPersonIdParamSchema.parse({ employeeId: oid(7) })).toEqual({
      employeeId: oid(7),
    });
    expect(AdministrationPersonIdParamSchema.safeParse({ employeeId: 'E-001' }).success).toBe(
      false,
    );
    expect(
      AdministrationPersonIdParamSchema.safeParse({ employeeId: oid(7), extra: 1 }).success,
    ).toBe(false);
  });
});

describe('the typed attachment list (§11.4)', () => {
  it('holds at most 20 entries, the one bound every list B keeps', () => {
    expect(ADMINISTRATION_MAX_LIST_ATTACHMENTS).toBe(20);
  });
});

describe('what every document shares (P2.2)', () => {
  it('caps a document at 100 lines, Fleet’s supply contract’s bound (design §2.1, Lines)', () => {
    expect(ADMINISTRATION_MAX_DOCUMENT_LINES).toBe(100);
  });

  it('names the one lock a document line puts on an item’s unit so far: a purchase request’s', () => {
    // The detail codes of ADMINISTRATION_ITEM_UNIT_LOCKED, read in this order by the item edit;
    // the receipt, issue and count lines join with their phases.
    expect([...ADMINISTRATION_ITEM_UNIT_LOCKS]).toEqual(['purchaseRequestLine']);
  });
});

describe('the approval chain, its events and its notices (P2.3)', () => {
  const oid = (n: number): string => n.toString(16).padStart(24, '0');

  it('names the three reasons a submission finds nobody to decide it (OD-19 A)', () => {
    // ADMINISTRATION_APPROVAL_CHAIN_MISSING's detail codes, which the web words one by one.
    expect([...ADMINISTRATION_APPROVAL_CHAIN_PROBLEMS]).toEqual([
      'noChain',
      'unstaffed',
      'noEligibleApprover',
    ]);
  });

  it('declares the submission’s event alone — each later name lands with its act (design §8.1)', () => {
    expect(AdministrationEvents).toEqual({
      PurchaseRequestSubmitted: 'administration.purchaseRequest.submitted',
    });
  });

  it('carries ids, the number, the scope, a count and the requester’s ids — no name, no amount', () => {
    const payload = {
      purchaseRequestId: oid(1),
      number: 'PR-2026-000001',
      branchId: oid(2),
      lineCount: 3,
      departmentId: oid(3),
      requesterUserId: oid(4),
      requesterEmployeeId: oid(5),
    };
    expect(AdministrationPurchaseRequestSubmittedPayloadV1.parse(payload)).toEqual(payload);
    expect(Object.keys(AdministrationPurchaseRequestSubmittedPayloadV1.shape).sort()).toEqual(
      Object.keys(payload).sort(),
    );
    // A plain object: a consumer reads it tolerantly, so a later field is additive (design §8.1).
    expect(
      AdministrationPurchaseRequestSubmittedPayloadV1.safeParse({ ...payload, status: 'x' })
        .success,
    ).toBe(true);
    for (const missing of ['number', 'branchId', 'requesterEmployeeId'] as const) {
      const rest: Record<string, unknown> = { ...payload };
      delete rest[missing];
      expect(AdministrationPurchaseRequestSubmittedPayloadV1.safeParse(rest).success, missing).toBe(
        false,
      );
    }
  });

  it('keys the approvers’ notice under the module, one key per notice (phase-2 §11.1)', () => {
    expect(AdministrationTemplates).toEqual({
      PurchaseRequestAwaitingDecision: 'administration.purchaseRequest.awaitingDecision',
    });
  });
});
