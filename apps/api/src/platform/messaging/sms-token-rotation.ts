// The SMS token's share of the nightly re-wrap (docs/02-architecture/platform-crypto.md: a retired
// key is dropped only once every sweep stops finding values on it — a token no sweep knows about
// would be stranded, and every SMS would fail until somebody typed it again).
//
// The ATM mailbox sweep's rules (atm/mail-tickets/mailbox-secret-rotation.ts): the DATA KEY only,
// no plaintext at any point; versioned, so a save that replaced the token meanwhile wins; a ref on
// a key already gone is a count, never a throw. The version moves, and this process's cached
// settings are dropped, so the next send opens the new ref instead of holding the old one.
import { logger } from '../../infrastructure/logging/logger';
import { getSecretStore } from '../secrets';
import {
  MESSAGING_CONFIG_KEY,
  MessagingConfigModel,
  type MessagingConfigDoc,
} from './messaging-config.model';
import { invalidateMessagingConfig } from './messaging-config.store';

export const rotateSmsTokenKey = async (): Promise<{ rotated: number; failed: number }> => {
  const store = getSecretStore();
  const status = store.status();
  if (!status.available || !status.rotatable || status.currentKeyId === null) {
    return { rotated: 0, failed: 0 };
  }
  const doc = await MessagingConfigModel.findOne({
    key: MESSAGING_CONFIG_KEY,
    isDeleted: false,
    'sms.tokenRef': { $ne: null },
    'sms.tokenRef.keyId': { $ne: status.currentKeyId },
  })
    .lean<MessagingConfigDoc>()
    .exec();
  const stale = doc?.sms.tokenRef ?? null;
  if (doc === null || stale === null) return { rotated: 0, failed: 0 };

  let rotated = 0;
  let failed = 0;
  try {
    const ref = await store.rewrap(stale);
    const result = await MessagingConfigModel.updateOne(
      { _id: doc._id, __v: doc.__v },
      { $set: { 'sms.tokenRef': ref }, $inc: { __v: 1 } },
      { timestamps: false },
    ).exec();
    if (result.modifiedCount === 1) rotated = 1;
    else failed = 1;
  } catch {
    failed = 1;
  }
  invalidateMessagingConfig();
  logger.info(
    { provider: status.provider, currentKeyId: status.currentKeyId, rotated, failed },
    'platform: sms token key rotation pass',
  );
  return { rotated, failed };
};
