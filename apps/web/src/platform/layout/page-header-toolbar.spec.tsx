// The page's own row on the title's line (the ATM screens, 2026-11-02: «عايز تطلع الصف بتاع الـ
// Form يبقي بجانب العنوان عشان نستفيد بالمساحة»). `apps/web` has no layout engine in its tests, so
// this pins the classes that make it so:
//
//   · from `lg` the title, the row and the actions share one line, in that order, and the row
//     grows into the width left and wraps INSIDE itself (`min-w-0`) rather than pushing anything
//     off the line;
//   · below `lg` the title and the actions keep the first line and the row takes the next whole;
//   · a header without a toolbar renders exactly as before.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageContainer';

const withToolbar = renderToStaticMarkup(
  <PageHeader
    title="Title"
    figures={<span data-figures="true">3</span>}
    actions={<button type="button">Action</button>}
    toolbar={<form data-band="true" />}
  />,
);
const classOf = (markup: string, marker: string): string[] => {
  const at = markup.indexOf(marker);
  const open = markup.lastIndexOf('<div class="', at);
  return (/^<div class="([^"]*)"/.exec(markup.slice(open))?.[1] ?? '').split(' ');
};

describe('a page header with a toolbar', () => {
  it('puts the row in the header, wrapped in its own slot', () => {
    expect(withToolbar).toContain('data-page-toolbar="true"');
    expect(withToolbar.indexOf('data-page-toolbar')).toBeLessThan(withToolbar.indexOf('data-band'));
  });

  it('from lg: title, row, actions on one line — the row growing and wrapping inside itself', () => {
    // The line: the parent of the title's cell.
    const line = (/<div class="([^"]*)"><div class="order-1/.exec(withToolbar)?.[1] ?? '').split(
      ' ',
    );
    expect(line).toEqual(expect.arrayContaining(['flex', 'flex-wrap']));
    // The line may wrap at every width: a row that cannot keep 24rem beside a wide title and
    // wide actions takes a line of its own rather than being squeezed over them.
    expect(line).not.toContain('lg:flex-nowrap');
    const toolbar = classOf(withToolbar, '<form data-band');
    expect(toolbar).toEqual(
      expect.arrayContaining([
        'min-w-0',
        'basis-full',
        'lg:order-2',
        'lg:flex-1',
        'lg:basis-0',
        'lg:min-w-[24rem]',
      ]),
    );
    const title = classOf(withToolbar, '<h1 ');
    expect(title).toEqual(expect.arrayContaining(['order-1', 'lg:shrink-0']));
    const actions = classOf(withToolbar, '<button type="button">Action</button>');
    expect(actions).toEqual(
      expect.arrayContaining(['order-2', 'lg:order-3', 'ms-auto', 'min-w-0']),
    );
  });

  it('below lg: the row takes a line of its own, after the title and the actions', () => {
    const toolbar = classOf(withToolbar, '<form data-band');
    expect(toolbar).toContain('order-3');
    expect(toolbar).toContain('basis-full');
  });

  it('keeps less space under itself — the height goes back to the table', () => {
    const outer = (/^<div class="([^"]*)"/.exec(withToolbar)?.[1] ?? '').split(' ');
    expect(outer).toContain('mb-2');
    expect(outer).not.toContain('mb-6');
  });

  it('a header without a toolbar is exactly what it was', () => {
    const plain = renderToStaticMarkup(
      <PageHeader title="Title" actions={<button type="button">Action</button>} />,
    );
    expect(plain).not.toContain('data-page-toolbar');
    expect(plain).not.toContain('order-1');
    expect(plain).toMatch(/^<div class="[^"]*\bmb-6\b[^"]*\bpb-5\b/);
  });
});
