// Round 26 — every colour of «توزيع المحصنات» and «تسليم المحصنات», measured (WCAG 2) from Tailwind's own
// colours, light and dark: «عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز اوى العربيه والمحصنات اللى عليها
// والاعداد وكدا». The colours must help — and never cost a word its contrast.
//
//   · each van's accent: its code's pill reads at 4.5:1 or better in both themes; a محصنة's words read
//     at 4.5:1 or better on its van's thin ground; the stripe is the palette's own dot;
//   · each count's chip, a 0's grey chip, the محصنات badge, the time and direction pills, the
//     captain's line and mark: 4.5:1 or better, both themes;
//   · the four counts are four colours and four icons, and none is the captain's green.
import { describe, expect, it } from 'vitest';
import colors from 'tailwindcss/colors';
import { OPERATIONS_SHIFT_TYPE_COLOURS } from '@ecms/contracts';
import { ACCENT_TONE, COUNT_KINDS, VAN_ACCENT_ORDER } from '../lib/van-accent';
import {
  CAPTAIN_BAND,
  CAPTAIN_MARK,
  COUNT_LOOK,
  COUNT_ZERO,
  HEAD_PILL,
  SHIPMENTS_BADGE,
  VAN_ACCENT_LOOK,
} from './distribution-look';
import { SHIFT_TYPE_TONE } from './shift-type-look';

type Rgb = [number, number, number];
const hex = (value: string): Rgb =>
  [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb;
const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg: Rgb, alpha: number, ground: Rgb): Rgb =>
  fg.map((c, i) => c * alpha + (ground[i] as number) * (1 - alpha)) as Rgb;

const palette = colors as unknown as Record<string, Record<string, string> | string>;
const WHITE = hex('#ffffff');
/** The van card's ground (light), and the dark grounds a card or a hover card stands on. */
const LIGHT_GROUND = WHITE;
const DARK_GROUNDS = [hex('#111827'), hex('#131d35'), hex('#0b1226')];

/** One colour token — `rose-500`, `white`, `[#0b1226]`, with its alpha (`/15`, `/[0.12]`). */
const token = (value: string): { rgb: Rgb; alpha: number } => {
  const [name, alphaPart] = value.split('/') as [string, string | undefined];
  const alpha =
    alphaPart === undefined
      ? 1
      : alphaPart.startsWith('[')
        ? Number(alphaPart.slice(1, -1))
        : Number(alphaPart) / 100;
  if (name === 'white') return { rgb: WHITE, alpha };
  const arbitrary = /^\[(#[0-9a-fA-F]{6})\]$/.exec(name);
  if (arbitrary !== null) return { rgb: hex(arbitrary[1] as string), alpha };
  const dash = name.lastIndexOf('-');
  const family = palette[name.slice(0, dash)] as Record<string, string> | undefined;
  const shade = family?.[name.slice(dash + 1)];
  expect(shade, `colour «${value}»`).toBeDefined();
  return { rgb: hex(shade as string), alpha };
};

/** The one `kind-` utility a class list paints in a theme (light: no prefix; dark: `dark:`). */
const pick = (classes: string, kind: 'bg' | 'text', dark: boolean): string => {
  const own = classes
    .split(/\s+/)
    .filter((c) => (dark ? c.startsWith('dark:') : !c.includes(':')))
    .map((c) => c.replace(/^dark:/, ''))
    .filter((c) => c.startsWith(`${kind}-`) && !/^text-\[\d/.test(c));
  expect(own, `${kind} in «${classes}» (${dark ? 'dark' : 'light'})`).toHaveLength(1);
  return (own[0] as string).slice(kind.length + 1);
};

/** What the ground of a class list IS, over the ground under it. */
const ground = (classes: string, dark: boolean, under: Rgb): Rgb => {
  const { rgb, alpha } = token(pick(classes, 'bg', dark));
  return over(rgb, alpha, under);
};
/** Its words' colour — opaque only. */
const words = (classes: string, dark: boolean): Rgb => {
  const { rgb, alpha } = token(pick(classes, 'text', dark));
  expect(alpha, `opaque words in «${classes}»`).toBe(1);
  return rgb;
};

/** A class list's words on its own ground, over each ground it may stand on — the worst. */
const worst = (classes: string, dark: boolean): number =>
  Math.min(
    ...(dark ? DARK_GROUNDS : [LIGHT_GROUND]).map((under) =>
      contrast(words(classes, dark), ground(classes, dark, under)),
    ),
  );

describe('each van’s accent', () => {
  it('has a look for every palette colour — and nothing else', () => {
    expect(Object.keys(VAN_ACCENT_LOOK).sort()).toEqual([...OPERATIONS_SHIFT_TYPE_COLOURS].sort());
  });

  it('its stripe and swatch are the palette’s own dot — no parallel palette', () => {
    for (const colour of OPERATIONS_SHIFT_TYPE_COLOURS) {
      expect(VAN_ACCENT_LOOK[colour].bar, colour).toBe(SHIFT_TYPE_TONE[colour].dot);
    }
  });

  it('its code’s pill reads at 4.5:1 or better, light and dark', () => {
    for (const colour of OPERATIONS_SHIFT_TYPE_COLOURS) {
      for (const dark of [false, true]) {
        expect(
          worst(VAN_ACCENT_LOOK[colour].pill, dark),
          `${colour} ${dark ? 'dark' : 'light'}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('a dark stripe is a dark pill, a light one a light pill — the tone the order alternates is real', () => {
    for (const colour of OPERATIONS_SHIFT_TYPE_COLOURS) {
      const pill = token(pick(VAN_ACCENT_LOOK[colour].pill, 'bg', false)).rgb;
      if (ACCENT_TONE[colour] === 'dark') expect(luminance(pill), colour).toBeLessThan(0.2);
      else expect(luminance(pill), colour).toBeGreaterThan(0.28);
    }
  });

  it('a محصنة on the van: its bank and its branch read at 4.5:1 or better on the van’s thin ground', () => {
    for (const colour of OPERATIONS_SHIFT_TYPE_COLOURS) {
      const chip = VAN_ACCENT_LOOK[colour].chip;
      const light = ground(chip, false, LIGHT_GROUND);
      // The chip's words: the bank slate-900, the branch slate-600; white and slate-300 in dark.
      expect(contrast(token('slate-900').rgb, light), colour).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('slate-600').rgb, light), colour).toBeGreaterThanOrEqual(4.5);
      for (const under of DARK_GROUNDS) {
        const dark = ground(chip, true, under);
        expect(contrast(WHITE, dark), colour).toBeGreaterThanOrEqual(4.5);
        expect(contrast(token('slate-300').rgb, dark), colour).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the head’s band carries only pills on grounds of their own — the time, the direction, the code', () => {
    for (const pill of [HEAD_PILL.time, HEAD_PILL.direction, HEAD_PILL.none]) {
      for (const dark of [false, true]) {
        expect(token(pick(pill, 'bg', dark)).alpha, pill).toBe(1);
        expect(worst(pill, dark), `${pill} ${dark ? 'dark' : 'light'}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const colour of OPERATIONS_SHIFT_TYPE_COLOURS) {
      expect(token(pick(VAN_ACCENT_LOOK[colour].pill, 'bg', false)).alpha).toBe(1);
      expect(token(pick(VAN_ACCENT_LOOK[colour].pill, 'bg', true)).alpha).toBe(1);
      // The band is a thin wash of the colour, never solid.
      expect(token(pick(VAN_ACCENT_LOOK[colour].band, 'bg', false)).alpha).toBeLessThan(0.3);
      expect(token(pick(VAN_ACCENT_LOOK[colour].band, 'bg', true)).alpha).toBeLessThan(0.3);
    }
  });
});

/** sRGB → CIE L*a*b* (D65). */
const toLab = ([r, g, b]: Rgb): [number, number, number] => {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const f = (t: number): number =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t) / 116 + 16 / 116;
  const x = f((lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047);
  const y = f(lr * 0.2126 + lg * 0.7152 + lb * 0.0722);
  const z = f((lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
/** CIEDE2000 — how different two colours LOOK (about 2: barely; 10+: plainly; 20+: at a glance). */
const deltaE2000Lab = (
  [l1, a1, b1]: [number, number, number],
  [l2, a2, b2]: [number, number, number],
): number => {
  const rad = Math.PI / 180;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const [ap1, ap2] = [(1 + g) * a1, (1 + g) * a2];
  const [cp1, cp2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const hue = (b: number, a: number): number => {
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const [hp1, hp2] = [hue(b1, ap1), hue(b2, ap2)];
  let dhp = hp2 - hp1;
  if (cp1 * cp2 === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dhp * rad) / 2);
  const lBar = (l1 + l2) / 2;
  const cpBar = (cp1 + cp2) / 2;
  let hBar = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    hBar = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2) / 2;
    if (hBar >= 360) hBar -= 360;
  }
  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cpBar;
  const sh = 1 + 0.015 * cpBar * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  const [dl, dc, dh] = [(l2 - l1) / sl, (cp2 - cp1) / sc, dHp / sh];
  return Math.sqrt(dl ** 2 + dc ** 2 + dh ** 2 + rt * dc * dh);
};
const deltaE2000 = (one: Rgb, two: Rgb): number => deltaE2000Lab(toLab(one), toLab(two));
/** A van's stripe as it is painted — the palette's dot; its `dark:` shade in dark, where it has one. */
const stripe = (colour: (typeof VAN_ACCENT_ORDER)[number], dark: boolean): Rgb => {
  const dot = SHIFT_TYPE_TONE[colour].dot;
  return token(pick(dot, 'bg', dark && dot.includes('dark:'))).rgb;
};

describe('neighbouring vans differ at a glance — not only by their family’s name', () => {
  // R26 verify. «السيارات» lays its cards two (1024–1280), three (1366–1440) or FOUR (1920 — the
  // owner's screen) a row: the card beside is one place on, the card above two, three or four back.
  // The first order kept 3 apart but put crimson over brown (ΔE00 13) and violet over navy (13.8 in
  // dark) four apart — one above the other on the owner's 1920 screen.
  it('the stripes of two vans one to four places apart are ≥ 17 apart (CIEDE2000), light and dark', () => {
    for (let at = 0; at < VAN_ACCENT_ORDER.length; at += 1) {
      for (const step of [1, 2, 3, 4]) {
        if (at + step >= VAN_ACCENT_ORDER.length) continue;
        const here = VAN_ACCENT_ORDER[at] as (typeof VAN_ACCENT_ORDER)[number];
        const there = VAN_ACCENT_ORDER[at + step] as (typeof VAN_ACCENT_ORDER)[number];
        for (const dark of [false, true]) {
          expect(
            deltaE2000(stripe(here, dark), stripe(there, dark)),
            `${here} → +${step} ${there} (${dark ? 'dark' : 'light'})`,
          ).toBeGreaterThanOrEqual(17);
        }
      }
    }
  });

  it('a day of up to twelve vans: every neighbour ≥ 20 apart', () => {
    for (let at = 0; at < 12; at += 1) {
      for (const step of [1, 2, 3, 4]) {
        if (at + step >= 12) continue;
        const here = VAN_ACCENT_ORDER[at] as (typeof VAN_ACCENT_ORDER)[number];
        const there = VAN_ACCENT_ORDER[at + step] as (typeof VAN_ACCENT_ORDER)[number];
        for (const dark of [false, true]) {
          expect(
            deltaE2000(stripe(here, dark), stripe(there, dark)),
            `${here} → +${step} ${there} (${dark ? 'dark' : 'light'})`,
          ).toBeGreaterThanOrEqual(20);
        }
      }
    }
  });

  it('the measure itself: a colour against itself is 0, black against white is about 100', () => {
    // Sharma, Wu & Dalal (2005), the CIEDE2000 test data, pairs 1 and 7.
    expect(deltaE2000Lab([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE2000Lab([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 3);
    expect(deltaE2000(hex('#3b82f6'), hex('#3b82f6'))).toBeCloseTo(0, 6);
    expect(deltaE2000(hex('#000000'), hex('#ffffff'))).toBeGreaterThan(99);
    expect(deltaE2000(hex('#000000'), hex('#ffffff'))).toBeLessThan(101);
  });
});

describe('the counts — each its own colour and icon', () => {
  it('four kinds, four colours, four icons — and none is the captain’s green', () => {
    // R26 critic — a count's colour is its icon and its ring, on a light ground of its own.
    const hue = (kind: (typeof COUNT_KINDS)[number]) =>
      pick(COUNT_LOOK[kind].mark, 'text', false).split('-')[0];
    const hues = COUNT_KINDS.map(hue);
    expect(new Set(hues).size).toBe(4);
    expect(hues).not.toContain('emerald');
    expect(new Set(COUNT_KINDS.map((kind) => COUNT_LOOK[kind].icon.join(' '))).size).toBe(4);
    for (const kind of COUNT_KINDS) {
      expect(COUNT_LOOK[kind].chip, kind).toContain(`ring-${hue(kind)}-`);
    }
    // The محصنات: indigo, as the van card's badge — its ring and its icon.
    expect(hue('shipments')).toBe('indigo');
    expect(SHIPMENTS_BADGE.some).toContain('ring-indigo-');
  });

  it('R26 critic — a count is never drawn like a van: no solid ground, none of a van’s grounds', () => {
    // The first van of every day wore a solid indigo-600 code pill directly over the محصنات badge
    // in the very same solid indigo-600; teal's band and «حقائب»'s teal ground told nothing apart.
    // A van's colour is SOLID (its code) or a WASH (its band, its chips); a count is a light,
    // neutral ground — white, or the dark card's own navy — ringed and marked in its colour.
    const vanGrounds = new Set(
      Object.values(VAN_ACCENT_LOOK).flatMap((look) =>
        [look.pill, look.band, look.chip].flatMap((classes) => [
          pick(classes, 'bg', false),
          pick(classes, 'bg', true),
        ]),
      ),
    );
    const neutral = (classes: string, dark: boolean): void => {
      const bg = pick(classes, 'bg', dark);
      expect(vanGrounds.has(bg), `${bg} is a van's`).toBe(false);
      expect(bg, classes).toMatch(dark ? /^(\[#0b1226\]|white\/\[0\.0\d\])$/ : /^white$/);
    };
    for (const dark of [false, true]) {
      neutral(SHIPMENTS_BADGE.some, dark);
      for (const kind of COUNT_KINDS) neutral(COUNT_LOOK[kind].chip, dark);
    }
  });

  it('a count’s chip reads at 4.5:1 or better, light and dark; its icon at 3:1', () => {
    for (const kind of COUNT_KINDS) {
      const { chip, mark } = COUNT_LOOK[kind];
      expect(worst(chip, false), kind).toBeGreaterThanOrEqual(4.5);
      expect(worst(chip, true), kind).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(words(mark, false), ground(chip, false, LIGHT_GROUND)),
        kind,
      ).toBeGreaterThanOrEqual(3);
      for (const under of DARK_GROUNDS) {
        expect(contrast(words(mark, true), ground(chip, true, under)), kind).toBeGreaterThanOrEqual(
          3,
        );
      }
    }
  });

  it('R26 critic — a count’s figure, in its colour, reads at 4.5:1 or better on its light ground', () => {
    for (const kind of COUNT_KINDS) {
      const { chip, figure } = COUNT_LOOK[kind];
      expect(
        contrast(words(figure, false), ground(chip, false, LIGHT_GROUND)),
        kind,
      ).toBeGreaterThanOrEqual(4.5);
      for (const under of DARK_GROUNDS) {
        expect(
          contrast(words(figure, true), ground(chip, true, under)),
          kind,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // Its colour is its kind's — the icon's family.
      expect(pick(figure, 'text', false).split('-')[0]).toBe(
        pick(COUNT_LOOK[kind].mark, 'text', false).split('-')[0],
      );
    }
  });

  it('a 0 is written in grey — muted, still 4.5:1 or better', () => {
    expect(worst(COUNT_ZERO, false)).toBeGreaterThanOrEqual(4.5);
    expect(worst(COUNT_ZERO, true)).toBeGreaterThanOrEqual(4.5);
    for (const kind of COUNT_KINDS) {
      expect(pick(COUNT_ZERO, 'text', false)).not.toBe(pick(COUNT_LOOK[kind].chip, 'text', false));
    }
  });

  it('the محصنات badge before the captain — indigo, a 0 grey — reads at 4.5:1 or better', () => {
    for (const badge of [SHIPMENTS_BADGE.some, SHIPMENTS_BADGE.zero]) {
      expect(worst(badge, false), badge).toBeGreaterThanOrEqual(4.5);
      expect(worst(badge, true), badge).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the page’s figure squares draw each icon at 3:1 or better', () => {
    for (const kind of COUNT_KINDS) {
      const square = COUNT_LOOK[kind].square;
      expect(
        contrast(words(square, false), ground(square, false, LIGHT_GROUND)),
        kind,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the captain’s line stays the captain’s', () => {
  it('green, whatever the van’s colour — his name, his mark and «بلا قائد» readable on it', () => {
    // The name: slate-900 in light, white in dark, on the line's green.
    expect(
      contrast(token('slate-900').rgb, ground(CAPTAIN_BAND.some, false, LIGHT_GROUND)),
    ).toBeGreaterThanOrEqual(4.5);
    for (const under of DARK_GROUNDS) {
      expect(contrast(WHITE, ground(CAPTAIN_BAND.some, true, under))).toBeGreaterThanOrEqual(4.5);
      // «بلا قائد — لا تأخذ محصنات»: rose-300 on the red line.
      expect(
        contrast(token('rose-300').rgb, ground(CAPTAIN_BAND.none, true, under)),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(token('rose-700').rgb, ground(CAPTAIN_BAND.none, false, LIGHT_GROUND)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(pick(CAPTAIN_BAND.some, 'bg', false)).toMatch(/^emerald-/);
    // «قائد»: white on solid green.
    expect(worst(CAPTAIN_MARK, false)).toBeGreaterThanOrEqual(4.5);
    expect(worst(CAPTAIN_MARK, true)).toBeGreaterThanOrEqual(4.5);
  });
});
