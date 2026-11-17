// The production properties of IT's phone screens — the Operations captain surface's rules
// (`operations/mobile/mobile-quality.spec.tsx`), unchanged, applied to the files of this folder
// (docs/12-planning/it-vehicle-checks-design.md §6.3). The frame itself is the shared `PhoneShell`,
// so the frame's rules read that file.
//
// Each rule is a real failure mode on a phone held in one hand beside a car:
//   · a layout that overflows sideways at 360px, so the action is off-screen;
//   · a target too small to hit one-handed;
//   · a control that is only an icon, with no name;
//   · English leaking into an Arabic screen;
//   · state kept in the browser where a reload would find a stale copy — with exactly one
//     exception, the form's own draft, which exists so a reload does NOT lose the form.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MOBILE = fileURLToPath(new URL('.', import.meta.url));
const SOURCES = readdirSync(MOBILE).filter((f) => /\.tsx?$/.test(f) && !f.includes('.spec.'));
const sourceOf = (file: string): string => readFileSync(`${MOBILE}${file}`, 'utf8');
/** The same file with comments removed: prose about what a file does NOT do must not trip a rule. */
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const codeOf = (file: string): string => strip(sourceOf(file));

const SHELL = fileURLToPath(new URL('../../../shared/ui/PhoneShell.tsx', import.meta.url));
const shellSource = (): string => readFileSync(SHELL, 'utf8');

/** The one file allowed to touch browser storage: the form's draft (§2 item 8). */
const DRAFT = 'vehicle-check-draft.ts';

describe('the folder holds the phone form', () => {
  it('reads the screens it is about — a guard over nothing passes forever', () => {
    for (const file of [
      'VehicleCheckPage.tsx',
      'VehicleCheckCarPicker.tsx',
      'VehicleCheckAnswer.tsx',
      'VehicleCheckPhotos.tsx',
      'VehicleCheckSent.tsx',
      DRAFT,
    ]) {
      expect(SOURCES, file).toContain(file);
    }
  });
});

describe('mobile-first, not a narrowed desktop', () => {
  it('never fixes a width the smallest target screen cannot hold', () => {
    for (const file of SOURCES) {
      const text = sourceOf(file);
      expect(text, file).not.toMatch(/\bmin-w-\[(4[0-9]{2}|[5-9][0-9]{2})px\]/);
      expect(text, file).not.toMatch(/\bw-\[(4[0-9]{2}|[5-9][0-9]{2})px\]/);
    }
  });

  it('constrains the page by max-width, so a wide phone or a tablet does not stretch a line', () => {
    expect(shellSource()).toContain('max-w-2xl');
  });

  it('measures the viewport with dvh, not vh', () => {
    expect(strip(shellSource())).toContain('min-h-dvh');
    expect(strip(shellSource())).not.toContain('min-h-screen');
    for (const file of SOURCES) expect(codeOf(file), file).not.toContain('min-h-screen');
  });

  it('does not mount the desktop console shell', () => {
    for (const file of SOURCES) {
      expect(codeOf(file), file).not.toContain('AppShell');
    }
  });

  it('gives the primary action a thumb-sized target', () => {
    // 48px — the smallest reliably hittable target one-handed, standing up.
    expect(sourceOf('VehicleCheckPage.tsx')).toContain('min-h-12');
    // …and each «يعمل / لا يعمل», tapped eleven times a report.
    expect(sourceOf('VehicleCheckAnswer.tsx')).toContain('min-h-12');
  });
});

describe('accessibility and RTL', () => {
  it('gives every icon-only control a label', () => {
    // The back arrow (the frame's) and a photo's ✕ are the controls here with no visible text.
    expect(shellSource()).toContain('aria-label=');
    expect(sourceOf('VehicleCheckPhotos.tsx')).toMatch(
      /aria-label=\{t\('it\.vehicleCheck\.photos\.remove'\)\}/,
    );
  });

  it('names each pair of answers by its device, and tells the answers apart by more than colour', () => {
    const answer = codeOf('VehicleCheckAnswer.tsx');
    expect(answer).toContain('role="radiogroup"');
    expect(answer).toContain('aria-label={label}');
    expect(answer).toContain('aria-checked={on}');
    // ✓ for «يعمل», ✕ for «لا يعمل» — the icon says it as well as the green and the red.
    expect(answer).toContain('CheckIcon');
    expect(answer).toContain('CloseIcon');
  });
});

describe('the Arabic screen is Arabic', () => {
  it('routes every visible string through the translation table', () => {
    // A literal in JSX is a string that cannot be translated. «DVR» is three letters and comes from
    // the dictionary like every other label.
    for (const file of SOURCES) {
      const jsxText = [
        ...codeOf(file).matchAll(/(?<![=-])>\s*([A-Za-z][A-Za-z ,.'’-]{3,})\s*</g),
      ].map((m) => m[1]);
      expect(jsxText, file).toEqual([]);
    }
  });
});

describe('a reload tells the truth', () => {
  it('keeps nothing in browser storage — but the form’s own draft', () => {
    for (const file of SOURCES.filter((f) => f !== DRAFT)) {
      expect(sourceOf(file), file).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it('keeps the draft in the TAB’s storage, never the browser’s long-lived one', () => {
    const draft = codeOf(DRAFT);
    expect(draft).toContain('sessionStorage');
    expect(draft).not.toMatch(/localStorage|indexedDB/);
  });
});
