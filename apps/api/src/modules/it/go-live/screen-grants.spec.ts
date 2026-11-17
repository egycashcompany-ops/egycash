// The IT screens' own grants reach the people who ran them by DEPLOYING — what is guarded here is the
// caller: the processes start it, the mapping is exactly the owner's decision and names only keys
// the module registers, the run row names roles and no person, and the after-commit step follows
// the commit. The copy itself is proved against a real mongo in
// `tests/integration/it-go-live-screen-grants.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { itPermissions } from '../it.module';
import { IT_SCREEN_GRANTS_MARK, IT_SCREEN_GRANT_PAIRS, screenGrantsOutcome } from './screen-grants';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the screen grants are copied by the deploy', () => {
  it('the api starts it', () => {
    expect(code('src/server.ts')).toContain('startItScreenGrantsGoLive();');
  });

  // Not the worker: it boots the new build minutes before the new api serves, and every role made
  // in the old roles screen meanwhile would miss the copy for good (see the file's header).
  it('the worker does not', () => {
    expect(code('src/worker.ts')).not.toContain('startItScreenGrantsGoLive');
  });

  it('runs once per version of the mapping', () => {
    expect(IT_SCREEN_GRANTS_MARK).toBe('go-live:it-screen-grants:v1');
    expect(IT_SCREEN_GRANTS_MARK).toMatch(/:v\d+$/u);
  });

  it('copies each asset grant onto the same action of both screens — the national ID to the lines', () => {
    expect(IT_SCREEN_GRANT_PAIRS).toEqual([
      { from: 'itAsset.view', add: ['itConsumable.view', 'itMobileLine.view'] },
      { from: 'itAsset.create', add: ['itConsumable.create', 'itMobileLine.create'] },
      { from: 'itAsset.edit', add: ['itConsumable.edit', 'itMobileLine.edit'] },
      { from: 'itAsset.assign', add: ['itConsumable.assign', 'itMobileLine.assign'] },
      { from: 'itAsset.viewNationalId', add: ['itMobileLine.viewNationalId'] },
    ]);
  });

  it('names only keys the IT module registers — a grant never holds an unknown key', () => {
    const registered = new Set(itPermissions.map((permission) => permission.key));
    for (const pair of IT_SCREEN_GRANT_PAIRS) {
      expect(registered.has(pair.from), pair.from).toBe(true);
      for (const key of pair.add) expect(registered.has(key), key).toBe(true);
    }
  });

  it('copies the two screens’ own keys and nothing else', () => {
    const added = IT_SCREEN_GRANT_PAIRS.flatMap((pair) => pair.add);
    expect(added.every((key) => /^(itConsumable|itMobileLine)\./u.test(key))).toBe(true);
    expect(IT_SCREEN_GRANT_PAIRS.every((pair) => pair.from.startsWith('itAsset.'))).toBe(true);
  });

  it('copies inside the transaction, records the run there, and audits after the commit', () => {
    const source = code('src/modules/it/go-live/screen-grants.ts');
    const transaction = source.indexOf('unitOfWork(');
    const copy = source.indexOf('rbacService.grantAlongside(IT_SCREEN_GRANT_PAIRS, session)');
    const record = source.indexOf('recordItGoLiveRun(IT_SCREEN_GRANTS_MARK, outcome, session)');
    const after = source.indexOf('rbacService.afterGrantsAlongside(run.result)');
    expect(transaction).toBeGreaterThan(-1);
    expect(copy).toBeGreaterThan(transaction);
    expect(record).toBeGreaterThan(copy);
    expect(after).toBeGreaterThan(record);
    expect(source).toContain('if (isTest) return;');
  });
});

describe('the run row', () => {
  it('counts what changed, names the roles and what each gained, and names no person', () => {
    const outcome = screenGrantsOutcome({
      roles: [
        {
          roleId: 'r1',
          name: { ar: 'الدعم الفني', en: 'IT support' },
          before: ['itAsset.view', 'itAsset.assign'],
          after: [
            'itAsset.view',
            'itAsset.assign',
            'itConsumable.view',
            'itMobileLine.view',
            'itConsumable.assign',
            'itMobileLine.assign',
          ],
        },
      ],
      delegatedGrants: [
        {
          grantId: 'g1',
          userId: 'u-person',
          branchId: 'b1',
          departmentId: null,
          departmentCatalogId: null,
          before: ['itAsset.view'],
          after: ['itAsset.view', 'itConsumable.view', 'itMobileLine.view'],
        },
      ],
    });
    expect(outcome).toEqual({
      rolesChanged: 1,
      delegatedGrantsChanged: 1,
      roles: [
        {
          id: 'r1',
          name: { ar: 'الدعم الفني', en: 'IT support' },
          added: [
            'itConsumable.assign',
            'itConsumable.view',
            'itMobileLine.assign',
            'itMobileLine.view',
          ],
        },
      ],
      delegatedGrants: [{ id: 'g1', added: ['itConsumable.view', 'itMobileLine.view'] }],
    });
    expect(JSON.stringify(outcome)).not.toContain('u-person');
  });
});
