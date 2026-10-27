// The page header's title line wraps rather than overflows (LIVE-4 of the ATM settlements review).
//
// At 1024 px the plan page's four long-labelled actions sat in a `shrink-0` row: a row that may not
// shrink never wraps, so it squeezed the title column to 0 px and ran off the screen (in Arabic
// past the left edge, where it cannot be scrolled to). The header now lets the line wrap: actions
// that do not fit beside the title take a line of their own, at its end, and wrap there.
//
// `apps/web` has no layout engine in its tests, so this pins the classes that make it so.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageContainer';

const html = renderToStaticMarkup(
  <PageHeader
    title="Title"
    figures={<span data-figures="true">3</span>}
    actions={<button type="button">Action</button>}
  />,
);
const classOf = (marker: string): string[] => {
  const at = html.indexOf(marker);
  const open = html.lastIndexOf('<div class="', at);
  return (/^<div class="([^"]*)"/.exec(html.slice(open))?.[1] ?? '').split(' ');
};

describe('the page header’s title line', () => {
  it('wraps from sm up, so actions that do not fit go to a line of their own', () => {
    // The row holding the title column and the actions: the parent of both.
    const row = (
      /<div class="([^"]*)"><div class="flex min-w-0 flex-wrap items-center gap-x-3/u.exec(
        html,
      )?.[1] ?? ''
    ).split(' ');
    expect(row).toContain('sm:flex-row');
    expect(row).toContain('sm:flex-wrap');
  });

  it('lets the action row shrink and wrap, at the line’s end — never `shrink-0`', () => {
    const actions = classOf('<button type="button">Action</button>');
    expect(actions).not.toContain('shrink-0');
    expect(actions).toContain('min-w-0');
    expect(actions).toContain('flex-wrap');
    expect(actions).toContain('sm:ms-auto');
    expect(actions).toContain('sm:justify-end');
  });
});
