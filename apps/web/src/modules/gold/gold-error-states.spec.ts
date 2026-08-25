// No gold screen renders a failed request as a fact about the vault.
//
// WHY THIS EXISTS. Four of the twelve gold screens had no error branch at all. They guarded
// `isLoading`, then read `data?.x ?? []` — and under TanStack Query a SETTLED failure leaves
// `isLoading` false and `data` undefined, so the read fell straight through to the empty state.
//
// What each one then said out loud was worse than saying nothing:
//
//   · the vault board  — "this company holds no vaults"
//   · the dashboard    — a wall of zeroes, the most confident possible statement about a vault
//   · vault settings   — "no vaults configured", on the very screen you would use to create one
//                        that already exists
//   · the statements   — an empty balance sheet, which reads as "this client holds nothing"
//
// None of them is a network message. Each is a claim about the business, made from a failure.
//
// It also cost this investigation directly: those screens showing no error panel was read as
// evidence their endpoints answered 200, when in truth they CANNOT show an error panel.
//
// So this file holds the line by source inspection — a screen that binds a query result must also
// bind that query's failure. It is deliberately crude: it cannot prove the branch is correct, only
// that the screen has one, which is exactly the thing that was missing.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = resolve(dirname(fileURLToPath(import.meta.url)), 'pages');

const pages = readdirSync(PAGES)
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => ({ name, text: readFileSync(join(PAGES, name), 'utf8') }));

describe('every gold screen that reads a query also handles its failure', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(8);
  });

  it.each(pages)('$name', ({ text }) => {
    // A screen that never waits on a request has nothing to fail.
    const reads = /\.data\b/.test(text);
    if (!reads) return;
    expect(/isError/.test(text)).toBe(true);
  });

  it('renders the failure through the shared panel, not a bespoke one', () => {
    for (const page of pages) {
      if (!/isError/.test(page.text)) continue;
      // Either the shared ErrorState, or a DataTable given the query's error verbatim.
      const wired = /<ErrorState/.test(page.text) || /error=\{isError \? error : undefined\}/.test(page.text);
      expect(wired, page.name).toBe(true);
    }
  });
});
