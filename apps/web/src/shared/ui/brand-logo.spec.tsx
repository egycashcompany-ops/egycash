// The EGYCASH logo, as the two components every screen draws it with.
//
// «عايزك تستخدم اللوجو دا بدل حرف الـ E اللى محطوط دا ! فى الموقع كله». The letter tile is gone;
// these pin what replaced it: the company's artwork as vector paths, the mark keeping the tile's
// heights so nothing laid out around it moves, and each version announced to assistive technology
// the way its surroundings need — the mark hidden where the name is written beside it, the logo
// with its lettering named where it IS the name.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';
import { EgycashLogo } from './EgycashLogo';
import { MARK_BAND_PATH, MARK_RIBBON_PATH } from './brand-mark-paths';
import { WORDMARK_PATH } from './egycash-wordmark-paths';

const paths = (html: string): number => html.match(/<path /g)?.length ?? 0;

describe('the mark', () => {
  it('is the artwork, not a letter', () => {
    const html = renderToStaticMarkup(<BrandMark />);
    expect(html.startsWith('<svg')).toBe(true);
    expect(html).toContain('viewBox="0 0 558 789"');
    // The ribbons, then the band drawn over them.
    expect(paths(html)).toBe(2);
    expect(html.indexOf(MARK_RIBBON_PATH)).toBeLessThan(html.indexOf(MARK_BAND_PATH));
    expect(html).not.toMatch(/>\s*E\s*</);
  });

  it('is decorative: every screen that shows it writes the product name beside it', () => {
    const html = renderToStaticMarkup(<BrandMark />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).not.toContain('role="img"');
  });

  it.each([
    ['sm', 'h-8'],
    ['md', 'h-10'],
    ['lg', 'h-12'],
  ] as const)(
    'keeps the old tile’s height at size %s (%s), its width following the artwork',
    (size, height) => {
      const html = renderToStaticMarkup(<BrandMark size={size} />);
      expect(html).toContain(height);
      expect(html).toContain('aspect-[558/789]');
      expect(html).toContain('w-auto');
    },
  );

  it('paints the artwork’s purples, lifted in dark mode', () => {
    const html = renderToStaticMarkup(<BrandMark />);
    expect(html).toContain('fill-[#3e4097] dark:fill-[#8c90e0]');
    expect(html).toContain('fill-[#5d60a9] dark:fill-[#b5b8ec]');
  });

  it('turns white on the brand gradient, where any purple would disappear', () => {
    const html = renderToStaticMarkup(<BrandMark variant="onBrand" />);
    expect(html).toContain('fill-white/[0.72]');
    expect(html).toContain('class="fill-white"');
    expect(html).not.toContain('#3e4097');
  });
});

describe('the logo with its name', () => {
  it('names the company to assistive technology, since it is the name on the screen', () => {
    const html = renderToStaticMarkup(<EgycashLogo />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="EGYCASH"');
  });

  it('carries the mark and the lettering, the lettering centred on the mark', () => {
    const html = renderToStaticMarkup(<EgycashLogo />);
    expect(html).toContain('viewBox="0 0 2000 669"');
    // The ribbons, the band, the lettering.
    expect(paths(html)).toBe(3);
    expect(html).toContain(WORDMARK_PATH);
    // (669 − 312 × 0.8508) / 2: the lettering's height, scaled, centred in the mark's.
    expect(html).toContain('translate(571 201.8)');
  });

  it('follows the theme by default: navy lettering on light, white on dark', () => {
    const html = renderToStaticMarkup(<EgycashLogo />);
    expect(html).toContain('fill-[#222566] dark:fill-slate-50');
  });

  it('is all white when reversed onto a panel that stays dark in both themes', () => {
    const html = renderToStaticMarkup(<EgycashLogo tone="white" />);
    expect(html).not.toContain('dark:');
    expect(html).not.toContain('#222566');
    expect(html).toContain('fill-white/[0.72]');
  });

  it('takes its height from the caller and keeps the artwork’s proportions', () => {
    const html = renderToStaticMarkup(<EgycashLogo className="h-14 self-start" />);
    expect(html).toContain('aspect-[2000/669]');
    expect(html).toContain('h-14 self-start');
  });
});
