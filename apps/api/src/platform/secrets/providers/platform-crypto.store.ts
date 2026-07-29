// The default secret store: envelope encryption with an env-supplied master key (A-1).
//
// This is the ONE place that knows a `SecretRef.ref` is a `SealedValue`. Everything else — the
// credential service, its model, the rotation sweep — sees only the opaque ref, which is what lets
// a KMS- or vault-backed store replace this file without touching them.
import {
  SealedValueSchema,
  type SealedValue,
  type SecretRef,
  type SecretStoreStatusDto,
} from '@ecms/contracts';
import { cryptoService } from '../../crypto';
import { SecretStoreMismatchError, type SecretStore } from '../secret-store';

const PROVIDER_ID = 'platformCrypto';

/** Pull the SealedValue back out of an opaque ref, refusing one this store did not produce. */
const sealedFrom = (ref: SecretRef): SealedValue => {
  if (ref.provider !== PROVIDER_ID) {
    throw new SecretStoreMismatchError(PROVIDER_ID, ref.provider);
  }
  return SealedValueSchema.parse(ref.ref);
};

const wrap = (sealed: SealedValue): SecretRef => ({
  provider: PROVIDER_ID,
  keyId: sealed.keyId,
  ref: sealed,
});

export const platformCryptoStore: SecretStore = {
  providerId: PROVIDER_ID,

  available: () => cryptoService.available(),

  status(): SecretStoreStatusDto {
    const status = cryptoService.status();
    return {
      provider: PROVIDER_ID,
      available: status.available,
      currentKeyId: status.available ? status.activeKeyId : null,
      // ECMS holds the master key, so ECMS drives rotation — unlike a KMS that rotates itself.
      rotatable: true,
    };
  },

  // `async` rather than `Promise.resolve(...)` on purpose: the crypto primitive throws
  // SYNCHRONOUSLY (wrong context, missing key), and `Promise.resolve(throwingCall())` throws before
  // the promise exists — so `.catch()` never fires. `async` turns every throw into a rejection,
  // which is the contract every caller awaits. (The same trap A-0's provider hit.)
  async seal(plaintext, context) {
    return wrap(cryptoService.seal(plaintext, context));
  },

  async open(ref, context) {
    return cryptoService.open(sealedFrom(ref), context);
  },

  async rewrap(ref) {
    return wrap(cryptoService.rewrap(sealedFrom(ref)));
  },
};
