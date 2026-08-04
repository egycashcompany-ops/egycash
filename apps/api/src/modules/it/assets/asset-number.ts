// Asset code formatting (design §2.1): `AST-00001` — global, monotonic, permanent, never reused.
// Pure; the atomic allocation lives in asset-sequence.ts.

export const ASSET_SEQUENCE_KEY = 'asset:global';

/** Width the code pads to; larger sequences simply grow wider — the format never truncates. */
export const ASSET_CODE_MIN_DIGITS = 5;

export const formatAssetCode = (seq: number): string =>
  `AST-${String(seq).padStart(ASSET_CODE_MIN_DIGITS, '0')}`;
