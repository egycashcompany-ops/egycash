// Every colour of «توزيع المحصنات» and «تسليم المحصنات», measured (WCAG 2, and CIEDE2000 for how far
// apart two colours LOOK) from Tailwind's own colours, light and dark.
//
// Round 26 — «عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز اوى العربيه والمحصنات اللى عليها والاعداد
// وكدا»: the colours must help — and never cost a word its contrast.
//
// Round 26b — «لا استنى الالوان مش عجبانى بتاعت العربيه» → «لون واحد لكل العربيات», and «عاوز يبقى فى
// فرق فى الالوان بين الصندوق و الحقائب و الكراتين». Round 26's per-van accents and their order are gone
// (their specs with them: every palette colour's pill, a chip's words on each van's thin ground, the
// order's neighbours 17 or more apart). What is measured now:
//   · THE VAN — one look: its pill reads at 4.5:1 or better (it reads at 10:1) in both themes, its
//     band is a light wash under words that read at 4.5:1, its head's pills too; and it is slate —
//     almost no colour of its own — far from every colour that means something;
//   · THE COUNTS — four hues, FILLED, 20 or more apart (CIEDE2000) as solid marks and 10 or more as
//     grounds, in both themes, and as far from the van, the captain, a proposal and a refusal; every
//     figure and word at 4.5:1, every icon at 3:1; a 0 its own hue muted — its figure quieter, still
//     4.5:1 (it is 15px text; R26b verify: the 600 shades left «0 كراتين» at 3.4:1 by day);
//   · THE CAPTAIN'S FRAME, THE LOAD — their words at 4.5:1.
import { describe, expect, it } from 'vitest';
import colors from 'tailwindcss/colors';
import { COUNT_KINDS, PACKAGE_KINDS } from '../lib/van-card';
import {
  CAPTAIN_FRAME,
  CAPTAIN_MARK,
  COUNT_LOOK,
  HEAD_PILL,
  LOAD_LOOK,
  VAN_LOOK,
} from './distribution-look';

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

/** The worst of a list of grounds — light: the card's white; dark: each dark ground a card stands on. */
const groundsOf = (dark: boolean): Rgb[] => (dark ? DARK_GROUNDS : [LIGHT_GROUND]);

describe('the van — ONE look for every van (Round 26b — «لون واحد لكل العربيات»)', () => {
  it('is one look — no colour per van: one pill, one stripe, one band, whichever van it is', () => {
    expect(Object.keys(VAN_LOOK).sort()).toEqual(['band', 'pill', 'ring', 'stripe']);
    for (const value of Object.values(VAN_LOOK)) expect(typeof value).toBe('string');
  });

  it('is slate — the boards’ blue-grey ink, almost no colour of its own, the same pill in both themes', () => {
    for (const dark of [false, true]) {
      expect(pick(VAN_LOOK.pill, 'bg', dark)).toMatch(/^slate-/);
      expect(pick(VAN_LOOK.stripe, 'bg', dark)).toMatch(/^slate-/);
      expect(pick(VAN_LOOK.band, 'bg', dark)).toMatch(/^slate-/);
    }
    expect(pick(VAN_LOOK.pill, 'bg', false)).toBe(pick(VAN_LOOK.pill, 'bg', true));
    // Its chroma (CIE C*ab): a tint of blue, not a colour that could MEAN something.
    const [, a, b] = toLab(token(pick(VAN_LOOK.pill, 'bg', false)).rgb);
    expect(Math.hypot(a, b)).toBeLessThan(20);
  });

  it('its code’s pill reads at 4.5:1 or better — 10:1 — light and dark, on a solid ground', () => {
    for (const dark of [false, true]) {
      expect(token(pick(VAN_LOOK.pill, 'bg', dark)).alpha).toBe(1);
      expect(worst(VAN_LOOK.pill, dark), dark ? 'dark' : 'light').toBeGreaterThanOrEqual(10);
    }
  });

  it('its head’s band is a very light wash: words on it read at 4.5:1 or better, and so do its pills', () => {
    // Light: a solid slate-100 under the white card's words; dark: a thin wash of slate.
    expect(luminance(ground(VAN_LOOK.band, false, LIGHT_GROUND))).toBeGreaterThan(0.85);
    expect(token(pick(VAN_LOOK.band, 'bg', true)).alpha).toBeLessThan(0.15);
    // The card's words — slate-900 by day, white by night — on the band.
    expect(
      contrast(token('slate-900').rgb, ground(VAN_LOOK.band, false, LIGHT_GROUND)),
    ).toBeGreaterThanOrEqual(4.5);
    for (const under of DARK_GROUNDS) {
      expect(contrast(WHITE, ground(VAN_LOOK.band, true, under))).toBeGreaterThanOrEqual(4.5);
    }
    // The pill stands out of its band (3:1 — the band is the card's, the pill is the van).
    expect(
      contrast(
        token(pick(VAN_LOOK.pill, 'bg', false)).rgb,
        ground(VAN_LOOK.band, false, LIGHT_GROUND),
      ),
    ).toBeGreaterThanOrEqual(3);
    // The time, the direction, «بلا اتجاه»: each on a ground of its own, 4.5:1 or better.
    for (const pill of [HEAD_PILL.time, HEAD_PILL.direction, HEAD_PILL.none]) {
      for (const dark of [false, true]) {
        expect(token(pick(pill, 'bg', dark)).alpha, pill).toBe(1);
        expect(worst(pill, dark), `${pill} ${dark ? 'dark' : 'light'}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the time and the direction are calm — slate words, no hue of a count’s', () => {
    // Round 26's sky time and violet direction would now sit beside a cyan and a fuchsia count.
    for (const pill of [HEAD_PILL.time, HEAD_PILL.direction, HEAD_PILL.none]) {
      for (const dark of [false, true]) {
        expect(pick(pill, 'text', dark), pill).toMatch(/^(slate-\d+|white)$/);
      }
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
/** A count's solid mark (its icon), as painted in a theme. */
const markOf = (kind: (typeof COUNT_KINDS)[number], dark: boolean): Rgb =>
  words(COUNT_LOOK[kind].mark, dark);
/** A count's filled ground, as painted in a theme, over the card's ground. */
const chipGround = (kind: (typeof COUNT_KINDS)[number], dark: boolean, under: Rgb): Rgb =>
  ground(COUNT_LOOK[kind].chip, dark, under);

/**
 * The colours that already MEAN something on these screens, solid, as painted: the van (its pill),
 * the captain («قائد»), a proposal (its dashed amber edge — amber-500, amber-400 by night) and a
 * refusal (its rose mark — rose-600, rose-500 by night).
 */
const RESERVED = (dark: boolean): Record<string, Rgb> => ({
  van: token(pick(VAN_LOOK.pill, 'bg', dark)).rgb,
  captain: token(pick(CAPTAIN_MARK, 'bg', dark)).rgb,
  proposal: token(dark ? 'amber-400' : 'amber-500').rgb,
  refusal: token(dark ? 'rose-500' : 'rose-600').rgb,
});

describe('the counts — four hues, unmistakably apart (Round 26b)', () => {
  it('four kinds, four hues, four icons — محصنات blue, كراتين orange, حقائب cyan, صناديق fuchsia', () => {
    expect(COUNT_KINDS.map((kind) => COUNT_LOOK[kind].hue)).toEqual([
      'blue',
      'orange',
      'cyan',
      'fuchsia',
    ]);
    expect(new Set(COUNT_KINDS.map((kind) => COUNT_LOOK[kind].icon.join(' '))).size).toBe(4);
    // Each look is its own hue throughout — ground, ring, words, figure, icon; its 0 too.
    for (const kind of COUNT_KINDS) {
      const { hue, chip, figure, mark, zero, zeroFigure, square } = COUNT_LOOK[kind];
      for (const classes of [chip, figure, mark, zero, zeroFigure, square]) {
        for (const dark of [false, true]) {
          const own = classes
            .split(/\s+/)
            .filter((c) => (dark ? c.startsWith('dark:') : !c.includes(':')))
            .map((c) => c.replace(/^dark:/, ''))
            .filter((c) => /^(bg|text|ring)-/.test(c));
          for (const c of own) expect(c, `${kind}: ${classes}`).toContain(`-${hue}-`);
        }
      }
    }
  });

  it('a FILLED chip — a real ground of its colour, not a ring on white', () => {
    for (const kind of COUNT_KINDS) {
      const light = token(pick(COUNT_LOOK[kind].chip, 'bg', false));
      expect(light.alpha, kind).toBe(1);
      expect(pick(COUNT_LOOK[kind].chip, 'bg', false), kind).not.toMatch(/^(white|slate-)/);
      // Its own hue, visibly: 4 or more from the card's white (CIEDE2000).
      expect(deltaE2000(light.rgb, WHITE), kind).toBeGreaterThanOrEqual(4);
      expect(token(pick(COUNT_LOOK[kind].chip, 'bg', true)).alpha, kind).toBeGreaterThanOrEqual(
        0.12,
      );
    }
  });

  it('their marks are 20 or more apart, pairwise, light and dark (CIEDE2000)', () => {
    for (const dark of [false, true]) {
      COUNT_KINDS.forEach((one, at) => {
        for (const two of COUNT_KINDS.slice(at + 1)) {
          expect(
            deltaE2000(markOf(one, dark), markOf(two, dark)),
            `${one} ~ ${two} (${dark ? 'dark' : 'light'})`,
          ).toBeGreaterThanOrEqual(20);
        }
      });
    }
  });

  it('their grounds are 10 or more apart, pairwise — told apart by the ground alone', () => {
    for (const dark of [false, true]) {
      for (const under of groundsOf(dark)) {
        COUNT_KINDS.forEach((one, at) => {
          for (const two of COUNT_KINDS.slice(at + 1)) {
            expect(
              deltaE2000(chipGround(one, dark, under), chipGround(two, dark, under)),
              `${one} ~ ${two} (${dark ? 'dark' : 'light'})`,
            ).toBeGreaterThanOrEqual(10);
          }
        });
      }
    }
  });

  it('every count’s mark is 20 or more from the van, the captain, a proposal and a refusal', () => {
    for (const dark of [false, true]) {
      for (const [what, colour] of Object.entries(RESERVED(dark))) {
        for (const kind of COUNT_KINDS) {
          expect(
            deltaE2000(markOf(kind, dark), colour),
            `${kind} ~ ${what} (${dark ? 'dark' : 'light'})`,
          ).toBeGreaterThanOrEqual(20);
        }
      }
    }
  });

  it('its words and figure read at 4.5:1 or better on its ground, its icon at 3:1 — light and dark', () => {
    for (const kind of COUNT_KINDS) {
      const { chip, figure, mark } = COUNT_LOOK[kind];
      for (const dark of [false, true]) {
        expect(worst(chip, dark), `${kind} words`).toBeGreaterThanOrEqual(4.5);
        for (const under of groundsOf(dark)) {
          const on = ground(chip, dark, under);
          expect(contrast(words(figure, dark), on), `${kind} figure`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(words(mark, dark), on), `${kind} icon`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('a 0 keeps its hue, muted — a lighter ground, a quieter figure — its figure and words still 4.5:1', () => {
    for (const kind of COUNT_KINDS) {
      const { chip, zero, figure, zeroFigure, mark } = COUNT_LOOK[kind];
      // Lighter by day, thinner by night.
      expect(luminance(ground(zero, false, LIGHT_GROUND)), kind).toBeGreaterThan(
        luminance(ground(chip, false, LIGHT_GROUND)),
      );
      expect(token(pick(zero, 'bg', true)).alpha, kind).toBeLessThan(
        token(pick(chip, 'bg', true)).alpha,
      );
      for (const dark of [false, true]) {
        expect(worst(zero, dark), `${kind} 0 words`).toBeGreaterThanOrEqual(4.5);
        for (const under of groundsOf(dark)) {
          const on0 = ground(zero, dark, under);
          const on = ground(chip, dark, under);
          const quiet = contrast(words(zeroFigure, dark), on0);
          // R26b verify — the figure is 15px text, not large text: AA is 4.5:1 for it too (3:1 let
          // «0 كراتين» read at 3.4:1 and «0 حقائب» at 3.5:1 by day).
          expect(quiet, `${kind} 0 figure`).toBeGreaterThanOrEqual(4.5);
          // Quieter than a count's figure — muted, never louder.
          expect(quiet, `${kind} 0 figure`).toBeLessThan(contrast(words(figure, dark), on));
          expect(contrast(words(mark, dark), on0), `${kind} 0 icon`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('never one grey for the three packages’ zeros — each its own hue, apart', () => {
    // R26 wrote every 0 in the same grey: «0 كراتين», «0 حقائب», «0 صناديق» read as one thing.
    expect(new Set(PACKAGE_KINDS.map((kind) => COUNT_LOOK[kind].zero)).size).toBe(3);
    PACKAGE_KINDS.forEach((one, at) => {
      for (const two of PACKAGE_KINDS.slice(at + 1)) {
        expect(
          deltaE2000(
            words(COUNT_LOOK[one].zeroFigure, false),
            words(COUNT_LOOK[two].zeroFigure, false),
          ),
          `${one} ~ ${two}`,
        ).toBeGreaterThanOrEqual(20);
      }
    });
  });

  it('the page’s figure squares draw each icon at 3:1 or better', () => {
    for (const kind of COUNT_KINDS) {
      const square = COUNT_LOOK[kind].square;
      expect(
        contrast(words(square, false), ground(square, false, LIGHT_GROUND)),
        kind,
      ).toBeGreaterThanOrEqual(3);
      for (const under of DARK_GROUNDS) {
        expect(
          contrast(words(square, true), ground(square, true, under)),
          kind,
        ).toBeGreaterThanOrEqual(3);
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

describe('the captain’s own frame (Round 26b — «وافصل الاليطار بتاع القائد عن المحصنة»)', () => {
  it('green — his name, his mark and «بلا قائد» readable on it', () => {
    // The name: slate-900 in light, white in dark, on the frame's green.
    expect(
      contrast(token('slate-900').rgb, ground(CAPTAIN_FRAME.some, false, LIGHT_GROUND)),
    ).toBeGreaterThanOrEqual(4.5);
    for (const under of DARK_GROUNDS) {
      expect(contrast(WHITE, ground(CAPTAIN_FRAME.some, true, under))).toBeGreaterThanOrEqual(4.5);
      // «بلا قائد»: rose-300 on the red frame.
      expect(
        contrast(token('rose-300').rgb, ground(CAPTAIN_FRAME.none, true, under)),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(token('rose-700').rgb, ground(CAPTAIN_FRAME.none, false, LIGHT_GROUND)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(pick(CAPTAIN_FRAME.some, 'bg', false)).toMatch(/^emerald-/);
    // «قائد»: white on solid green.
    expect(worst(CAPTAIN_MARK, false)).toBeGreaterThanOrEqual(4.5);
    expect(worst(CAPTAIN_MARK, true)).toBeGreaterThanOrEqual(4.5);
  });

  it('is the captain’s green, far from every count — a count is never mistaken for his frame', () => {
    for (const dark of [false, true]) {
      const captain = token(pick(CAPTAIN_MARK, 'bg', dark)).rgb;
      for (const kind of COUNT_KINDS) {
        expect(deltaE2000(markOf(kind, dark), captain), kind).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

describe('the load — a bounded place of its own', () => {
  it('an empty load’s words, and a refusing van’s, read at 4.5:1 or better on its ground', () => {
    for (const dark of [false, true]) {
      for (const under of groundsOf(dark)) {
        expect(
          contrast(words(LOAD_LOOK.empty, dark), ground(LOAD_LOOK.area, dark, under)),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(worst(LOAD_LOOK.refuse, dark)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
