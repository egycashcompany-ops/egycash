// Every outbound HTTP request the api makes goes through `outbound.ts` — the policy is only worth
// what its coverage is, and coverage is the one thing a guard function cannot enforce about
// itself. Source-reading, like the other guards: a bare `fetch(` anywhere else in the api is a
// request the allowlist never sees, and this names the file.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..');
const DOOR = resolve(HERE, 'outbound.ts');

const sources = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(path);
  }
  return out;
};

/** A call to the global — not `outboundFetch(`, not `.fetch(` on some object, not a comment. */
const BARE_FETCH = /(?<![\w.$])fetch\s*\(/;
const RAW_HTTP_CLIENT = /from ['"]node:https?['"]|require\(['"]https?['"]\)/;

describe('outbound HTTP has one door', () => {
  it('no file but outbound.ts calls fetch directly, and none uses node:http(s) as a client', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      if (file === DOOR) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const code = line.replace(/\/\/.*$/, '');
          if (BARE_FETCH.test(code) || (RAW_HTTP_CLIENT.test(code) && !/import type/.test(code))) {
            offenders.push(`${relative(SRC, file)}:${String(index + 1)}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
