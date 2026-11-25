// Every notification this module SENDS has a template behind it (P2 plan §11.1, §12.1; RK-22), in
// the `hr.seed.spec.ts` shape.
//
// The failure it prevents is silent. `notificationsService.notify()` throws on a template that was
// never seeded, and every send here swallows that on purpose — a notice must never undo an act that
// was rightly recorded — so a sent key nobody seeded tells nobody anything, and no test fails. The
// send site and the seed live in different files, and only this connects them.
//
// It reads the source rather than running the sends: a runtime check sees only the notices a test
// happens to trigger, and the ones that go quiet are the ones no test triggers.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdministrationTemplates } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — prose naming a template must not be what satisfies "this template is sent". */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const SEED = code(readFileSync(resolve(HERE, 'administration.seed.ts'), 'utf8'));

/** `template: AdministrationTemplates.X` at any send site of the module, as `Group.Member`. */
const sentReferences = (): string[] => {
  const found = new Set<string>();
  for (const file of sources(HERE)) {
    for (const match of code(readFileSync(file, 'utf8')).matchAll(
      /template:\s*(Administration[A-Za-z]*Templates)\.([A-Za-z0-9_]+)/g,
    )) {
      found.add(`${match[1] ?? ''}.${match[2] ?? ''}`);
    }
  }
  return [...found].sort();
};

/** `key: AdministrationTemplates.X` in the seed: each template it ensures. */
const seededReferences = (): string[] =>
  [...SEED.matchAll(/key:\s*(Administration[A-Za-z]*Templates)\.([A-Za-z0-9_]+)/g)]
    .map((match) => `${match[1] ?? ''}.${match[2] ?? ''}`)
    .sort();

describe('the notification templates this module sends', () => {
  const sent = sentReferences();

  it('finds send sites at all — a scanner that matches nothing proves nothing', () => {
    expect(sent).toContain('AdministrationTemplates.PurchaseRequestAwaitingDecision');
  });

  /**
   * One way only: everything the scan SEES being sent is seeded. A send routed through a variable
   * is invisible to it, so the reverse would prove nothing, and a seeded template nobody sends
   * costs a row and misleads nobody. The silent failure is the sent one nobody seeded.
   */
  it('are every one of them seeded', () => {
    const seeded = seededReferences();
    expect(sent.filter((reference) => !seeded.includes(reference))).toEqual([]);
  });

  it('are keyed by the contracts’ constant, never a string a typo could part from it', () => {
    const declared = Object.keys(AdministrationTemplates).map(
      (member) => `AdministrationTemplates.${member}`,
    );
    expect(seededReferences().filter((reference) => !declared.includes(reference))).toEqual([]);
    expect(SEED).not.toMatch(/key:\s*'administration\./);
  });
});

describe('the approvers’ notice (P2 plan §11.1)', () => {
  /**
   * Who hears it is the live rung's eligible approvers, by login id, as the engine read them — never
   * a key's holders, who include every other rung's and the requester when they hold it.
   */
  it('goes to the users the submission found, never to a key', () => {
    const notices = code(
      readFileSync(
        resolve(HERE, 'procurement/purchase-requests/purchase-request-notices.ts'),
        'utf8',
      ),
    );
    expect(notices).toContain('to: { userIds: [...approvers] }');
    expect(notices).not.toMatch(/permission:/);
  });

  /** A notice points at the request; it is not a second copy of it, and names nobody. */
  it('interpolates the number and nothing else, in both languages', () => {
    const block = SEED.slice(
      SEED.indexOf('AdministrationTemplates.PurchaseRequestAwaitingDecision'),
    );
    const ensure = block.slice(0, block.indexOf('});'));
    expect([...ensure.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1])).toEqual([
      'number',
      'number',
    ]);
    expect(ensure).toContain("variables: ['number']");
    expect(ensure).toContain("category: 'approval'");
  });
});
