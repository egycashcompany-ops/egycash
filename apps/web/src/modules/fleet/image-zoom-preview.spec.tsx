// The licence scan is READ on this screen, so it has to be readable.
//
// «الرخصه بعيده ولما عملت زوم بيكبر المتصفح ومش بيكبر الصوره». Two halves to that: the dialog was
// `md` — a 32rem box for a document — and the picture inside it had no zoom of its own, so the
// only tool was the browser's, which enlarges the page and not the scan.
//
// The arithmetic is proved in `lib/image-zoom.spec.ts`. What is proved here is that the controls
// exist, that they say what they do in both catalogues, and that all THREE previews — the car's,
// the driver's, and the file a driver is being enrolled with — got the same surface in the same
// widened frame. A zoom on one of the three is the defect wearing a smaller hat.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { ZoomableImage } from './components/ZoomableImage';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(HERE, path), 'utf8');
/** Source with comments stripped: a call named only in prose must not keep a guard green. */
const code = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const store = (locale: Locale) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: {
        me: { id: 'u1', permissions: {} } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (locale: Locale = 'ar'): string =>
  renderToStaticMarkup(
    <Provider store={store(locale)}>
      <ZoomableImage src="blob:scan" alt="رخصة" />
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);

describe('the zoom surface', () => {
  it('offers zoom in, zoom out and «ملء الإطار» as real buttons', () => {
    const markup = render();
    for (const hook of ['data-zoom-in', 'data-zoom-out', 'data-zoom-reset']) {
      const at = markup.indexOf(hook);
      expect(at, hook).toBeGreaterThan(-1);
      expect(markup.lastIndexOf('<button', at), `${hook} is a button`).toBeGreaterThan(
        markup.lastIndexOf('<span', at),
      );
    }
    for (const key of [
      'fleet.licenseImage.zoomIn',
      'fleet.licenseImage.zoomOut',
      'fleet.licenseImage.zoomReset',
    ]) {
      expect(markup, key).toContain(t(key));
    }
  });

  it('opens at 100٪, with the picture whole', () => {
    const markup = render();
    // «١٠٠٪» — the readout in the reader's own digits, and the percent glyph from the catalogue
    // rather than a literal in the component, because it is not the same glyph in English.
    expect(markup).toContain('١٠٠٪');
    expect(render('en'), 'and the English one says 100%').toContain('100%');
    expect(markup, 'the transform is the identity at fit').toContain('translate(0px, 0px) scale(1)');
  });

  it('greys out «تصغير» and the reset while there is nothing to undo', () => {
    // A control that cannot do anything must not look like it can: at fit, out and reset are
    // both no-ops, and only «تكبير» has work to do.
    const markup = render();
    const tag = (hook: string): string => {
      const at = markup.indexOf(hook);
      return markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('>', at) + 1);
    };
    // The ATTRIBUTE, not the word: the class list carries `disabled:opacity-40` on all three.
    expect(tag('data-zoom-out'), 'zoom out').toContain('disabled=""');
    expect(tag('data-zoom-reset'), 'reset').toContain('disabled=""');
    expect(tag('data-zoom-in'), 'zoom in is live').not.toContain('disabled=""');
  });

  it('says how to zoom without reading a manual', () => {
    expect(render()).toContain(t('fleet.licenseImage.zoomHint'));
  });

  it('is reachable by keyboard and announced', () => {
    const markup = render();
    const surface = markup.slice(markup.indexOf('data-zoom-surface'), markup.indexOf('<img'));
    expect(surface, 'focusable').toContain('tabindex="0"');
    expect(markup, 'named for a screen reader').toContain('aria-label="رخصة"');
  });

  it('takes the wheel with a NON-passive listener, or the page scrolls underneath it', () => {
    // React registers `onWheel` passively at the root, and a passive listener may not call
    // `preventDefault` — so the browser would zoom the page on ctrl+wheel while the picture
    // zoomed too. The listener is attached by hand for exactly this.
    const source = code('components/ZoomableImage.tsx');
    expect(source).toContain("addEventListener('wheel'");
    expect(source).toContain('{ passive: false }');
    expect(source).toContain('event.preventDefault()');
    expect(source, 'and it is removed again').toContain("removeEventListener('wheel'");
  });

  it('keeps the arithmetic in the library, not in the component', () => {
    // The rules are testable; the DOM is not. A second copy of the clamping here is how the two
    // drift into disagreeing about where the picture may go.
    const source = code('components/ZoomableImage.tsx');
    expect(source).toContain("from '../lib/image-zoom'");
    expect(source, 'no hand-rolled clamping').not.toMatch(/Math\.(min|max)\(/);
  });

  it('opens every NEW picture at fit', () => {
    // Otherwise the next driver's scan arrives at the last one's magnification, in a corner.
    const source = code('components/ZoomableImage.tsx');
    const at = source.indexOf('setZoom(FIT);');
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at, at + 60), 'keyed on the image itself').toContain('}, [src]);');
  });
});

describe('all three previews were fixed, not one', () => {
  const VEHICLE = code('components/VehicleLicenseImage.tsx');
  const DRIVER = code('components/DriverLicenseImage.tsx');

  it('the car’s scan, the driver’s scan and the one being enrolled all use the surface', () => {
    expect(VEHICLE, 'the vehicle preview').toContain('<ZoomableImage');
    // Two on the drivers side: the saved scan, and the file staged in the enrol dialog.
    expect(DRIVER.split('<ZoomableImage').length - 1, 'both driver previews').toBe(2);
  });

  it('leaves no plain 60vh <img> preview behind', () => {
    for (const [name, source] of [['vehicle', VEHICLE], ['driver', DRIVER]] as const) {
      expect(source, `${name}: the old fixed-height preview is gone`).not.toContain('max-h-[60vh]');
    }
  });

  it('widens the frame the scan sits in — a document, not a form', () => {
    expect(VEHICLE, 'vehicle preview').toContain('size="xl"');
    expect(DRIVER.split('size="xl"').length - 1, 'both driver previews').toBe(2);
  });

  it('keeps the THUMBNAILS small — the zoom belongs to the preview, not to a table cell', () => {
    // The 64px chips in the drivers list open the dialog; turning them into zoom surfaces would
    // put a scroll trap in a table row.
    expect(DRIVER).toContain('h-16 w-auto');
  });
});
