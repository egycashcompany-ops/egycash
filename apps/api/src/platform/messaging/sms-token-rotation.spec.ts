// The SMS token's share of the nightly re-wrap, against a stubbed collection and store: only a
// token on a retired key is touched, the write is versioned (a save meanwhile wins), a failure is
// a count rather than a throw, and the next send reads the re-wrapped ref.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chain = <T>(result: T) => {
  const query = { lean: vi.fn(() => query), exec: vi.fn(async () => result) };
  return query;
};

const model = vi.hoisted(() => ({ findOne: vi.fn(), updateOne: vi.fn() }));
const store = vi.hoisted(() => ({ status: vi.fn(), rewrap: vi.fn() }));
const cache = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock('./messaging-config.model', () => ({
  MESSAGING_CONFIG_KEY: 'default',
  MessagingConfigModel: model,
}));
vi.mock('../secrets', () => ({ getSecretStore: () => store }));
vi.mock('./messaging-config.store', () => ({ invalidateMessagingConfig: cache.invalidate }));

const { rotateSmsTokenKey } = await import('./sms-token-rotation');

const ID = new Types.ObjectId();
const OLD = { provider: 'platformCrypto', keyId: 'a', ref: { sealed: 'old' } };
const NEW = { provider: 'platformCrypto', keyId: 'b', ref: { sealed: 'new' } };

beforeEach(() => {
  vi.clearAllMocks();
  store.status.mockReturnValue({
    provider: 'platformCrypto',
    available: true,
    rotatable: true,
    currentKeyId: 'b',
  });
  store.rewrap.mockResolvedValue(NEW);
  model.findOne.mockReturnValue(chain({ _id: ID, __v: 4, sms: { tokenRef: OLD } }));
  model.updateOne.mockReturnValue(chain({ modifiedCount: 1 }));
});

describe('rotateSmsTokenKey', () => {
  it('looks only for a token on a key other than the current one', async () => {
    await rotateSmsTokenKey();
    expect(model.findOne).toHaveBeenCalledWith({
      key: 'default',
      isDeleted: false,
      'sms.tokenRef': { $ne: null },
      'sms.tokenRef.keyId': { $ne: 'b' },
    });
  });

  it('re-wraps it under the version it read, and drops the cached settings', async () => {
    expect(await rotateSmsTokenKey()).toEqual({ rotated: 1, failed: 0 });
    expect(store.rewrap).toHaveBeenCalledWith(OLD);
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: ID, __v: 4 },
      { $set: { 'sms.tokenRef': NEW }, $inc: { __v: 1 } },
      { timestamps: false },
    );
    expect(cache.invalidate).toHaveBeenCalled();
  });

  it('lets a save that replaced the token meanwhile win', async () => {
    model.updateOne.mockReturnValue(chain({ modifiedCount: 0 }));
    expect(await rotateSmsTokenKey()).toEqual({ rotated: 0, failed: 1 });
  });

  it('counts a ref on a key already gone, never throws', async () => {
    store.rewrap.mockRejectedValue(new Error('key a is gone'));
    expect(await rotateSmsTokenKey()).toEqual({ rotated: 0, failed: 1 });
  });

  it('does nothing when there is nothing stale, or nothing ECMS rotates', async () => {
    model.findOne.mockReturnValue(chain(null));
    expect(await rotateSmsTokenKey()).toEqual({ rotated: 0, failed: 0 });
    store.status.mockReturnValue({
      provider: 'vault',
      available: true,
      rotatable: false,
      currentKeyId: null,
    });
    expect(await rotateSmsTokenKey()).toEqual({ rotated: 0, failed: 0 });
    expect(store.rewrap).not.toHaveBeenCalled();
  });
});
