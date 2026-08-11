// The page registry: the rules that keep it honest, and the shape it actually has today.
//
// A page layer is easy to get subtly wrong in a way nothing notices — a permission pointing at a
// page that was renamed, a page nothing points at, a module quietly adopting another's surface —
// and every one of those renders as a perfectly plausible tree. The validator is what makes them
// loud, so it is tested against each failure individually rather than through the real registry,
// which is (correctly) valid.
//
// The second half pins the real numbers. That block is the one that fails when somebody adds a
// permission and forgets to say where it belongs: the total moves and the assertion names it.
import { describe, expect, it } from 'vitest';
import {
  declarePermissions,
  validatePageRegistry,
  type PageDef,
  type PermissionDef,
} from './def.js';
import { platformPages, platformPermissions } from './platform.js';

const page = (id: string, moduleId = 'platform'): PageDef => ({
  id,
  moduleId,
  name: { en: id, ar: id },
});

const perm = (key: string, pageId: string | null, moduleId = 'platform'): PermissionDef => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? 'view',
  moduleId,
  name: { en: key, ar: key },
  pageId,
});

describe('validatePageRegistry — what it refuses', () => {
  it('accepts a registry where every page is used and every reference resolves', () => {
    expect(
      validatePageRegistry([page('platform.users')], [perm('user.view', 'platform.users')]),
    ).toEqual([]);
  });

  it('accepts a permission that deliberately has no page', () => {
    expect(
      validatePageRegistry(
        [page('platform.users')],
        [perm('user.view', 'platform.users'), perm('file.view', null)],
      ),
    ).toEqual([]);
  });

  it('refuses a permission pointing at a page nobody declared', () => {
    const problems = validatePageRegistry([], [perm('user.view', 'platform.ghost')]);
    expect(problems.map((p) => p.kind)).toContain('unknown-page');
  });

  // D6: a page with nothing on it renders as an expandable row containing nothing — a tree that
  // describes a surface which, as far as authorization is concerned, does not exist.
  it('refuses a page no permission belongs to', () => {
    const problems = validatePageRegistry([page('platform.empty')], [perm('user.view', null)]);
    expect(problems.map((p) => p.kind)).toContain('empty-page');
    expect(problems[0]?.detail).toContain('platform.empty');
  });

  it('refuses the same page id declared twice', () => {
    const problems = validatePageRegistry(
      [page('platform.users'), page('platform.users')],
      [perm('user.view', 'platform.users')],
    );
    expect(problems.map((p) => p.kind)).toContain('duplicate-page');
  });

  it('refuses an id that is not <moduleId>.<slug>', () => {
    for (const bad of ['users', 'platform.Users', 'platform.', '.users']) {
      const problems = validatePageRegistry([page(bad)], [perm('user.view', bad)]);
      expect(
        problems.map((p) => p.kind),
        bad,
      ).toContain('bad-page-id');
    }
  });

  it('refuses a page whose id does not match the module that declares it', () => {
    const problems = validatePageRegistry(
      [{ id: 'hr.employees', moduleId: 'fleet', name: { en: 'x', ar: 'x' } }],
      [perm('employee.view', 'hr.employees', 'hr')],
    );
    expect(problems.map((p) => p.kind)).toContain('bad-page-id');
  });

  // One module's matrix must never grow rows from another's, or the tree stops being a projection
  // of the module boundary that ADR-004 draws.
  it('refuses a permission adopting another module’s page', () => {
    const problems = validatePageRegistry(
      [page('platform.users')],
      [perm('employee.view', 'platform.users', 'hr')],
    );
    expect(problems.map((p) => p.kind)).toContain('foreign-page');
  });

  it('reports every problem in one pass rather than stopping at the first', () => {
    const problems = validatePageRegistry(
      [page('platform.a'), page('platform.a')],
      [perm('user.view', 'platform.ghost')],
    );
    expect(new Set(problems.map((p) => p.kind))).toEqual(
      new Set(['duplicate-page', 'unknown-page', 'empty-page']),
    );
  });
});

describe('declarePermissions carries the page down to every key', () => {
  it('stamps the resource’s page on standard actions and specials alike', () => {
    const declared = declarePermissions(
      'platform',
      'user',
      { en: 'users', ar: 'المستخدمين' },
      ['view', 'create'],
      [{ action: 'resetPassword', name: { en: 'Reset', ar: 'إعادة' } }],
      'platform.users',
    );
    expect(declared.map((d) => d.pageId)).toEqual([
      'platform.users',
      'platform.users',
      'platform.users',
    ]);
  });

  it('defaults to null, so a resource nobody has placed is unassigned rather than wrong', () => {
    const declared = declarePermissions('platform', 'file', { en: 'files', ar: 'الملفات' }, [
      'view',
    ]);
    expect(declared[0]?.pageId).toBeNull();
  });
});

describe('the platform registry as it actually stands', () => {
  it('is valid — this is the same check that runs at boot and in CI', () => {
    expect(validatePageRegistry(platformPages, platformPermissions)).toEqual([]);
  });

  it('declares 14 pages for 63 permissions', () => {
    expect(platformPages).toHaveLength(14);
    expect(platformPermissions).toHaveLength(63);
  });

  // The unassigned set is an explicit answer, not a gap, so it is pinned by name. Adding a
  // permission without placing it changes this list and fails here — which is the point.
  //
  // `setting` left the list in P8 and the two log streams in P11, each in the same change that
  // routed its screen. That is the only direction this list may shrink: a page is added by the work
  // that builds its screen, never ahead of it, because a page whose `route` nothing serves is the
  // same lie as a missing page for a screen that exists.
  it('leaves exactly the four resources that have no administration screen unassigned', () => {
    const unassigned = [
      ...new Set(platformPermissions.filter((p) => p.pageId === null).map((p) => p.resource)),
    ].sort();
    expect(unassigned).toEqual(['file', 'fileCategory', 'notificationTemplate', 'scheduledTask']);
    expect(platformPermissions.filter((p) => p.pageId === null)).toHaveLength(14);
  });

  // The two streams are separate grants; a single shared page would put both behind whichever one
  // the reader happened to hold.
  it('gives each log stream its own page', () => {
    const on = (resource: string) =>
      platformPermissions.filter((p) => p.resource === resource).map((p) => p.pageId);
    expect(on('auditLog')).toEqual(['platform.audit', 'platform.audit']);
    expect(on('activityLog')).toEqual(['platform.activity']);
  });

  it('places both settings permissions on the settings page', () => {
    const settings = platformPermissions.filter((p) => p.resource === 'setting');
    expect(settings.map((p) => p.key).sort()).toEqual(['setting.edit', 'setting.view']);
    for (const permission of settings) expect(permission.pageId).toBe('platform.settings');
  });

  it('every page a platform permission names is declared by the platform', () => {
    for (const permission of platformPermissions) {
      if (permission.pageId === null) continue;
      expect(
        platformPages.map((p) => p.id),
        permission.key,
      ).toContain(permission.pageId);
    }
  });
});
