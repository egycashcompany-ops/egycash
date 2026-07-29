// Public surface of the secret-store platform service. A module that stores secrets imports the
// SEAM (`getSecretStore`, the `SecretStore`/`SecretRef` types) — never a concrete backend.
export {
  getSecretStore,
  setSecretStore,
  resetSecretStore,
  SecretStoreMismatchError,
  type SecretStore,
  type SecretRef,
  type SecretStoreStatusDto,
} from './secret-store';
export { platformCryptoStore } from './providers/platform-crypto.store';
