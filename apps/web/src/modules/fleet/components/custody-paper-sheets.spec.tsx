// The papers on screen: one framed sheet per A4 page, at the licence memo's 0.8, the paper's own
// HTML inside — rendered without a DOM, so the first render is what a phone or a desk sees first.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PaperSheet, PaperTray, usePaperFonts } from './CustodyPaperSheets';
import { memoSheets } from '../lib/custody-papers';
import { SAMPLE_FUEL_LINES, SAMPLE_MEMOS } from '../lib/custody-paper-samples';

describe('PaperTray', () => {
  it('frames every page of a run-on memo, one under the other, at 0.8', () => {
    const sheets = memoSheets({
      ...SAMPLE_MEMOS.fuel,
      lines: [...SAMPLE_FUEL_LINES, ...SAMPLE_FUEL_LINES],
    });
    expect(sheets).toHaveLength(3);
    const html = renderToStaticMarkup(<PaperTray sheets={sheets} name="memo-3" />);
    expect(html).toContain('data-paper-tray="memo-3"');
    expect(html.match(/data-paper-page="memo-3:\d"/gu)).toEqual([
      'data-paper-page="memo-3:1"',
      'data-paper-page="memo-3:2"',
      'data-paper-page="memo-3:3"',
    ]);
    expect(html.match(/style="zoom:0.8;width:210mm"/gu)).toHaveLength(3);
    expect(html.match(/data-paper-sheet="true"/gu)).toHaveLength(3);
    // The grey tray in both themes, each sheet white.
    expect(html).toMatch(/class="[^"]*bg-slate-200[^"]*dark:bg-slate-800/u);
    expect(html).toMatch(/data-paper-page="memo-3:1"/u);
    expect(html).toContain('rounded bg-white shadow-xl');
  });

  it('numbers the pages when it is given no name', () => {
    const html = renderToStaticMarkup(<PaperTray sheets={memoSheets(SAMPLE_MEMOS.wash)} />);
    expect(html.match(/data-paper-page="\d"/gu)).toEqual(['data-paper-page="1"']);
  });
});

describe('PaperSheet', () => {
  it('draws the paper’s HTML as it is, never wider than its room', () => {
    const html = renderToStaticMarkup(<PaperSheet html="<p>ورقة</p>" mark="x" />);
    expect(html).toContain('data-paper-page="x"');
    expect(html).toContain('w-[640px] max-w-full');
    expect(html).toContain('<p>ورقة</p>');
  });
});

describe('usePaperFonts', () => {
  it('starts false — a paper drawn first estimates, and is drawn again once the faces are in', () => {
    const Probe = (): JSX.Element => <span>{String(usePaperFonts())}</span>;
    expect(renderToStaticMarkup(<Probe />)).toBe('<span>false</span>');
  });
});
