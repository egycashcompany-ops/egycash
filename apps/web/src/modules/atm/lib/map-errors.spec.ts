// What a refused zone save tells the person (§8.10).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/lib/api-client';
import { zoneSaveFailure } from './map-errors';

const validation = (code: string, message = 'x'): ApiError =>
  new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [{ field: 'body', code, message }]);

describe('zoneSaveFailure', () => {
  it('a stale revision opens the conflict dialog', () => {
    expect(zoneSaveFailure(new ApiError('ATM_MAP_ZONES_STALE', 'stale', 409))).toEqual({
      kind: 'conflict',
    });
  });

  it('a branch changed in another tab reloads', () => {
    expect(zoneSaveFailure(validation('BRANCH_MISMATCH'))).toEqual({
      kind: 'reload',
      key: 'atm.map.save.error.branchChanged',
    });
  });

  it.each([
    ['DUPLICATE_NAME', 'atm.map.save.error.duplicateName'],
    ['TOO_MANY_ZONES', 'atm.map.save.error.tooManyZones'],
    ['TOO_MANY_POINTS_IN_BRANCH', 'atm.map.save.error.tooManyPoints'],
    ['TOO_MANY_POINTS', 'atm.map.save.error.tooManyPoints'],
    ['SELF_INTERSECTION', 'atm.map.save.error.geometry'],
    ['TOO_FEW_POINTS', 'atm.map.save.error.geometry'],
    ['DUPLICATE_POINT', 'atm.map.save.error.geometry'],
    ['TOO_SMALL', 'atm.map.save.error.geometry'],
  ])('%s → %s', (code, key) => {
    expect(zoneSaveFailure(validation(code))).toEqual({ kind: 'message', key });
  });

  it("reads a schema refinement's code from its message (`CUSTOM`)", () => {
    expect(zoneSaveFailure(validation('CUSTOM', 'TOO_MANY_POINTS_IN_SAVE'))).toEqual({
      kind: 'message',
      key: 'atm.map.save.error.tooManyPoints',
    });
  });

  it('422 asks for a branch, 403 says the key does not reach it', () => {
    expect(zoneSaveFailure(new ApiError('BUSINESS_RULE_VIOLATION', 'x', 422))).toEqual({
      kind: 'message',
      key: 'atm.map.edit.chooseBranch',
    });
    expect(zoneSaveFailure(new ApiError('FORBIDDEN', 'x', 403))).toEqual({
      kind: 'message',
      key: 'atm.map.edit.branchNotEditable',
    });
  });

  it('anything else is left to `errorMessage`', () => {
    expect(zoneSaveFailure(new ApiError('RATE_LIMITED', 'x', 429))).toBeNull();
    expect(zoneSaveFailure(validation('SOMETHING_ELSE'))).toBeNull();
    expect(zoneSaveFailure(new Error('network'))).toBeNull();
  });
});
