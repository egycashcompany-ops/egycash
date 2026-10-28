// The mailbox secret's share of the nightly re-wrap (docs/02-architecture/platform-crypto.md: a
// retired key is dropped only once every sweep stops finding values on it — a secret no sweep
// knows about would be stranded, and the reader would stop until somebody typed it again).
//
// The register sweep's rules (register/register-secrets.ts): the DATA KEY only, no plaintext at any
// point; versioned, so a save that replaced the secret meanwhile wins; a ref on a key already gone
// is a count, never a throw. The version moves, which is also what makes every process rebuild its
// cached source (mailbox-source.ts) instead of holding the old ref until the key is gone.
import { logger } from '../../../infrastructure/logging/logger';
import { getSecretStore } from '../../../platform/secrets';
import {
  ATM_MAILBOX_KEY,
  AtmMailboxConfigModel,
  type AtmMailboxConfigDoc,
} from './mailbox-config.model';

export const rotateMailboxSecretKey = async (): Promise<{ rotated: number; failed: number }> => {
  const store = getSecretStore();
  const status = store.status();
  if (!status.available || !status.rotatable || status.currentKeyId === null) {
    return { rotated: 0, failed: 0 };
  }
  const doc = await AtmMailboxConfigModel.findOne({
    key: ATM_MAILBOX_KEY,
    isDeleted: false,
    clientSecretRef: { $ne: null },
    'clientSecretRef.keyId': { $ne: status.currentKeyId },
  })
    .lean<AtmMailboxConfigDoc>()
    .exec();
  const stale = doc?.clientSecretRef ?? null;
  if (doc === null || stale === null) return { rotated: 0, failed: 0 };

  let rotated = 0;
  let failed = 0;
  try {
    const ref = await store.rewrap(stale);
    const result = await AtmMailboxConfigModel.updateOne(
      { _id: doc._id, __v: doc.__v },
      { $set: { clientSecretRef: ref }, $inc: { __v: 1 } },
      { timestamps: false },
    ).exec();
    if (result.modifiedCount === 1) rotated = 1;
    else failed = 1;
  } catch {
    failed = 1;
  }
  logger.info(
    { provider: status.provider, currentKeyId: status.currentKeyId, rotated, failed },
    'atm: mailbox secret key rotation pass',
  );
  return { rotated, failed };
};
