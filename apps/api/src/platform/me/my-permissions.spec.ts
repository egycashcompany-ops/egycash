// What an employee may read about himself — and, just as much, what he may not.
//
// The administration projection this reduces is a superset in three directions at once: it keeps
// grants that are not in force, it names the assignment ids an administrator acts on, and it ships
// the whole page registry. Each of those is a separate way for the self-service view to say more
// than it should, so each gets its own case here.
import { describe, expect, it } from 'vitest';
import {
  type EffectivePermissionRowDto,
  type EffectivePermissionSourceDto,
  type EffectivePermissionsDto,
  type PermissionCatalogDto,
  type PermissionDto,
} from '@ecms/contracts';
import { reduceToMyPermissions } from './my-permissions';

const source = (over: Partial<EffectivePermissionSourceDto> = {}): EffectivePermissionSourceDto => ({
  assignmentId: 'a1',
  kind: 'role',
  roleId: 'r1',
  roleName: { ar: 'مدير الحركة', en: 'Operations Manager' },
  roleKey: null,
  roleManaged: 'none',
  branch: null,
  department: null,
  scope: 'department',
  validFrom: null,
  validTo: null,
  state: 'active',
  decisive: true,
  ...over,
});

const row = (over: Partial<EffectivePermissionRowDto> = {}): EffectivePermissionRowDto => ({
  key: 'leave.view',
  moduleId: 'hr',
  name: { ar: 'الاطلاع على الإجازات', en: 'View leave' },
  breakGlass: false,
  scope: 'department',
  state: 'active',
  sources: [source()],
  ...over,
});

const explained = (rows: EffectivePermissionRowDto[]): EffectivePermissionsDto => ({
  userId: 'u1',
  evaluatedAt: '2026-09-21T10:00:00.000Z',
  permissionVersion: 3,
  isPrivileged: false,
  privilegedBecause: { systemRoles: [], breakGlassKeys: [] },
  rows,
});

const permission = (key: string, pageId: string | null): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? 'view',
  moduleId: 'hr',
  name: { ar: key, en: key },
  breakGlass: false,
  pageId,
});

const catalog = (
  permissions: PermissionDto[],
  pages: PermissionCatalogDto['pages'] = [],
): PermissionCatalogDto => ({ permissions, pages });

describe('only what is in force right now', () => {
  it('keeps a row something grants today', () => {
    const mine = reduceToMyPermissions(explained([row()]), catalog([permission('leave.view', null)]));
    expect(mine.rows.map((r) => r.key)).toEqual(['leave.view']);
    expect(mine.rows[0]?.scope).toBe('department');
  });

  it('drops a grant that has not opened yet, and one that has closed', () => {
    // Both reach the administration screen — «تبدأ الشهر القادم» and «انتهت الثلاثاء» are its
    // answers. Neither is an authority the holder has now, and printing it here would promise a
    // screen the server would refuse to open.
    const mine = reduceToMyPermissions(
      explained([
        row({ key: 'later.view', scope: null, state: 'pending', sources: [source({ state: 'pending' })] }),
        row({ key: 'gone.view', scope: null, state: 'expired', sources: [source({ state: 'expired' })] }),
        row(),
      ]),
      catalog([]),
    );
    expect(mine.rows.map((r) => r.key)).toEqual(['leave.view']);
  });

  it('keeps a live row but drops the dead sources under it', () => {
    // One role ended, another still runs. The permission is his; the ended role is not part of the
    // answer to «من أين جاءت؟» today.
    const mine = reduceToMyPermissions(
      explained([
        row({
          sources: [
            source({ state: 'expired', roleName: { ar: 'دور منتهي', en: 'Ended role' } }),
            source({ state: 'active', roleName: { ar: 'دور قائم', en: 'Live role' } }),
          ],
        }),
      ]),
      catalog([]),
    );
    expect(mine.rows[0]?.sources.map((s) => s.name.ar)).toEqual(['دور قائم']);
  });
});

describe('the sources are named, never identified', () => {
  it('carries no assignment id, role id or validity window', () => {
    // There is no action on this screen, so an id here would be a handle on a record the reader
    // may not touch — and the one thing an id is good for is touching the record.
    const mine = reduceToMyPermissions(explained([row()]), catalog([]));
    expect(JSON.stringify(mine)).not.toContain('assignmentId');
    expect(JSON.stringify(mine)).not.toContain('a1');
    expect(JSON.stringify(mine)).not.toContain('validTo');
  });

  it('says where a delegation applies, and says nothing of the sort for a role', () => {
    const mine = reduceToMyPermissions(
      explained([
        row({
          sources: [
            source({
              kind: 'delegation',
              roleName: { ar: 'تفويض', en: 'Delegated' },
              branch: { id: 'b1', name: { ar: 'أكتوبر', en: 'October' } },
              department: { id: 'd1', name: { ar: 'الحركة', en: 'Operations' } },
            }),
            source(),
          ],
        }),
      ]),
      catalog([]),
    );
    expect(mine.rows[0]?.sources[0]?.where?.ar).toBe('الحركة · أكتوبر');
    expect(mine.rows[0]?.sources[1]?.where).toBeNull();
  });

  it('names the branch alone for a delegation over a whole branch', () => {
    const mine = reduceToMyPermissions(
      explained([
        row({
          sources: [
            source({
              kind: 'delegation',
              branch: { id: 'b1', name: { ar: 'أكتوبر', en: 'October' } },
              department: null,
            }),
          ],
        }),
      ]),
      catalog([]),
    );
    expect(mine.rows[0]?.sources[0]?.where?.ar).toBe('أكتوبر');
  });
});

describe('the screen each permission opens', () => {
  it('resolves it from the registry rather than from the projection', () => {
    const mine = reduceToMyPermissions(
      explained([row()]),
      catalog(
        [permission('leave.view', 'hr.leave')],
        [{ id: 'hr.leave', moduleId: 'hr', name: { ar: 'الإجازات', en: 'Leave' }, route: '/hr/leave', sortOrder: 1 }],
      ),
    );
    expect(mine.rows[0]?.pageId).toBe('hr.leave');
    expect(mine.pages.map((p) => p.id)).toEqual(['hr.leave']);
  });

  it('leaves a key the registry no longer declares ungrouped rather than dropping it', () => {
    // A role can outlive the module that declared its key. The holder still has the permission,
    // and a row that vanished would be the one thing this screen must never do.
    const mine = reduceToMyPermissions(explained([row({ key: 'retired.view' })]), catalog([]));
    expect(mine.rows.map((r) => r.key)).toEqual(['retired.view']);
    expect(mine.rows[0]?.pageId).toBeNull();
  });

  it('ships only the surfaces the rows reference, not the registry', () => {
    // `permission.view` guards the full catalog, and the account reading its own permissions is
    // precisely the one that does not hold it. Sending every page here would route around that.
    const mine = reduceToMyPermissions(
      explained([row()]),
      catalog(
        [permission('leave.view', 'hr.leave')],
        [
          { id: 'hr.leave', moduleId: 'hr', name: { ar: 'الإجازات', en: 'Leave' }, route: null, sortOrder: 1 },
          { id: 'fleet.vehicles', moduleId: 'fleet', name: { ar: 'المركبات', en: 'Vehicles' }, route: null, sortOrder: 1 },
        ],
      ),
    );
    expect(mine.pages.map((p) => p.id)).toEqual(['hr.leave']);
  });
});

describe('an account with no permissions at all', () => {
  it('answers an empty list — which is what lets the client hide the entry entirely', () => {
    const mine = reduceToMyPermissions(explained([]), catalog([]));
    expect(mine.rows).toEqual([]);
    expect(mine.pages).toEqual([]);
    expect(mine.evaluatedAt).toBe('2026-09-21T10:00:00.000Z');
  });
});
