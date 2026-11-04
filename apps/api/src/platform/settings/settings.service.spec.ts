// `GET /platform/settings/me` reads every declared setting for the caller. It used to ask the
// database once per declaration — fifty-seven sequential round trips — and now asks once. These
// tests hold the one-query read to the answer the per-key read gives, setting by setting: the same
// value and the same scope it came from, for user, branch and organization overrides, a scope a
// declaration does not allow, and stored values that no longer parse.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ResolvedSettingDto, SettingScope } from '@ecms/contracts';
import { clearSettingRegistry, declareSetting, listSettingDeclarations } from './settings.registry';
import type { SettingDeclaration } from './settings.registry';

interface Row {
  key: string;
  scope: SettingScope;
  scopeRef: Types.ObjectId | null;
  value: unknown;
}

interface Filter {
  key: string | { $in: string[] };
  $or: { scope: SettingScope; scopeRef: Types.ObjectId | null }[];
}

const stored: Row[] = [];
const queries: Filter[] = [];

/** `scopeRef: null` matches a null reference, as Mongo's equality does; an id matches its own id. */
const sameRef = (wanted: Types.ObjectId | null, actual: Types.ObjectId | null): boolean =>
  wanted === null ? actual === null : actual !== null && String(wanted) === String(actual);

const matches = (row: Row, filter: Filter): boolean =>
  (typeof filter.key === 'string' ? row.key === filter.key : filter.key.$in.includes(row.key)) &&
  filter.$or.some((c) => c.scope === row.scope && sameRef(c.scopeRef, row.scopeRef));

vi.mock('./setting-value.model', () => ({
  SettingValueModel: {
    find: (filter: Filter) => {
      queries.push(filter);
      // Newest first, the opposite of how they were stored: the answer must not hang on order.
      const found = stored.filter((row) => matches(row, filter)).reverse();
      return { lean: () => ({ exec: async () => found }) };
    },
  },
}));

// Always a miss, so every per-key read below really reaches the store instead of an earlier answer.
vi.mock('../../infrastructure/redis/cache', () => ({
  getCache: () => ({
    get: async () => null,
    set: async () => undefined,
    delByPrefix: async () => undefined,
  }),
}));

const { settingsService } = await import('./settings.service');

/** The per-key read `resolve()` caches — private, so reached past the type for the comparison. */
const resolveOne = (
  declaration: SettingDeclaration,
  subject: { userId: string | null; branchId: string | null },
): Promise<{ value: unknown; resolvedFrom: SettingScope | 'default' }> =>
  (
    settingsService as unknown as {
      resolveUncached: (
        d: SettingDeclaration,
        s: { userId: string | null; branchId: string | null },
      ) => Promise<{ value: unknown; resolvedFrom: SettingScope | 'default' }>;
    }
  ).resolveUncached(declaration, subject);

const USER = new Types.ObjectId();
const USER_WITH_A_BROKEN_VALUE = new Types.ObjectId();
const OTHER_USER = new Types.ObjectId();
const BRANCH = new Types.ObjectId();
const OTHER_BRANCH = new Types.ObjectId();

const KEYS = {
  everywhere: 'test.everywhere',
  organizationOnly: 'test.organizationOnly',
  branchOrOrganization: 'test.branchOrOrganization',
  userOnly: 'test.userOnly',
  list: 'test.list',
  untouched: 'test.untouched',
} as const;

const declareAll = (): void => {
  declareSetting({
    key: KEYS.everywhere,
    description: 'overridable at every level',
    schema: z.number().int().min(1),
    defaultValue: 1,
    allowedScopes: ['organization', 'branch', 'user'],
  });
  declareSetting({
    key: KEYS.organizationOnly,
    description: 'organization level only',
    schema: z.string().min(1),
    defaultValue: 'default',
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: KEYS.branchOrOrganization,
    description: 'branch or organization',
    schema: z.boolean(),
    defaultValue: false,
    allowedScopes: ['organization', 'branch'],
  });
  declareSetting({
    key: KEYS.userOnly,
    description: 'a personal preference only',
    schema: z.enum(['compact', 'comfortable']),
    defaultValue: 'comfortable',
    allowedScopes: ['user'],
  });
  declareSetting({
    key: KEYS.list,
    description: 'a list',
    schema: z.array(z.string()).min(1),
    defaultValue: ['email'],
    allowedScopes: ['organization', 'user'],
  });
  declareSetting({
    key: KEYS.untouched,
    description: 'nobody ever set this',
    schema: z.number(),
    defaultValue: 42,
    allowedScopes: ['organization', 'branch', 'user'],
  });
};

const row = (
  key: string,
  scope: SettingScope,
  scopeRef: Types.ObjectId | null,
  value: unknown,
): Row => ({ key, scope, scopeRef, value });

const seed = (): void => {
  stored.push(
    row(KEYS.everywhere, 'organization', null, 5),
    row(KEYS.everywhere, 'branch', BRANCH, 7),
    row(KEYS.everywhere, 'user', USER, 9),
    // No longer an integer ≥ 1: skipped, and the branch's value answers instead.
    row(KEYS.everywhere, 'user', USER_WITH_A_BROKEN_VALUE, 0),
    row(KEYS.everywhere, 'branch', OTHER_BRANCH, 'seven'),
    row(KEYS.organizationOnly, 'organization', null, 'company'),
    // A scope this declaration does not allow — a stray row is never read.
    row(KEYS.organizationOnly, 'branch', BRANCH, 'branch says otherwise'),
    row(KEYS.organizationOnly, 'user', USER, 'user says otherwise'),
    row(KEYS.branchOrOrganization, 'organization', null, true),
    row(KEYS.branchOrOrganization, 'branch', BRANCH, 'not a boolean'),
    row(KEYS.branchOrOrganization, 'branch', OTHER_BRANCH, false),
    row(KEYS.userOnly, 'user', USER, 'compact'),
    row(KEYS.userOnly, 'organization', null, 'compact'),
    row(KEYS.list, 'organization', null, []),
    row(KEYS.list, 'user', USER, ['sms', 'push']),
  );
};

const SUBJECTS = {
  'a user in a branch': { userId: String(USER), branchId: String(BRANCH) },
  'a user whose own value is broken': {
    userId: String(USER_WITH_A_BROKEN_VALUE),
    branchId: String(BRANCH),
  },
  'a user in a branch whose values are broken': {
    userId: String(OTHER_USER),
    branchId: String(OTHER_BRANCH),
  },
  'a user with no branch': { userId: String(OTHER_USER), branchId: null },
  'no one (a scheduled job)': { userId: null, branchId: null },
} as const;

beforeEach(() => {
  clearSettingRegistry();
  stored.length = 0;
  queries.length = 0;
  declareAll();
  seed();
});
afterEach(() => {
  clearSettingRegistry();
});

describe('resolveAll — every setting in one read', () => {
  it.each(Object.entries(SUBJECTS))(
    'answers %s exactly as the per-key read does',
    async (_name, subject) => {
      const all = await settingsService.resolveAll(subject);

      const perKey: ResolvedSettingDto[] = [];
      for (const declaration of listSettingDeclarations()) {
        const one = await resolveOne(declaration, subject);
        perKey.push({ key: declaration.key, value: one.value, resolvedFrom: one.resolvedFrom });
        // And the cached public read agrees on the value.
        expect(await settingsService.resolve(declaration.key, subject)).toEqual(one.value);
      }
      expect(all).toEqual(perKey);
    },
  );

  it('asks the database once, whatever the number of settings', async () => {
    await settingsService.resolveAll(SUBJECTS['a user in a branch']);

    expect(queries).toHaveLength(1);
    expect(queries[0]?.key).toEqual({ $in: Object.values(KEYS) });
    expect(queries[0]?.$or.map((c) => c.scope).sort()).toEqual(['branch', 'organization', 'user']);
  });

  it('takes the most specific value that still parses, else the default', async () => {
    const byKey = (dtos: ResolvedSettingDto[]) =>
      Object.fromEntries(dtos.map((d) => [d.key, { value: d.value, from: d.resolvedFrom }]));

    expect(byKey(await settingsService.resolveAll(SUBJECTS['a user in a branch']))).toEqual({
      [KEYS.everywhere]: { value: 9, from: 'user' },
      [KEYS.organizationOnly]: { value: 'company', from: 'organization' },
      [KEYS.branchOrOrganization]: { value: true, from: 'organization' },
      [KEYS.userOnly]: { value: 'compact', from: 'user' },
      [KEYS.list]: { value: ['sms', 'push'], from: 'user' },
      [KEYS.untouched]: { value: 42, from: 'default' },
    });
    expect(
      byKey(await settingsService.resolveAll(SUBJECTS['a user whose own value is broken'])),
    ).toMatchObject({ [KEYS.everywhere]: { value: 7, from: 'branch' } });
    expect(
      byKey(
        await settingsService.resolveAll(SUBJECTS['a user in a branch whose values are broken']),
      ),
    ).toMatchObject({
      [KEYS.everywhere]: { value: 5, from: 'organization' },
      [KEYS.branchOrOrganization]: { value: false, from: 'branch' },
      [KEYS.list]: { value: ['email'], from: 'default' },
    });
    expect(byKey(await settingsService.resolveAll(SUBJECTS['no one (a scheduled job)']))).toEqual({
      [KEYS.everywhere]: { value: 5, from: 'organization' },
      [KEYS.organizationOnly]: { value: 'company', from: 'organization' },
      [KEYS.branchOrOrganization]: { value: true, from: 'organization' },
      // Allowed only per user, and there is no user: the default, as before.
      [KEYS.userOnly]: { value: 'comfortable', from: 'default' },
      [KEYS.list]: { value: ['email'], from: 'default' },
      [KEYS.untouched]: { value: 42, from: 'default' },
    });
  });

  it('keeps the declaration order of the registry', async () => {
    const all = await settingsService.resolveAll(SUBJECTS['a user in a branch']);
    expect(all.map((d) => d.key)).toEqual(listSettingDeclarations().map((d) => d.key));
  });

  it('asks nothing when no declaration could be answered from the database', async () => {
    clearSettingRegistry();
    declareSetting({
      key: KEYS.userOnly,
      description: 'a personal preference only',
      schema: z.enum(['compact', 'comfortable']),
      defaultValue: 'comfortable',
      allowedScopes: ['user'],
    });

    const all = await settingsService.resolveAll(SUBJECTS['no one (a scheduled job)']);

    expect(all).toEqual([{ key: KEYS.userOnly, value: 'comfortable', resolvedFrom: 'default' }]);
    expect(queries).toHaveLength(0);
  });
});
