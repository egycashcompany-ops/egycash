// Public surface of the platform crypto service — nothing else is importable (ADR-003).
export {
  cryptoService,
  CryptoUnavailableError,
  DecryptionError,
} from './crypto.service';
