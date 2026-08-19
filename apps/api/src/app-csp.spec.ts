// The Content-Security-Policy this process serves the console under.
//
// WHY A TEST. A CSP failure is silent: the browser blocks the request, the page renders without
// the thing, and nothing reaches a log the team reads. That is exactly how `img-src` shipped
// without `blob:` and every file picker showed a broken preview — and the map tiles behind the
// branch location picker fail the same way, as a grey box with no error anywhere.
//
// So both directions are pinned: the hosts the app NEEDS, and the fact that the one remote host on
// the list is confined to pictures.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import helmet from 'helmet';

/** The directives `app.ts` builds — read from helmet the same way it does. */
const directives = (): Record<string, unknown> => ({
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  'img-src': ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
});

const imgSrc = (): string[] => directives()['img-src'] as string[];

describe('img-src carries what the console actually renders', () => {
  it('allows the app’s own images', () => {
    expect(imgSrc()).toContain("'self'");
  });

  it('allows data: and blob:, which is what a local file preview is', () => {
    // An object URL is the only way to show bytes that exist nowhere but in the tab.
    expect(imgSrc()).toEqual(expect.arrayContaining(['data:', 'blob:']));
  });

  it('allows the OpenStreetMap tile host, or the branch map picker draws nothing', () => {
    expect(imgSrc()).toContain('https://*.tile.openstreetmap.org');
  });
});

describe('the one remote host is confined to pictures', () => {
  const REMOTE = 'openstreetmap';

  it('appears under img-src and under no other directive', () => {
    const elsewhere = Object.entries(directives())
      .filter(([name]) => name !== 'img-src')
      .filter(([, value]) => JSON.stringify(value).includes(REMOTE))
      .map(([name]) => name);
    expect(elsewhere).toEqual([]);
  });

  it('is https-only and a single host pattern — not a wildcard scheme or a bare *', () => {
    const remote = imgSrc().filter((source) => source.includes(REMOTE));
    expect(remote).toHaveLength(1);
    for (const source of remote) {
      expect(source.startsWith('https://')).toBe(true);
      expect(source).not.toBe('*');
      expect(source.endsWith('.tile.openstreetmap.org')).toBe(true);
    }
  });

  it('lets in no OTHER remote host anywhere in the policy', () => {
    // A default-directive list is all `'self'`/`'none'`-style keywords; the tile host is the only
    // origin this app names. If a second one appears it should arrive with its own reasoning.
    const origins = Object.entries(directives()).flatMap(([name, value]) =>
      (Array.isArray(value) ? (value as string[]) : [])
        .filter((source) => source.startsWith('http://') || source.startsWith('https://'))
        .map((source) => `${name}: ${source}`),
    );
    expect(origins).toEqual(['img-src: https://*.tile.openstreetmap.org']);
  });
});

describe('the policy the app builds matches the one asserted here', () => {
  const SOURCE = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');

  // This file rebuilds the directive rather than importing the app, so it could drift from what
  // `app.ts` actually serves. This is the check that it has not.
  it('finds every asserted img-src entry in app.ts', () => {
    for (const entry of imgSrc()) {
      expect(SOURCE, entry).toContain(entry);
    }
  });

  it('finds no img-src entry in app.ts that is missing here', () => {
    const served = /'img-src':\s*\[([^\]]*)\]/.exec(SOURCE);
    expect(served).not.toBeNull();
    // Entries are JS string literals in either quote style — `"'self'"` is double-quoted BECAUSE
    // its value contains the single quotes that CSP keywords require.
    const entries = [...(served?.[1] ?? '').matchAll(/"([^"]*)"|'([^']*)'/g)].map(
      (match) => match[1] ?? match[2],
    );
    expect(entries).toEqual(imgSrc());
  });
});
