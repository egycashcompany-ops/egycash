// The ATM Operations reference-label contract, pinned where the bank catalog (DEC-35) and the
// bilingual areas (DEC-38) changed it: a label body is EITHER the legacy `{ name }` — so an older
// screen keeps working through a rolling deploy — OR the dialog's Arabic + English pair; never
// neither. Rules that depend on the kind (a spelling needs an active bank, an area from a dialog
// needs both names) are the service's and are tested there.
//
// Every value below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  ATM_BANK_CODE_PATTERN,
  ATM_MACHINE_BULK_REFUSALS,
  ATM_MACHINE_REGISTER_ACTIONS,
  ATM_MACHINE_REGISTER_REASONS,
  ATM_REF_LABEL_KINDS,
  ATM_REF_LABEL_ORIGINS,
  AtmRefLabelOptionsQuerySchema,
  CreateAtmRefLabelSchema,
  ListAtmRefLabelsQuerySchema,
  UpdateAtmRefLabelSchema,
} from './atm.js';
import { AtmBankCodeSchema } from './atm-register.js';

const BRANCH_ID = '650000000000000000000101';

describe('CreateAtmRefLabelSchema', () => {
  it('still accepts the legacy `{ name }`, trimmed', () => {
    expect(CreateAtmRefLabelSchema.parse({ name: '  NBE FOREX ' })).toEqual({ name: 'NBE FOREX' });
  });

  it('accepts the dialog’s Arabic + English pair without a `name`', () => {
    expect(
      CreateAtmRefLabelSchema.parse({ nameAr: ' المهندسين ', nameEn: ' MOHNDESSEN ' }),
    ).toEqual({ nameAr: 'المهندسين', nameEn: 'MOHNDESSEN' });
  });

  it('refuses a body with neither a name nor both display names', () => {
    for (const body of [
      {},
      { nameAr: 'المهندسين' },
      { nameEn: 'MOHNDESSEN' },
      { branchId: BRANCH_ID },
    ]) {
      const parsed = CreateAtmRefLabelSchema.safeParse(body);
      expect(parsed.success, JSON.stringify(body)).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['name']);
    }
  });

  it('treats a blank name as missing, not as a label', () => {
    expect(CreateAtmRefLabelSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateAtmRefLabelSchema.safeParse({ nameAr: ' ', nameEn: 'ALEX' }).success).toBe(false);
  });

  it('takes a spelling’s bank, upper-cased, in the catalog code’s shape', () => {
    expect(CreateAtmRefLabelSchema.parse({ name: 'NBE FOREX', bankCode: ' nbe ' })).toEqual({
      name: 'NBE FOREX',
      bankCode: 'NBE',
    });
    expect(CreateAtmRefLabelSchema.safeParse({ name: 'X', bankCode: 'N' }).success).toBe(false);
    expect(CreateAtmRefLabelSchema.safeParse({ name: 'X', bankCode: 'NBE FOREX' }).success).toBe(
      false,
    );
  });

  it('names the branch to file it in, or leaves it to the acting branch', () => {
    expect(CreateAtmRefLabelSchema.parse({ name: 'ALEX', branchId: BRANCH_ID }).branchId).toBe(
      BRANCH_ID,
    );
    expect(CreateAtmRefLabelSchema.parse({ name: 'ALEX' })).not.toHaveProperty('branchId');
    expect(CreateAtmRefLabelSchema.safeParse({ name: 'ALEX', branchId: 'x' }).success).toBe(false);
  });

  it('is strict: the kind, origin and former names are not input', () => {
    for (const extra of [{ kind: 'area' }, { origin: 'manual' }, { formerNames: [] }]) {
      expect(CreateAtmRefLabelSchema.safeParse({ name: 'ALEX', ...extra }).success).toBe(false);
    }
  });
});

describe('UpdateAtmRefLabelSchema', () => {
  it('keeps an absent display name, and clears it on blank or null', () => {
    expect(UpdateAtmRefLabelSchema.parse({ version: 1 })).toEqual({ version: 1 });
    expect(UpdateAtmRefLabelSchema.parse({ version: 1, nameAr: '  ', nameEn: null })).toEqual({
      version: 1,
      nameAr: null,
      nameEn: null,
    });
    expect(UpdateAtmRefLabelSchema.parse({ version: 1, nameEn: ' Alex ' })).toEqual({
      version: 1,
      nameEn: 'Alex',
    });
  });

  it('maps, re-maps or un-maps a spelling', () => {
    expect(UpdateAtmRefLabelSchema.parse({ version: 1, bankCode: 'qnb' }).bankCode).toBe('QNB');
    expect(UpdateAtmRefLabelSchema.parse({ version: 1, bankCode: null }).bankCode).toBeNull();
    expect(UpdateAtmRefLabelSchema.safeParse({ version: 1, bankCode: '' }).success).toBe(false);
  });

  it('still renames and archives, and needs a version', () => {
    expect(
      UpdateAtmRefLabelSchema.parse({ version: 2, name: 'ALEXANDRIA', isActive: false }),
    ).toEqual({ version: 2, name: 'ALEXANDRIA', isActive: false });
    expect(UpdateAtmRefLabelSchema.safeParse({ name: 'ALEX' }).success).toBe(false);
    expect(UpdateAtmRefLabelSchema.safeParse({ version: 2, formerNames: [] }).success).toBe(false);
  });
});

describe('the label queries', () => {
  it('lists may narrow to one branch', () => {
    expect(ListAtmRefLabelsQuerySchema.parse({ branchId: BRANCH_ID }).branchId).toBe(BRANCH_ID);
    expect(ListAtmRefLabelsQuerySchema.safeParse({ branchId: 'nope' }).success).toBe(false);
  });

  it('options take an optional branch and nothing else', () => {
    expect(AtmRefLabelOptionsQuerySchema.parse({})).toEqual({});
    expect(AtmRefLabelOptionsQuerySchema.parse({ branchId: BRANCH_ID })).toEqual({
      branchId: BRANCH_ID,
    });
    expect(AtmRefLabelOptionsQuerySchema.safeParse({ kind: 'bank' }).success).toBe(false);
  });
});

describe('the vocabularies the next layers switch on', () => {
  it('names the label kinds and origins', () => {
    expect(ATM_REF_LABEL_KINDS).toEqual(['bank', 'area']);
    expect(ATM_REF_LABEL_ORIGINS).toEqual(['manual', 'backfill', 'register', 'machine', 'import']);
  });

  it('names what a data-edit add did in the register (DEC-36)', () => {
    expect(ATM_MACHINE_REGISTER_ACTIONS).toEqual([
      'created',
      'received',
      'linked',
      'existing',
      'none',
    ]);
    expect(ATM_MACHINE_REGISTER_REASONS).toEqual(['branchUnmapped', 'placeholderCode', 'noBank']);
    expect(ATM_MACHINE_BULK_REFUSALS).toEqual(['activeElsewhere', 'openElsewhere']);
  });

  it('shares one bank code shape between the label schemas and the register', () => {
    for (const code of ['QNB', 'NBE', 'AAIB1', 'qnb', 'Q', 'TOOLONGCODE']) {
      expect(AtmBankCodeSchema.safeParse(code).success, code).toBe(
        ATM_BANK_CODE_PATTERN.test(code),
      );
    }
  });
});
