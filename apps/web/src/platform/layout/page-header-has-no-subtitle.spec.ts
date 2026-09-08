// A page header shows a title and nothing under it — the owner's decision, held here.
//
// Every screen used to explain itself in a sentence beneath its own title: «الموظفون المعيّنون من
// عروض العمل المقبولة» under «الموظفون», «كل حسابات الدخول في النظام» under «مستخدمو النظام». The
// owner asked for all of them gone, on the 148 screens that had one and on every screen built from
// here on. The second half is the part a code change alone cannot deliver, which is why this file
// exists: the next author reaches for a subtitle because 148 pages used to have one, and the only
// thing that stops the habit is a test that fails.
//
// IT IS ENFORCED BY ABSENCE, not by a rule. `PageHeader` declares no prop to pass one through, so
// TypeScript already refuses `description=` at every call site. This spec guards the two ways that
// protection could be quietly undone — by re-adding the prop, or by a page hand-rolling the same
// paragraph under its own `<h1>` instead of using the shared header.
//
// Source-reading rather than rendering, like the other guards in this app: `apps/web` has no jsdom.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..');
const HEADER = readFileSync(resolve(HERE, 'PageContainer.tsx'), 'utf8');

const sources = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.tsx$/.test(entry.name) && !entry.name.endsWith('.spec.tsx')) out.push(path);
  }
  return out;
};

const FILES = sources(SRC);

/**
 * The lines that make up the opening `<PageHeader …>` tag, and nothing past it.
 *
 * READ BY LINE, deliberately. A character-level scan looked more precise and was not: an attribute
 * value can hold a JSX comment, and the apostrophe in "the platform's" reads as an opening quote to
 * anything that tracks strings naively — the scan then runs past the end of the tag and flags the
 * `description` on an `EmptyState` far below. Prettier formats this codebase, so a multi-line tag
 * always closes on a line of its own.
 */
const openingTag = (lines: readonly string[], first: number): string => {
  const head = lines[first] as string;
  if (/\/?>\s*$/.test(head)) return head;
  const out = [head];
  for (let i = first + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    out.push(line);
    if (/^\/?>$/.test(line.trim())) break;
  }
  return out.join('\n');
};

describe('the shared header has no subtitle to give', () => {
  it('declares no description prop', () => {
    const props = HEADER.slice(
      HEADER.indexOf('export const PageHeader'),
      HEADER.indexOf('): JSX.Element'),
    );
    expect(props).not.toContain('description');
    expect(props).not.toContain('subtitle');
  });

  /** The title, and then straight to the actions. Nothing renders between them. */
  it('renders the title and nothing beneath it', () => {
    const body = HEADER.slice(HEADER.indexOf('<h1'));
    const betweenTitleAndActions = body.slice(
      body.indexOf('</h1>'),
      body.indexOf('actions !== undefined'),
    );
    expect(betweenTitleAndActions).not.toContain('<p');
  });
});

describe('and no screen passes one anyway', () => {
  /**
   * Belt and braces over the type error. A `description` on `PageHeader` cannot compile today, but
   * this names the file when somebody adds the prop back and updates a call site in the same
   * change — at which point the compiler is happy and only this fails.
   */
  it('no page gives PageHeader a description or a subtitle', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!line.includes('<PageHeader')) return;
        // `description:` as well as `description=`, because the prop can also arrive through a
        // conditional spread — `{...(x === null ? {} : { description: x })}` — which is how two
        // pages slipped past the compiler entirely: a spread is not excess-property checked.
        if (/\b(description|subtitle)\s*[=:]/.test(openingTag(lines, index))) {
          offenders.push(`${relative(SRC, file)}:${String(index + 1)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
