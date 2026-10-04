// «عاوز الفلاتر تكون كلها على صف واحد».
//
// A filter box sized with a width CLASS is not sized at all: `Input` (and every box built on it)
// carries its own `w-full`, and `cn` joins classes rather than merging them, so the box takes the
// whole row — pushing itself, and everything after it, onto lines of their own. In a filter bar a
// box gets its width from a wrapper (`<div className="w-44 shrink-0">`). This fails on a Fleet
// filter bar that sizes a box by its own class again.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

const files = (): string[] => {
  const run = spawnSync('grep', ['-rl', '<FilterBar', 'modules/fleet'], {
    cwd: SRC,
    encoding: 'utf8',
  });
  if (run.status !== 0 && run.status !== 1) throw new Error(run.stderr);
  return run.stdout
    .split('\n')
    .filter((file) => file.endsWith('.tsx') && !file.includes('.spec.'))
    .sort();
};

/** Each `<FilterBar …>…</FilterBar>` block in a file. */
const bars = (source: string): string[] => {
  const found: string[] = [];
  let at = source.indexOf('<FilterBar');
  while (at !== -1) {
    const end = source.indexOf('</FilterBar>', at);
    found.push(source.slice(at, end));
    at = source.indexOf('<FilterBar', end);
  }
  return found;
};

/** Every opening tag of a text box in `block`, braces balanced. */
const boxes = (block: string): string[] => {
  const tags: string[] = [];
  for (const match of block.matchAll(/<(Input|DebouncedInput|Textarea)\b/gu)) {
    let depth = 0;
    let end = match.index;
    for (; end < block.length; end += 1) {
      if (block[end] === '{') depth += 1;
      if (block[end] === '}') depth -= 1;
      if (block[end] === '>' && depth === 0) break;
    }
    tags.push(block.slice(match.index, end + 1));
  }
  return tags;
};

describe('a Fleet filter bar keeps its boxes to the width they were given', () => {
  it('no filter box is sized by a width class it cannot apply', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of files()) {
      for (const bar of bars(readFileSync(join(SRC, file), 'utf8'))) {
        for (const tag of boxes(bar)) {
          checked += 1;
          const cls = /className="([^"]*)"/u.exec(tag)?.[1] ?? '';
          if (/(^|\s)(w-\d|w-\[|w-auto|w-fit)/u.test(cls)) offenders.push(`${file}: ${cls}`);
        }
      }
    }
    expect(checked, 'the bars were actually read').toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
