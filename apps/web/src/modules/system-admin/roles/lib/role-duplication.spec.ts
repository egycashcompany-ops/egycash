// Duplicating a role — what it copies, and the two ways it refuses.
//
// The refusals are the substance. A duplicate is the one operation whose entire purpose is to
// reproduce a set of authorities in one click, which makes "copy what you can and skip the rest"
// the most tempting wrong answer available: it succeeds, it looks right, and it produces a role
// that shares a name with the original and quietly grants less. Every case below exists to pin
// that the answer is all-or-nothing.
//
// The server is still what refuses — `assertKnownPermissionKeys` and `assertKeysHeld` run on the
// create either way, because a duplicate IS a create. These functions decide only what the screen
// offers, and a source assertion at the bottom pins that the submit path never diverged.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type PermissionDto, type RoleDto } from '@ecms/contracts';
import { duplicateBlocker, duplicateName, duplicatePayload } from './role-duplication';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIALOG = readFileSync(resolve(HERE, '../components/RoleFormDialog.tsx'), 'utf8');
const PAGE = readFileSync(resolve(HERE, '../pages/RoleDetailPage.tsx'), 'utf8');

const permission = (key: string): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? 'view',
  moduleId: 'platform',
  name: { ar: key, en: key },
  breakGlass: false,
  pageId: null,
});

const CATALOG = ['user.view', 'user.create', 'user.delete'].map(permission);

const role = (permissionKeys: string[], over: Partial<RoleDto> = {}): RoleDto => ({
  id: 'r1',
  key: null,
  name: { ar: 'مسؤول الحسابات', en: 'Account admin' },
  description: 'Looks after accounts',
  isSystem: false,
  managed: 'none',
  permissionKeys,
  version: 3,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  ...over,
});

const holds =
  (...keys: string[]) =>
  (key: string): boolean =>
    keys.includes(key);
const holdsAll = (): boolean => true;

describe('duplicateBlocker — when a copy may be offered', () => {
  it('allows it when the actor holds every permission the role carries', () => {
    expect(duplicateBlocker(role(['user.view', 'user.create']), CATALOG, holdsAll)).toBeNull();
  });

  it('allows a role that carries nothing the actor lacks, even if the catalog is wider', () => {
    expect(
      duplicateBlocker(role(['user.view']), CATALOG, holds('user.view', 'user.create')),
    ).toBeNull();
  });

  // The refusal that matters most: all-or-nothing, and it names what is missing.
  it('refuses outright when the actor is missing even one permission', () => {
    const blocked = duplicateBlocker(
      role(['user.view', 'user.delete']),
      CATALOG,
      holds('user.view'),
    );
    expect(blocked).toEqual({ reason: 'keys-not-held', keys: ['user.delete'] });
  });

  it('names every missing key, sorted, rather than only the first', () => {
    const blocked = duplicateBlocker(
      role(['user.delete', 'user.create', 'user.view']),
      CATALOG,
      holds('user.view'),
    );
    expect(blocked?.keys).toEqual(['user.create', 'user.delete']);
  });

  // The other refusal, which is not about the actor at all.
  it('refuses a role carrying a key the registry no longer declares', () => {
    const blocked = duplicateBlocker(role(['user.view', 'retired.view']), CATALOG, holdsAll);
    expect(blocked).toEqual({ reason: 'unknown-keys', keys: ['retired.view'] });
  });

  // Reporting "you lack a permission" for one that no longer exists would send an administrator to
  // ask for a grant nobody can give.
  it('reports the unknown key first when a role carries both problems', () => {
    const blocked = duplicateBlocker(
      role(['retired.view', 'user.delete']),
      CATALOG,
      holds('user.view'),
    );
    expect(blocked?.reason).toBe('unknown-keys');
  });

  it('treats an unknown key as unknown even for an actor who holds everything', () => {
    expect(duplicateBlocker(role(['retired.view']), CATALOG, holdsAll)?.reason).toBe(
      'unknown-keys',
    );
  });
});

describe('duplicateName', () => {
  it('appends the suffix, leaving the original readable', () => {
    expect(duplicateName('Account admin', '(Copy)')).toBe('Account admin (Copy)');
    expect(duplicateName('مسؤول الحسابات', '(نسخة)')).toBe('مسؤول الحسابات (نسخة)');
  });

  it('appends again rather than parsing a name it did not write', () => {
    expect(duplicateName('Account admin (Copy)', '(Copy)')).toBe('Account admin (Copy) (Copy)');
  });

  it('does not leave a stray space when the name is empty', () => {
    expect(duplicateName('', '(Copy)')).toBe('(Copy)');
  });
});

describe('duplicatePayload — what travels, and what cannot', () => {
  it('carries the permission keys', () => {
    expect(duplicatePayload(role(['user.view', 'user.create'])).permissionKeys).toEqual([
      'user.view',
      'user.create',
    ]);
  });

  it('carries the description, and turns an absent one into an empty field', () => {
    expect(duplicatePayload(role(['user.view'])).description).toBe('Looks after accounts');
    expect(duplicatePayload(role(['user.view'], { description: null })).description).toBe('');
  });

  it('copies the key list rather than aliasing it', () => {
    const source = role(['user.view']);
    const payload = duplicatePayload(source);
    payload.permissionKeys.push('user.delete');
    expect(source.permissionKeys).toEqual(['user.view']);
  });

  // Assignments, identity and management are absent BY TYPE — there is no field to put them in.
  it('carries no assignments, holders, id, key, isSystem or managed', () => {
    const payload = duplicatePayload(role(['user.view']));
    expect(Object.keys(payload).sort()).toEqual(['description', 'permissionKeys']);
    for (const forbidden of [
      'assignments',
      'holders',
      'users',
      'id',
      'key',
      'isSystem',
      'managed',
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });
});

// ── The wiring, which is the part that could quietly go wrong ────────────────

describe('a duplicate is a CREATE, and goes through every guard one does', () => {
  it('opens the form with role={null}, so the submit path is createRole', () => {
    expect(PAGE).toContain('role={null}');
    expect(PAGE).toContain('duplicateOf={role}');
    // No duplicate endpoint, no duplicate mutation — the copy reuses the create path entirely.
    expect(PAGE).not.toMatch(/duplicateRole|\/duplicate/);
    expect(DIALOG).not.toMatch(/duplicateRole|\/duplicate/);
  });

  it('sends the same CreateRole body a hand-built role sends', () => {
    expect(DIALOG).toContain('const body: CreateRole = {');
    expect(DIALOG).toContain('create.mutate(body, {');
    // Nothing about assignments reaches the create.
    expect(DIALOG).not.toMatch(/assignment/i);
  });

  it('never trims the key list before sending — the server refuses the whole copy', () => {
    // `keys` is seeded from the payload and sent as-is; no filter on `canGrant` sits between them.
    expect(DIALOG).toContain('copied?.permissionKeys ?? role?.permissionKeys ?? []');
    expect(DIALOG).not.toMatch(/permissionKeys:\s*keys\.filter/);
  });

  it('refuses before opening, naming the reason, rather than after the server answers', () => {
    expect(PAGE).toContain('const blocker = duplicateBlocker(role, catalog, can)');
    expect(PAGE).toContain('disabled={blocker !== null}');
    expect(PAGE).toContain("'systemAdmin.roles.duplicateBlockedUnknown'");
    expect(PAGE).toContain("'systemAdmin.roles.duplicateBlockedNotHeld'");
  });

  it('is gated on role.create, because creating is what it does', () => {
    expect(PAGE).toMatch(/<Can permission="role\.create">[\s\S]{0,900}?actions\.duplicate/);
  });
});
