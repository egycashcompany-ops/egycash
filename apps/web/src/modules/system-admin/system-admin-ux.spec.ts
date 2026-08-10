// Structural invariants for the parts of System Administration that are about SAFETY and
// ADDRESSABILITY rather than about data.
//
// Every rule here is one the broken version renders perfectly well: a revoke that fires straight
// from the row still looks like a button, a page held in component state still pages, and a holder
// row with no link still shows a name. The web suite runs with `environment: 'node'` and carries no
// jsdom (`vitest.config.ts`), so none of it can be driven by clicking — these are checked where the
// property actually lives, in the source, and each assertion says what it is standing in for.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(HERE, path), 'utf8');

const USER_DETAIL = read('users/pages/UserDetailPage.tsx');
const USER_ROLES_TAB = read('roles/components/UserRolesTab.tsx');
const ROLE_DETAIL = read('roles/pages/RoleDetailPage.tsx');

describe('a destructive action is confirmed, and the confirmation says what it will destroy', () => {
  // Both lists show several rows that look alike — same shape, different account or different role.
  // "Are you sure?" confirms nothing about which row the pointer was over.
  for (const [name, source, message] of [
    ['User → Roles', USER_ROLES_TAB, 'systemAdmin.assignments.confirmRevoke'],
    ['Role → Users', ROLE_DETAIL, 'systemAdmin.roles.users.confirmRevoke'],
  ] as const) {
    it(`${name} — the revoke button opens a dialog instead of mutating`, () => {
      // The failure this pins: `onClick={() => revoke.mutate(...)}` straight off the row.
      expect(source).not.toMatch(/onClick=\{\(\) =>\s*\n?\s*revoke\.mutate\(/);
      expect(source).toContain('onClick={() => setRevoking(a)}');
      expect(source).toContain('open={revoking !== null}');
    });

    it(`${name} — the confirmation names the role and the scope`, () => {
      expect(source).toContain(message);
      expect(source).toMatch(/scope: t\(`systemAdmin\.assignments\.scopes\.\$\{/);
    });
  }

  it('User → Roles names the account, which it has loaded', () => {
    expect(USER_ROLES_TAB).toContain('user: fullName(user, locale)');
  });

  // The role page holds ids, not accounts, so the name is resolved by the directory component the
  // table already uses rather than interpolated into the sentence.
  it('Role → Users names the account through the directory', () => {
    expect(ROLE_DETAIL).toContain('{revoking !== null && <ActorById userId={revoking.userId} />}');
    expect(ROLE_DETAIL).toContain('{revoking !== null && <AssignmentScopeBadge scope={revoking.scope} />}');
  });

  it('both dialogs close only after the server said yes', () => {
    for (const source of [USER_ROLES_TAB, ROLE_DETAIL]) {
      expect(source).toMatch(/onSuccess: \(\) => \{\s*\n\s*setRevoking\(null\);/);
    }
  });
});

describe('a list page is addressable', () => {
  // An account with more grants than one page holds is exactly the account somebody is asking a
  // question about, so "the second page of their roles" has to survive being pasted into a chat.
  it('User → Roles reads its page from the URL, not from component state', () => {
    expect(USER_ROLES_TAB).toContain("const page = Math.max(1, Number(sp.get('page') ?? '1') || 1)");
    expect(USER_ROLES_TAB).not.toContain('useState(1)');
  });

  it('writes the page back through the same search params', () => {
    expect(USER_ROLES_TAB).toMatch(/params\.set\('page', String\(next\)\);/);
  });

  // `page` belongs to whichever list the tab you are leaving was showing. Both detail screens drop
  // it on every switch, so page 3 of one list never lands on another tab.
  it('both detail screens clear the page when the tab changes', () => {
    for (const source of [USER_DETAIL, ROLE_DETAIL]) {
      const setTab = /const setTab = \(next: Tab\): void => \{([\s\S]*?)\n {2}\};/.exec(source)?.[1];
      expect(setTab, 'setTab was not found — the scan is stale').toBeDefined();
      expect(setTab).toContain("params.delete('page')");
    }
  });
});

describe('the trail from a role to an account is followable', () => {
  it('links each holder to the account screen', () => {
    expect(ROLE_DETAIL).toContain('to={`/system/users/${a.userId}`}');
    expect(ROLE_DETAIL).toContain("import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'");
  });

  it('carries an accessible name, since the link text is generic', () => {
    expect(ROLE_DETAIL).toContain("aria-label={t('systemAdmin.roles.users.openAccount')}");
  });

  // `UserProfileDrawer` is platform-level and shared by every module that renders an actor. The
  // link sits BESIDE the name rather than changing what clicking the name does.
  it('leaves the platform profile drawer alone', () => {
    expect(ROLE_DETAIL).not.toContain('UserProfileDrawer');
    expect(ROLE_DETAIL).toContain('<ActorById userId={a.userId} />');
  });
});
