// The refiner seam's one promise: a module's reading of the caller applies on that module's routes
// and on no other — not on a route that merely shares the prefix's letters.
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../infrastructure/config/env';
import { type AuthContext } from '../../shared/types';
import {
  clearAuthContextRefiners,
  refineAuthContext,
  registerAuthContextRefiner,
} from './context-refiners';

const ctx: AuthContext = {
  userId: 'u1',
  sessionId: 's1',
  branchId: 'october',
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {},
  permissionVersion: 1,
  isPrivileged: false,
};

const api = (path: string): string => `${env.BASE_PATH}/api/v1${path}`;

afterEach(() => {
  clearAuthContextRefiners();
});

describe('refineAuthContext', () => {
  it('applies a refiner to its prefix and everything under it', async () => {
    registerAuthContextRefiner('/atm', (c) => ({ ...c, branchId: 'mohandessin' }));
    expect((await refineAuthContext(ctx, api('/atm'))).branchId).toBe('mohandessin');
    expect((await refineAuthContext(ctx, api('/atm/machines'))).branchId).toBe('mohandessin');
  });

  // Express routes `/ATM/...` and `//atm/...` to the ATM handlers (its routers ignore case and
  // let a doubled slash through), so the refiner must recognise them too — or a crafted URL would
  // read and write ATM data as the caller's own branch, past the link.
  it('applies to every spelling Express routes to the prefix', async () => {
    registerAuthContextRefiner('/atm', (c) => ({ ...c, branchId: 'mohandessin' }));
    for (const path of [
      api('/ATM/machines'),
      api('/Atm/Machines/'),
      `${env.BASE_PATH}/API/V1/atm/machines`,
      `${env.BASE_PATH}/api/v1//atm/machines`,
      `${env.BASE_PATH}//api/v1/atm//machines`,
    ]) {
      expect((await refineAuthContext(ctx, path)).branchId, path).toBe('mohandessin');
    }
    expect(await refineAuthContext(ctx, api('/ATMX/machines'))).toBe(ctx);
  });

  it('leaves every other route with the context as built', async () => {
    registerAuthContextRefiner('/atm', (c) => ({ ...c, branchId: 'mohandessin' }));
    expect(await refineAuthContext(ctx, api('/platform/users'))).toBe(ctx);
    expect(await refineAuthContext(ctx, api('/atmx/machines'))).toBe(ctx);
    expect(await refineAuthContext(ctx, '/atm/machines')).toBe(ctx);
  });

  it('awaits an async refiner, and the last registration for a prefix wins', async () => {
    registerAuthContextRefiner('/atm', (c) => ({ ...c, branchId: 'first' }));
    registerAuthContextRefiner('/atm', async (c) => Promise.resolve({ ...c, branchId: 'second' }));
    expect((await refineAuthContext(ctx, api('/atm/machines'))).branchId).toBe('second');
  });

  it('is the context itself while nothing is registered', async () => {
    expect(await refineAuthContext(ctx, api('/atm/machines'))).toBe(ctx);
  });
});
