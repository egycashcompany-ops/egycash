// D3 / DEC-7 / DEC-29 / DEC-33 — the register's secret rules, without a database: the sealing
// context, the redacted audit diff, the ONE visibility predicate on every scope shape, and the
// rotation sweep against a fake store.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DataScope, type SecretRef } from '@ecms/contracts';
import { type AuthContext } from '../../../shared/types';

const mocks = vi.hoisted(() => ({
  store: {
    available: vi.fn(() => true),
    status: vi.fn(),
    seal: vi.fn(),
    open: vi.fn(),
    rewrap: vi.fn(),
  },
  listCombinationsNotOnKey: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock('../../../platform/secrets', () => ({ getSecretStore: () => mocks.store }));
vi.mock('./register.repository', () => ({
  atmRegisterEntryRepository: { listCombinationsNotOnKey: mocks.listCombinationsNotOnKey },
}));
vi.mock('./register.model', () => ({
  AtmRegisterEntryModel: {
    updateOne: (...args: unknown[]) => ({ exec: () => mocks.updateOne(...args) as unknown }),
  },
}));

const {
  combinationContext,
  keyCoversEntry,
  redactedDiff,
  rotateRegisterCombinationKeys,
  secretsVisibleFor,
} = await import('./register-secrets');

const ALEX = new Types.ObjectId().toHexString();
const TANTA = new Types.ObjectId().toHexString();
const DEPT_ALEX = new Types.ObjectId().toHexString();

const ctxWith = (scope: DataScope | undefined, over: Partial<AuthContext> = {}): AuthContext => ({
  userId: new Types.ObjectId().toHexString(),
  sessionId: 's',
  branchId: ALEX,
  departmentId: DEPT_ALEX,
  sectionId: new Types.ObjectId().toHexString(),
  locale: 'en',
  permissions: scope === undefined ? {} : { 'atmRegister.viewSecrets': scope },
  permissionVersion: 1,
  isPrivileged: false,
  ...over,
});

const ref = (keyId: string): SecretRef => ({ provider: 'platformCrypto', keyId, ref: { keyId } });

describe('the sealing context', () => {
  it('names the collection, the record and the field', () => {
    expect(combinationContext('66a1b2c3d4e5f60718293a4b')).toBe(
      'atm_register_entries:66a1b2c3d4e5f60718293a4b:safeCombination',
    );
  });
});

describe('redactedDiff', () => {
  it('writes K paths and the combination as facts, never values', () => {
    const changes = redactedDiff(
      { 'keys.supervisorCode': null, receiptNotes: 'old note', safeCombination: null, name: 'A' },
      {
        'keys.supervisorCode': 'K-TEST-1',
        receiptNotes: 'new note',
        safeCombination: ref('a'),
        name: 'B',
      },
    );
    expect(changes).toEqual([
      { field: 'keys.supervisorCode', old: null, new: '[redacted]' },
      { field: 'receiptNotes', old: '[redacted]', new: '[redacted]' },
      { field: 'safeCombination', old: null, new: '[redacted]' },
      { field: 'name', old: 'A', new: 'B' },
    ]);
    expect(JSON.stringify(changes)).not.toContain('K-TEST-1');
    expect(JSON.stringify(changes)).not.toContain('note');
  });

  it('writes null for a cleared secret and omits an unchanged one', () => {
    expect(
      redactedDiff(
        { handoverNotes: 'x', 'keys.alanki': 'same', safeCombination: ref('a') },
        { handoverNotes: null, 'keys.alanki': 'same', safeCombination: null },
      ),
    ).toEqual([
      { field: 'handoverNotes', old: '[redacted]', new: null },
      { field: 'safeCombination', old: '[redacted]', new: null },
    ]);
  });
});

describe('keyCoversEntry / secretsVisibleFor (DEC-29)', () => {
  const alexEntry = { branchId: ALEX };
  const tantaEntry = { branchId: TANTA };
  const noBranch = { branchId: null };

  it('organization covers every entry, a branch-less one included', () => {
    const ctx = ctxWith('organization');
    expect(secretsVisibleFor(ctx, alexEntry)).toBe(true);
    expect(secretsVisibleFor(ctx, noBranch)).toBe(true);
  });

  it('branch scope covers its home branch only', () => {
    const ctx = ctxWith('branch');
    expect(secretsVisibleFor(ctx, alexEntry)).toBe(true);
    expect(secretsVisibleFor(ctx, tantaEntry)).toBe(false);
    expect(secretsVisibleFor(ctx, noBranch)).toBe(false);
  });

  it('a branch reach covers the branches it names', () => {
    const ctx = ctxWith('branch', {
      keyReach: { 'atmRegister.viewSecrets': { branchIds: [ALEX, TANTA], departments: [] } },
    });
    expect(secretsVisibleFor(ctx, tantaEntry)).toBe(true);
  });

  it('department (home only, or with a reach), section and own cover NOTHING', () => {
    expect(secretsVisibleFor(ctxWith('department'), alexEntry)).toBe(false);
    expect(
      secretsVisibleFor(
        ctxWith('department', {
          keyReach: {
            'atmRegister.viewSecrets': {
              branchIds: [],
              departments: [{ id: DEPT_ALEX, branchId: ALEX }],
            },
          },
        }),
        alexEntry,
      ),
    ).toBe(false);
    expect(secretsVisibleFor(ctxWith('section'), alexEntry)).toBe(false);
    expect(secretsVisibleFor(ctxWith('own'), alexEntry)).toBe(false);
  });

  it('without the key nothing is covered', () => {
    expect(secretsVisibleFor(ctxWith(undefined), alexEntry)).toBe(false);
  });

  it('is asked per key — another key reaching the branch does not count', () => {
    const ctx = ctxWith(undefined, { permissions: { 'atmRegister.edit': 'organization' } });
    expect(keyCoversEntry(ctx, 'atmRegister.edit', tantaEntry)).toBe(true);
    expect(secretsVisibleFor(ctx, tantaEntry)).toBe(false);
  });
});

describe('rotateRegisterCombinationKeys (DEC-33)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when the store does not drive rotation', async () => {
    mocks.store.status.mockReturnValue({
      provider: 'kms',
      available: true,
      currentKeyId: 'b',
      rotatable: false,
    });
    expect(await rotateRegisterCombinationKeys()).toEqual({ rotated: 0, failed: 0 });
    expect(mocks.listCombinationsNotOnKey).not.toHaveBeenCalled();
  });

  it('rewraps only refs not on the current key, and counts a lost version race', async () => {
    mocks.store.status.mockReturnValue({
      provider: 'platformCrypto',
      available: true,
      currentKeyId: 'b',
      rotatable: true,
    });
    const first = { _id: new Types.ObjectId(), __v: 3, safeCombination: ref('a') };
    const raced = { _id: new Types.ObjectId(), __v: 1, safeCombination: ref('a') };
    mocks.listCombinationsNotOnKey.mockResolvedValue([first, raced]);
    mocks.store.rewrap.mockImplementation((r: SecretRef) => Promise.resolve({ ...r, keyId: 'b' }));
    mocks.updateOne
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 0 });

    expect(await rotateRegisterCombinationKeys(50)).toEqual({ rotated: 1, failed: 1 });
    expect(mocks.listCombinationsNotOnKey).toHaveBeenCalledWith('b', 50);
    // Versioned, and raw over deleted rows too: the filter is id + __v and nothing else.
    expect(mocks.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: first._id, __v: 3 },
      { $set: { safeCombination: { ...first.safeCombination, keyId: 'b' } }, $inc: { __v: 1 } },
    );
  });

  it('counts a ref whose key already left the ring instead of stopping the sweep', async () => {
    mocks.store.status.mockReturnValue({
      provider: 'platformCrypto',
      available: true,
      currentKeyId: 'b',
      rotatable: true,
    });
    mocks.listCombinationsNotOnKey.mockResolvedValue([
      { _id: new Types.ObjectId(), __v: 0, safeCombination: ref('gone') },
      { _id: new Types.ObjectId(), __v: 0, safeCombination: ref('a') },
    ]);
    mocks.store.rewrap
      .mockRejectedValueOnce(new Error('key not in ring'))
      .mockImplementationOnce((r: SecretRef) => Promise.resolve({ ...r, keyId: 'b' }));
    mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
    expect(await rotateRegisterCombinationKeys()).toEqual({ rotated: 1, failed: 1 });
  });
});
