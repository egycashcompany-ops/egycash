import { describe, expect, it } from 'vitest';
import { ASSET_CODE_MIN_DIGITS, formatAssetCode } from './asset-number';

describe('formatAssetCode', () => {
  it('pads to the minimum width', () => {
    expect(formatAssetCode(1)).toBe('AST-00001');
    expect(formatAssetCode(42)).toBe('AST-00042');
  });

  it('grows past the width instead of truncating', () => {
    expect(formatAssetCode(123456)).toBe('AST-123456');
  });

  it('keeps the documented width', () => {
    expect(ASSET_CODE_MIN_DIGITS).toBe(5);
  });
});
