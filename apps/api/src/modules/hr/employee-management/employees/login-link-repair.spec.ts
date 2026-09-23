// A back-reference is not an account.
//
// Deleting a login from «مستخدمو النظام» is a SOFT delete: the row stays, `isDeleted` is set, and
// every read of it answers 404. What it does NOT do on its own is let go of `employee.userId` —
// ADR-017 keeps that linkage on HR's side, out of the platform's reach. So the id goes on naming a
// row nothing returns, and the employee's account card drew the whole account panel over two
// requests that both failed, with no way back to «إنشاء حساب دخول».
//
// Three things now stop that, and they are deliberately not one thing: the platform ANNOUNCES the
// delete, HR answers it by clearing the link, and the two read paths that matter — provisioning and
// the card — each test whether the account still EXISTS rather than trusting the id. The event
// swallows its own failures by design, and rows predating it carry the stale link anyway, so the
// existence tests are the guarantee and the handler is the tidy-up.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlatformEvents, EVENT_SCHEMA_VERSIONS } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(HERE, path), 'utf8');

/**
 * One method's body, and nothing after it.
 *
 * Written as its own helper for two reasons, both of them mistakes this file made first. The
 * obvious slice — to the next doc comment — returns `-1` when there is no next one, and
 * `slice(0, -1)` is then the whole rest of the FILE, so the assertion passes on any method in the
 * module. And COMMENTS ARE STRIPPED, because the prose explaining why a call reads `by: null`
 * contains the string `by: null`: the first version of this test was satisfied by its own
 * explanation and went on passing with the bug restored two lines below it. A test a comment can
 * satisfy is not a test.
 */
const bodyOf = (source: string, signature: string): string => {
  const start = source.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const end = rest.indexOf('\n  }\n');
  expect(end, `${signature}: no method end found`).toBeGreaterThan(-1);
  return rest
    .slice(0, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
};

describe('a delete is its own event', () => {
  it('is declared, versioned, and distinct from a status change', () => {
    // Not `UserStatusChanged`: that also fires for an ARCHIVE, which deliberately KEEPS the links
    // it has. A listener acting on «archived» would unpick a link the archive was preserving.
    expect(PlatformEvents.UserDeleted).toBe('platform.user.deleted');
    expect(PlatformEvents.UserDeleted).not.toBe(PlatformEvents.UserStatusChanged);
    expect(EVENT_SCHEMA_VERSIONS[PlatformEvents.UserDeleted]).toBe(1);
  });

  it('is emitted by the soft delete, beside the status change and not instead of it', () => {
    const source = read('../../../../platform/users/user.service.ts');
    const body = bodyOf(source, 'async softDelete(');
    expect(body).toContain('PlatformEvents.UserDeleted');
    // The status change stays: the automation module listens for it, and this must not take that
    // away from it.
    expect(body).toContain('PlatformEvents.UserStatusChanged');
  });

  it('is subscribed to by HR, which owns the linkage', () => {
    const module = read('../../hr.module.ts');
    expect(module).toContain('PlatformEvents.UserDeleted');
    expect(module).toContain('clearLoginLinkOf');
  });
});

describe('provisioning tests existence, not the id', () => {
  const service = read('./employee.service.ts');
  const body = bodyOf(service, 'async createLogin(');

  it('asks whether the named account is still there before refusing', () => {
    // Refusing on the id alone left an employee whose login was deleted permanently unable to get
    // another one — the conflict fired forever on a row that no longer exists.
    expect(body).toContain('findByIdSystem');
    const asked = body.indexOf('findByIdSystem');
    const refused = body.indexOf("already has a login account");
    expect(asked).toBeGreaterThan(-1);
    expect(asked).toBeLessThan(refused);
  });

  it('still refuses when the account IS there', () => {
    expect(body).toContain('stillThere !== null');
    expect(body).toContain('ConflictError');
  });

  it('lets the stale link go rather than working around it', () => {
    // Carrying on while the row still names a dead account would leave the same trap for the next
    // reader; the repair belongs on the path that discovered it.
    expect(body).toContain('clearLoginLinkOf');
  });
});

// THE SECOND HALF OF THE SAME BUG, one layer down. The screen offering the button and the service
// accepting the press are both useless if the database refuses the insert — and it did: unlike
// `ux_email` and `ux_username` beside it, `ux_employeeId` was not partial on `isDeleted: false`, so
// a deleted account went on holding its employee's slot and the replacement died on a duplicate key.
// THE WRITE ITSELF. `updateById` casts `by` to an ObjectId, so an unattended write that names its
// actor with a word — 'system' — throws before it writes, and the press that was finally reachable
// answered «تعذّر على الخادم إتمام هذا الطلب» instead. `by: null` is how the rest of the codebase
// says nobody did this; there is no sentinel string that works.
describe('the unattended write names no actor', () => {
  const service = read('./employee.service.ts');
  const body = bodyOf(service, 'async clearLoginLinkOf(');

  it('passes a null actor rather than a word', () => {
    expect(body).toContain('by: null');
  });

  it('names no actor with a string anywhere in the module', () => {
    // One place getting this right is not the rule; `by` is only ever an ObjectId or null.
    expect(service).not.toContain("by: 'system'");
    expect(service).not.toMatch(/by: '[a-z]/);
  });

  it('bumps the caller’s version only when the clear actually wrote', () => {
    const created = bodyOf(service, 'async createLogin(');
    // A bump for a write that never happened makes the NEXT update fail its version check — a
    // second, more confusing error standing in for the one being repaired.
    expect(created).toContain('if (cleared !== null) employee.__v += 1;');
  });
});

describe('a deleted account frees its employee', () => {
  const model = read('../../../../platform/users/user.model.ts');

  it('scopes the one-login-per-employee index to LIVE accounts', () => {
    const declaration = model.slice(model.indexOf("name: 'ux_employeeId'") - 400, model.indexOf("name: 'ux_employeeId'") + 200);
    expect(declaration).toContain('isDeleted: false');
  });

  it('keeps all three identity indexes agreeing about what a delete frees', () => {
    // The username and the email were already freed by a delete; the employee link was the odd one
    // out, and three indexes disagreeing about it is how the trap was built.
    for (const name of ['ux_email', 'ux_username', 'ux_employeeId']) {
      const at = model.indexOf(`name: '${name}'`);
      expect(at, name).toBeGreaterThan(-1);
      expect(model.slice(at, at + 220), name).toContain('isDeleted: false');
    }
  });

  it('ships a migration for the databases that already carry the old shape', () => {
    // `autoIndex` is off outside development, and mongoose does not rebuild an index whose OPTIONS
    // changed — so the declaration alone would leave every existing deployment with the trap.
    const migration = read('../../../../platform/users/user.migration.ts');
    expect(migration).toContain('migrateUserEmployeeLinkIndex');
    expect(migration).toContain("dropIndex('ux_employeeId')");
    const boot = read('../../../../platform/kernel/bootstrap.ts');
    expect(boot).toContain('migrateUserEmployeeLinkIndex');
  });
});

describe('the card branches on the account, not the id', () => {
  const card = read(
    join(HERE, '../../../../../../..', 'apps/web/src/modules/hr/employee-management/employees/components/EmployeeAccountCard.tsx'),
  );

  it('treats a link that failed to resolve as no account', () => {
    expect(card).toContain('linked.isError');
    expect(card).toContain('const hasAccount');
  });

  it('gates every account-only panel on that, not on the raw id', () => {
    // The username editor, the security actions and the data scopes each used to key off
    // `employee.userId !== null`, which is exactly what drew them over a deleted account.
    expect(card).not.toContain('{employee.userId !== null && (');
    expect(card).toContain('{hasAccount && (');
  });

  it('says WHY the panel is gone rather than reusing «no login yet»', () => {
    expect(card).toContain('employees.account.linkBroken');
  });
});
