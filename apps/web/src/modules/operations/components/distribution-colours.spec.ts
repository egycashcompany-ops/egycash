// Every colour of «توزيع المحصنات» and «تسليم المحصنات», measured (WCAG 2, and CIEDE2000 for how far
// apart two colours LOOK) from Tailwind's own colours, light and dark.
//
// Round 26 — «عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز اوى العربيه والمحصنات اللى عليها والاعداد
// وكدا»: the colours must help — and never cost a word its contrast. Round 26b — «لون واحد لكل
// العربيات» and «عاوز يبقى فى فرق فى الالوان بين الصندوق و الحقائب و الكراتين».
//
// Round 27 — the owner's colours on Round 26b's card: «يعني انا عايز ناخد الالوان نطبقها على الديزاين
// الموجود، ما نعملش شبه الديزاين ده». What is measured now:
//   · THE VAN — one look: a blue-outlined code pill on a soft blue tint, its words 10:1 or better and
//     its edge 3:1 on the band, both themes; the time neutral, the direction sky — each opaque, its
//     words 4.5:1, its icon 3:1, the direction's edge 3:1;
//   · THE CARD'S STATES — «بلا قائد» a rose edge, a kept row a dashed amber one, each 3:1 or better
//     against the column it stands on, each with a glow of its own colour, its stripe in it;
//   · THE COUNTS — OUTLINED tiles: محصنات cyan, كراتين amber, حقائب blue, صناديق purple; each edge
//     3:1 or better against the card (and every dark ground a tile stands on), their icons 20 or more
//     apart (CIEDE2000), their edges 15, their grounds 10 by day and 7 by night (the design's own
//     tinted grounds are 8.4 apart at their closest — the outline and the icon carry the hue now);
//     the محصنات' cyan far from the captain's emerald beside it; every figure and word 4.5:1, every
//     icon 3:1; a 0 its own colour and edge, PLAINLY quieter (R27 critic — figure, words, ground,
//     and by night its edge), its figure still 4.5:1 — on every ground a count stands on, the
//     three packages also on «تسليم»'s confirmation (R27 critic);
//   · THE CHIPS — on a van a dark row with a cyan dot, on no van a dashed rose edge (3:1) on a rose
//     tint with a rose dot, words 4.5:1 on every ground, dots 3:1; the rose head of their column;
//   · THE CAPTAIN'S FRAME (unchanged), THE LOAD, THE KEPT NOTICE — their words at 4.5:1.
//
// Round 27d — the owner on Round 27's screens: «اعملى نسخة واحدة بس من الشاشة بس تكون بالوان اهدى».
// The same hues in the same roles, calmer — and measured so: no coloured glow on the board (the
// look's tokens and the classes the two screens write — not the app's shared brand buttons); every
// word still 4.5:1, every icon and dot 3:1, and the two STATES' edges («بلا قائد», a kept row) still
// 3:1 on their column — they are the card's state at a glance. What changed, each on purpose:
//   · the edges that only DRAW a shape — a count's tile, a 0's, the code pill, the head's pills, a
//     chip on no van — are a breath of their hue now (by day x-200/300, by night x-400 at about a
//     third): WCAG 1.4.11 asks nothing of a container's outline, and none of them is the only sign of
//     anything (the words, the icon, the dot say it). Their 3:1 checks give way to «still drawn» (a
//     ΔE floor) and «quiet» (a contrast ceiling of 2.75:1);
//   · a count's word is neutral slate, its 0 neutral grey throughout — only the 0's icon keeps a
//     faint hue (`zeroMark`), and the three packages' 0 icons stand 20 or more apart (R26's «one grey
//     for every 0» is answered by the icon now, not the figure);
//   · the distances calmer tints legitimately shrink — each relaxed where it is measured, with why:
//     these are THRESHOLDS lowered, not colours retuned (R27d critic), and each is one the owner's
//     «اهدى» cannot keep — a fainter tint or edge is, by measure, closer to its neighbour;
//   · R27d critic — what was relaxed and need not be is restored: a 0's figure 2.5:1 under its
//     count's again (the cyan and amber figures x-900 by day), and a 0's ICON is now measured too —
//     1:1 or more under its count's (the bags' icon blue-900 and the boxes' purple-600 by day).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import colors from 'tailwindcss/colors';
import { COUNT_KINDS, PACKAGE_KINDS } from '../lib/van-card';
import {
  CAPTAIN_FRAME,
  CAPTAIN_MARK,
  CHIP_DOT,
  CHIP_LOOK,
  CHIP_WORDS,
  COLUMN_WARN,
  COUNT_LOOK,
  HEAD_PILL,
  KEPT_NOTICE,
  LOAD_LOOK,
  VAN_CARD,
  VANS_FIGURE,
  VAN_LOOK,
  VAN_STATE_STRIPE,
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
/** The van card's ground by day. */
const LIGHT_GROUND = WHITE;
/** The van card's ground by night — the owner's deep navy (`VAN_CARD.rest`). */
const CARD_DARK = hex('#111a2e');
/**
 * The dark grounds a tile, a pill or a chip may stand on: the van card, the hover card, the page's
 * figure pill, the columns.
 */
const DARK_GROUNDS = [CARD_DARK, hex('#131d35'), hex('#111827'), hex('#0b1226')];
/** A column's ground — what a van card, and a chip on no van, stands on. */
const COLUMN_GROUND = (dark: boolean): Rgb[] =>
  dark ? [hex('#0b1226')] : [WHITE, hex((palette.slate as Record<string, string>)['50'] as string)];
/**
 * R27 critic — «تسليم»'s confirmation, where the three PACKAGE counts stand (`MoneyLine`): its
 * section is `#0a1233/80` on the dialog's panel (`#121c3f/95`) over the dimmed page (the backdrop
 * `#03060c/80` on the page's `#0b1226`) — about rgb(11,20,53) by night; `slate-50` by day.
 */
const CONFIRM_GROUND = (dark: boolean): Rgb =>
  dark
    ? over(
        hex('#0a1233'),
        0.8,
        over(hex('#121c3f'), 0.95, over(hex('#03060c'), 0.8, hex('#0b1226'))),
      )
    : hex((palette.slate as Record<string, string>)['50'] as string);

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

/** The utilities of a class list one theme paints (light: no prefix; dark: `dark:`). */
const own = (classes: string, dark: boolean): string[] =>
  classes
    .split(/\s+/)
    .filter((c) => (dark ? c.startsWith('dark:') : !c.includes(':')))
    .map((c) => c.replace(/^dark:/, ''));
/** The one colour of `kind` a class list paints in a theme. */
const pick = (classes: string, kind: 'bg' | 'text' | 'ring' | 'border', dark: boolean): string => {
  const found = own(classes, dark).filter(
    (c) =>
      c.startsWith(`${kind}-`) &&
      !/^text-\[\d/.test(c) &&
      !/^(ring|border)-(\d|inset|offset|dashed|solid|dotted|[xytbsel]-)/.test(c) &&
      c !== 'border' &&
      c !== 'ring',
  );
  expect(found, `${kind} in «${classes}» (${dark ? 'dark' : 'light'})`).toHaveLength(1);
  return (found[0] as string).slice(kind.length + 1);
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
/** Its edge (a ring or a border) as painted over what is under it. */
const edge = (classes: string, kind: 'ring' | 'border', dark: boolean, under: Rgb): Rgb => {
  const { rgb, alpha } = token(pick(classes, kind, dark));
  return over(rgb, alpha, under);
};
/** A dot's (or a stripe's) solid colour. */
const fill = (classes: string, dark: boolean, under: Rgb): Rgb => ground(classes, dark, under);

/** The grounds a class list may stand on in a theme. */
const groundsOf = (dark: boolean): Rgb[] => (dark ? DARK_GROUNDS : [LIGHT_GROUND]);
/** The grounds a count of a kind stands on — a package's also on «تسليم»'s confirmation. */
const groundsFor = (kind: (typeof COUNT_KINDS)[number], dark: boolean): Rgb[] =>
  (PACKAGE_KINDS as readonly string[]).includes(kind)
    ? [...groundsOf(dark), CONFIRM_GROUND(dark)]
    : groundsOf(dark);
/** A class list's words on its own ground, over each ground it may stand on — the worst. */
const worst = (classes: string, dark: boolean, unders: Rgb[] = groundsOf(dark)): number =>
  Math.min(...unders.map((under) => contrast(words(classes, dark), ground(classes, dark, under))));

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
/** A colour's hue angle (CIE h°ab). */
const hueAngle = (rgb: Rgb): number => {
  const [, a, b] = toLab(rgb);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};

/** The band a van's head stands on, in a theme, over the card. */
const bandOf = (dark: boolean): Rgb => ground(VAN_LOOK.band, dark, dark ? CARD_DARK : WHITE);

describe('the van — ONE look for every van, the owner’s blue (Round 27)', () => {
  it('is one look — no colour per van: one stripe, one band, one pill, its edge and its truck', () => {
    expect(Object.keys(VAN_LOOK).sort()).toEqual(['band', 'icon', 'pill', 'ring', 'stripe']);
    for (const value of Object.values(VAN_LOOK)) expect(typeof value).toBe('string');
  });

  it('its code: a soft blue tint, a blue edge, the stripe blue — the design’s pill', () => {
    for (const dark of [false, true]) {
      expect(pick(VAN_LOOK.pill, 'bg', dark)).toMatch(/^blue-/);
      expect(pick(VAN_LOOK.ring, 'ring', dark)).toMatch(/^blue-/);
      expect(pick(VAN_LOOK.stripe, 'bg', dark)).toMatch(/^blue-/);
    }
    // A tint, never a solid slab: light by day, a fifth of blue by night.
    expect(luminance(ground(VAN_LOOK.pill, false, bandOf(false)))).toBeGreaterThan(0.85);
    expect(token(pick(VAN_LOOK.pill, 'bg', true)).alpha).toBeLessThanOrEqual(0.25);
    // Round 27d — its number neutral: slate by day, near-white by night (was blue-950 / white).
    expect(pick(VAN_LOOK.pill, 'text', false)).toMatch(/^slate-/);
    expect(pick(VAN_LOOK.pill, 'text', true)).toMatch(/^slate-(50|100)$/);
    // Round 27d — no glow (Round 27's soft blue glow is gone).
    expect(VAN_LOOK.ring).not.toMatch(/shadow/);
  });

  it('its code reads at 10:1 or better on its tint, light and dark; its truck at 3:1', () => {
    for (const dark of [false, true]) {
      const on = ground(VAN_LOOK.pill, dark, bandOf(dark));
      expect(
        contrast(words(VAN_LOOK.pill, dark), on),
        dark ? 'dark' : 'light',
      ).toBeGreaterThanOrEqual(10);
      expect(contrast(words(VAN_LOOK.icon, dark), on), 'truck').toBeGreaterThanOrEqual(3);
    }
  });

  it('Round 27d — the pill’s blue edge is quiet, and the pill is still DRAWN on the band — both themes', () => {
    // R26b critic: a `white/15` edge left the van's code a dark slab by night. Round 27 answered with
    // a 3:1 blue ring and a glow; Round 27d («بالوان اهدى») keeps the pill drawn by a faint blue edge
    // AND its own tint — each plainly apart from the band (CIEDE2000) — under a quiet ceiling. The
    // code itself reads at 10:1 (above); the edge is never the only thing that says «a van's code».
    for (const dark of [false, true]) {
      const theme = dark ? 'dark' : 'light';
      const band = bandOf(dark);
      const pill = ground(VAN_LOOK.pill, dark, band);
      const ring = edge(VAN_LOOK.ring, 'ring', dark, pill);
      expect(deltaE2000(ring, band), `edge ${theme}`).toBeGreaterThanOrEqual(10);
      expect(deltaE2000(pill, band), `tint ${theme}`).toBeGreaterThanOrEqual(3);
      expect(contrast(ring, band), `quiet ${theme}`).toBeLessThanOrEqual(2.75);
    }
  });

  it('its head’s band is barely a wash: words on it read at 4.5:1 or better', () => {
    expect(luminance(bandOf(false))).toBeGreaterThan(0.85);
    expect(token(pick(VAN_LOOK.band, 'bg', true)).alpha).toBeLessThan(0.15);
    expect(contrast(token('slate-900').rgb, bandOf(false))).toBeGreaterThanOrEqual(4.5);
    for (const under of DARK_GROUNDS) {
      expect(contrast(WHITE, ground(VAN_LOOK.band, true, under))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('Round 27d — the time and the direction ONE neutral pill, the direction’s arrow blue; «بلا اتجاه» neutral — each opaque, 4.5:1', () => {
    for (const dark of [false, true]) {
      for (const pill of [HEAD_PILL.time, HEAD_PILL.direction, HEAD_PILL.none]) {
        expect(token(pick(pill, 'bg', dark)).alpha, pill).toBe(1);
        expect(worst(pill, dark), `${pill} ${dark ? 'dark' : 'light'}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(pick(HEAD_PILL.time, 'text', dark)).toMatch(/^(slate-\d+|white)$/);
      expect(pick(HEAD_PILL.none, 'text', dark)).toMatch(/^slate-\d+$/);
      // Round 27d — the direction neutral too (Round 27 drew it sky-outlined): slate words, a slate
      // edge, the time's own ground; its arrow the one spot of colour, the van's blue.
      expect(pick(HEAD_PILL.direction, 'text', dark)).toMatch(/^slate-/);
      expect(pick(HEAD_PILL.direction, 'ring', dark)).toBe(pick(HEAD_PILL.time, 'ring', dark));
      expect(pick(HEAD_PILL.direction, 'bg', dark)).toBe(pick(HEAD_PILL.time, 'bg', dark));
      expect(pick(HEAD_PILL.directionIcon, 'text', dark)).toMatch(/^blue-/);
      // Its arrow and the clock read at 3:1; the pills' edges are quiet (the words carry them).
      const band = bandOf(dark);
      const dir = ground(HEAD_PILL.direction, dark, band);
      expect(contrast(edge(HEAD_PILL.direction, 'ring', dark, dir), band)).toBeLessThanOrEqual(
        2.75,
      );
      expect(contrast(words(HEAD_PILL.directionIcon, dark), dir), 'arrow').toBeGreaterThanOrEqual(
        3,
      );
      const time = ground(HEAD_PILL.time, dark, band);
      expect(contrast(words(HEAD_PILL.timeIcon, dark), time), 'clock').toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the card and its states — the design’s edges (Round 27)', () => {
  it('the card: the design’s deep navy by night, white by day — the card’s words read on it', () => {
    expect(pick(VAN_CARD.rest, 'bg', false)).toBe('white');
    expect(pick(VAN_CARD.rest, 'bg', true)).toBe('[#111a2e]');
    for (const state of [VAN_CARD.rest, VAN_CARD.noCaptain, VAN_CARD.kept, VAN_CARD.armed]) {
      expect(contrast(token('slate-900').rgb, ground(state, false, WHITE))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(WHITE, ground(state, true, CARD_DARK))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('«بلا قائد»: a quiet solid rose edge; a kept row: a quiet DASHED amber edge — no ring, no glow (Round 27d)', () => {
    for (const dark of [false, true]) {
      expect(pick(VAN_CARD.noCaptain, 'border', dark)).toMatch(/^rose-/);
      expect(pick(VAN_CARD.kept, 'border', dark)).toMatch(/^amber-/);
    }
    expect(VAN_CARD.noCaptain).not.toContain('border-dashed');
    expect(VAN_CARD.kept).toContain('border-dashed');
    // Round 27d — Round 27's rose and amber glows (and the 3px halo by day) are gone: a state wears
    // the card at rest's own neutral shadow, nothing more.
    const shadows = (classes: string): string[] =>
      classes.split(/\s+/).filter((c) => /^(dark:)?shadow/.test(c));
    for (const state of [VAN_CARD.noCaptain, VAN_CARD.kept]) {
      expect(shadows(state)).toEqual(shadows(VAN_CARD.rest));
      expect(state).not.toMatch(/rgba|ring-/);
    }
    // Its stripe in its edge's colour, never the van's blue inside a rose or amber edge.
    expect(pick(VAN_STATE_STRIPE.noCaptain, 'bg', false)).toMatch(/^rose-/);
    expect(pick(VAN_STATE_STRIPE.kept, 'bg', false)).toMatch(/^amber-/);
  });

  it('each state’s edge reads at 3:1 or better against the column it stands on — light and dark', () => {
    for (const dark of [false, true]) {
      for (const [what, state] of [
        ['no captain', VAN_CARD.noCaptain],
        ['kept', VAN_CARD.kept],
      ] as const) {
        for (const under of COLUMN_GROUND(dark)) {
          expect(
            contrast(edge(state, 'border', dark, under), under),
            `${what} (${dark ? 'dark' : 'light'})`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('a state’s edge is far from the card at rest’s (CIEDE2000 20 or more) — seen at a glance', () => {
    for (const dark of [false, true]) {
      const under = COLUMN_GROUND(dark)[0] as Rgb;
      const rest = edge(VAN_CARD.rest, 'border', dark, under);
      for (const state of [VAN_CARD.noCaptain, VAN_CARD.kept]) {
        expect(deltaE2000(edge(state, 'border', dark, under), rest)).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

/** A count's solid mark (its icon), as painted in a theme. */
const markOf = (kind: (typeof COUNT_KINDS)[number], dark: boolean): Rgb =>
  words(COUNT_LOOK[kind].mark, dark);
/** A count's tinted ground, as painted in a theme, over a ground. */
const chipGround = (kind: (typeof COUNT_KINDS)[number], dark: boolean, under: Rgb): Rgb =>
  ground(COUNT_LOOK[kind].chip, dark, under);
/** A count's outline, as painted over its own ground. */
const outlineOf = (
  kind: (typeof COUNT_KINDS)[number],
  dark: boolean,
  under: Rgb,
  look: 'chip' | 'zero' = 'chip',
): Rgb => edge(COUNT_LOOK[kind][look], 'ring', dark, ground(COUNT_LOOK[kind][look], dark, under));

describe('the counts — four hues on soft tiles (Round 27; calmer, Round 27d)', () => {
  it('four kinds, four hues, four icons — محصنات cyan, كراتين amber, حقائب blue, صناديق purple', () => {
    expect(COUNT_KINDS.map((kind) => COUNT_LOOK[kind].hue)).toEqual([
      'cyan',
      'amber',
      'blue',
      'purple',
    ]);
    expect(new Set(COUNT_KINDS.map((kind) => COUNT_LOOK[kind].icon.join(' '))).size).toBe(4);
    // Round 27d — the HUE lives in the tile's ground and edge, its figure, its icon, its page square
    // and its 0's icon; its word is neutral slate, and its 0 neutral grey throughout (Round 27 wrote
    // every part in the hue — words and 0 too).
    for (const kind of COUNT_KINDS) {
      const { hue, chip, figure, mark, zero, zeroFigure, zeroMark, square } = COUNT_LOOK[kind];
      for (const dark of [false, true]) {
        for (const classes of [figure, mark, zeroMark, square]) {
          for (const c of own(classes, dark).filter((one) => /^(bg|text|ring)-/.test(one))) {
            expect(c, `${kind}: ${classes}`).toContain(`-${hue}-`);
          }
        }
        expect(pick(chip, 'bg', dark), kind).toMatch(new RegExp(`^${hue}-`));
        expect(pick(chip, 'ring', dark), kind).toMatch(new RegExp(`^${hue}-`));
        expect(pick(chip, 'text', dark), `${kind} word`).toMatch(/^slate-/);
        for (const part of ['bg', 'text', 'ring'] as const) {
          expect(pick(zero, part, dark), `${kind} 0 ${part}`).toMatch(/^slate-/);
        }
        expect(pick(zeroFigure, 'text', dark), `${kind} 0 figure`).toMatch(/^slate-/);
      }
    }
  });

  it('a SOFT tile — a 1px faint edge of its colour on the faintest tint of it, never dashed, no glow', () => {
    for (const kind of COUNT_KINDS) {
      for (const look of ['chip', 'zero'] as const) {
        const classes = COUNT_LOOK[kind][look];
        expect(classes, `${kind} ${look}`).not.toContain('dashed');
        for (const dark of [false, true]) pick(classes, 'ring', dark);
      }
      // By day a light tint of its own hue (opaque, plainly not white); by night a thin tint.
      const light = token(pick(COUNT_LOOK[kind].chip, 'bg', false));
      expect(light.alpha, kind).toBe(1);
      expect(deltaE2000(light.rgb, WHITE), kind).toBeGreaterThanOrEqual(4);
      // Round 27d — by night the faintest tint (Round 27: /[0.12]–/[0.24]).
      const night = token(pick(COUNT_LOOK[kind].chip, 'bg', true)).alpha;
      expect(night, kind).toBeGreaterThanOrEqual(0.06);
      expect(night, kind).toBeLessThanOrEqual(0.1);
      // Round 27d — no glow: Round 27's soft cyan glow on the محصنات' tile is gone.
      for (const look of ['chip', 'zero'] as const) {
        expect(COUNT_LOOK[kind][look], `${kind} ${look}`).not.toMatch(/shadow/);
      }
    }
  });

  it('Round 27d — every edge is QUIET, and still draws its tile — a count’s and a 0’s, light and dark', () => {
    // Round 27 drew each tile with a 3:1 ring of its hue. «بالوان اهدى»: the ring is a breath of the
    // hue now (by day x-300, by night x-400/35; a 0's neutral) — a container's outline, which WCAG
    // 1.4.11 does not ask to reach 3:1, and never the only sign of anything: the tile's icon (3:1),
    // figure and word (4.5:1) say what it counts. Measured both ways: never louder than 2.75:1, and
    // still plainly apart from what it stands on (CIEDE2000 — a count's 8 or more, a 0's 4).
    for (const kind of COUNT_KINDS) {
      for (const look of ['chip', 'zero'] as const) {
        for (const dark of [false, true]) {
          for (const under of groundsFor(kind, dark)) {
            const ring = outlineOf(kind, dark, under, look);
            const label = `${kind} ${look} (${dark ? 'dark' : 'light'})`;
            expect(contrast(ring, under), label).toBeLessThanOrEqual(2.75);
            expect(deltaE2000(ring, under), label).toBeGreaterThanOrEqual(look === 'chip' ? 8 : 4);
          }
        }
      }
    }
  });

  it('their icons are 20 or more apart, pairwise, light and dark (CIEDE2000)', () => {
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

  it('their edges are 15 or more apart by day and 10 by night, their grounds 5 by day and 2.5 by night', () => {
    // Round 26b's FILLED tiles were told apart by the ground alone (10 or more). The owner's design
    // outlines them on a thin tint of their hue — its own grounds are 8.4 apart at the closest (cyan
    // and blue): the edge and the icon carry the hue now, the ground follows it. R27 critic — on
    // EVERY ground they stand on (a `slice(0, 2)` had dropped two), and the three packages also on
    // «تسليم»'s confirmation, where bags and boxes stood 6.5 apart.
    // Round 27d relaxes the two that calmer tints shrink, on purpose: the grounds are the faintest
    // tint now (x-50 by day, x-400/[0.08] by night — blue and purple 5.9 apart by day, cyan and blue
    // 2.8 by night on the confirmation), and by night the edges are x-400/35 (11.9 at the closest,
    // was 15 at /80). The ICONS still stand 20 or more apart (above) and the figures in their hues:
    // the tile is told apart by what it draws, its ground and edge only echo it.
    const grounds = (dark: boolean): [Rgb, readonly (typeof COUNT_KINDS)[number][]][] => [
      ...groundsOf(dark).map((under): [Rgb, readonly (typeof COUNT_KINDS)[number][]] => [
        under,
        COUNT_KINDS,
      ]),
      [CONFIRM_GROUND(dark), PACKAGE_KINDS],
    ];
    for (const dark of [false, true]) {
      for (const [under, kinds] of grounds(dark)) {
        kinds.forEach((one, at) => {
          for (const two of kinds.slice(at + 1)) {
            const pair = `${one} ~ ${two} (${dark ? 'dark' : 'light'})`;
            expect(
              deltaE2000(outlineOf(one, dark, under), outlineOf(two, dark, under)),
              `edges ${pair}`,
            ).toBeGreaterThanOrEqual(dark ? 10 : 15);
            expect(
              deltaE2000(chipGround(one, dark, under), chipGround(two, dark, under)),
              `grounds ${pair}`,
            ).toBeGreaterThanOrEqual(dark ? 2.5 : 5);
          }
        });
      }
    }
  });

  it('the محصنات’ cyan is never taken for the captain’s emerald frame beside it — icon, edge and ground', () => {
    // «بس هتجيب المحصنة قبل القائد»: the count stands right before his frame. The design's teal
    // would sit 10 from emerald (CIEDE2000, Tailwind's 400s); cyan stands 27 away.
    expect(deltaE2000(token('teal-400').rgb, token('emerald-400').rgb)).toBeLessThan(12);
    expect(deltaE2000(token('cyan-400').rgb, token('emerald-400').rgb)).toBeGreaterThanOrEqual(25);
    for (const dark of [false, true]) {
      const card = dark ? CARD_DARK : WHITE;
      const frame = ground(CAPTAIN_FRAME.some, dark, card);
      const tile = chipGround('shipments', dark, card);
      const theme = dark ? 'dark' : 'light';
      expect(
        deltaE2000(markOf('shipments', dark), token(pick(CAPTAIN_MARK, 'bg', dark)).rgb),
        `icon ~ «قائد» (${theme})`,
      ).toBeGreaterThanOrEqual(20);
      expect(
        deltaE2000(
          outlineOf('shipments', dark, card),
          edge(CAPTAIN_FRAME.some, 'ring', dark, frame),
        ),
        `edge ~ frame's edge (${theme})`,
      ).toBeGreaterThanOrEqual(15);
      // Round 27d — 4 (was 5): by day cyan-50 stands 4.1 from the frame's emerald-50; the edge (15
      // or more) and the icon (20) carry the difference.
      expect(deltaE2000(tile, frame), `ground ~ frame (${theme})`).toBeGreaterThanOrEqual(4);
      // And a plainly other hue: 25° or more round the wheel.
      const turn = Math.abs(
        hueAngle(markOf('shipments', dark)) - hueAngle(token('emerald-500').rgb),
      );
      expect(Math.min(turn, 360 - turn), theme).toBeGreaterThanOrEqual(25);
    }
  });

  it('every count’s icon is 20 or more from the captain’s «قائد» and a refusal’s rose', () => {
    for (const dark of [false, true]) {
      const reserved = {
        captain: token(pick(CAPTAIN_MARK, 'bg', dark)).rgb,
        refusal: token(dark ? 'rose-500' : 'rose-600').rgb,
      };
      for (const [what, colour] of Object.entries(reserved)) {
        for (const kind of COUNT_KINDS) {
          expect(
            deltaE2000(markOf(kind, dark), colour),
            `${kind} ~ ${what} (${dark ? 'dark' : 'light'})`,
          ).toBeGreaterThanOrEqual(20);
        }
      }
    }
  });

  it('كراتين share a proposal’s amber and حقائب the van’s blue — BY DESIGN, told apart by shape', () => {
    // The owner's design paints the cartons amber like its «in progress» row and the bags blue like
    // the van's code. A proposal is a DASHED chip with its «مقترحة» mark; the van's code a pill in
    // the head with its truck; a count an outlined tile with its own icon and word — never dashed.
    expect(COUNT_LOOK.cartons.hue).toBe('amber');
    expect(CHIP_LOOK.proposed).toContain('border-dashed');
    expect(COUNT_LOOK.cartons.chip).not.toContain('dashed');
    expect(COUNT_LOOK.bags.hue).toBe('blue');
    expect(COUNT_LOOK.bags.icon).not.toEqual(COUNT_LOOK.shipments.icon);
  });

  it('its words and figure read at 4.5:1 or better on its ground, its icon at 3:1 — light and dark', () => {
    for (const kind of COUNT_KINDS) {
      const { chip, figure, mark } = COUNT_LOOK[kind];
      for (const dark of [false, true]) {
        expect(worst(chip, dark, groundsFor(kind, dark)), `${kind} words`).toBeGreaterThanOrEqual(
          4.5,
        );
        for (const under of groundsFor(kind, dark)) {
          const on = ground(chip, dark, under);
          expect(contrast(words(figure, dark), on), `${kind} figure`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(words(mark, dark), on), `${kind} icon`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('Round 27d — a 0 is neutral grey, only its icon keeps the hue — its figure and words still 4.5:1, its icon 3:1', () => {
    // Round 27 kept a 0 in its hue and edge, quieter. «بالوان اهدى»: a 0 is grey — ground, edge, word
    // and figure slate (above) — and only its icon keeps a faint tone of its hue (`zeroMark`), so a
    // count stands out and a 0 sits back. By day its grey ground (slate-50) is a shade DARKER than a
    // count's x-50 tint, not lighter (Round 27's check): it is quieter by having no hue, and stands
    // closer to the card (the ground check below, 0.6 or less of a count's distance).
    for (const kind of COUNT_KINDS) {
      const { chip, zero, figure, zeroFigure, zeroMark } = COUNT_LOOK[kind];
      // Thinner by night.
      expect(token(pick(zero, 'bg', true)).alpha, kind).toBeLessThan(
        token(pick(chip, 'bg', true)).alpha,
      );
      for (const dark of [false, true]) {
        expect(worst(zero, dark, groundsFor(kind, dark)), `${kind} 0 words`).toBeGreaterThanOrEqual(
          4.5,
        );
        for (const under of groundsFor(kind, dark)) {
          const on0 = ground(zero, dark, under);
          const on = ground(chip, dark, under);
          const quiet = contrast(words(zeroFigure, dark), on0);
          // R26b verify — the figure is 15px text, not large text: AA is 4.5:1 for it too.
          expect(quiet, `${kind} 0 figure`).toBeGreaterThanOrEqual(4.5);
          // Quieter than a count's figure — muted, never louder.
          expect(quiet, `${kind} 0 figure`).toBeLessThan(contrast(words(figure, dark), on));
          expect(contrast(words(zeroMark, dark), on0), `${kind} 0 icon`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('R27 critic — a 0 is PLAINLY quieter than its count: its figure, its words, its ground — and by night its edge', () => {
    // The critic, by night: «0 كراتين» read as loud as «2 كرتونتان» — the 0's figure only 1.2:1
    // under a count's, its words LOUDER than a count's, its edge as strong. Each part measured, on
    // every ground the count stands on (and a 0 never loses its edge).
    // Round 27d relaxes one margin, on purpose: by night the edges' 1:1 to 0.5 — a count's edge is
    // itself only x-400/35 now (was /80), the 0's a neutral /25 under it, and no edge reads under
    // 1:1. R27d critic — the figure's 2.5:1, relaxed to 2 in the same round, is RESTORED: by day the
    // cyan and amber figures are x-900 (were x-800 — 2.4 and 2.3 over a 0's slate-500, which cannot
    // go lower and stay 4.5:1); the four figures now stand 8:1 to 9:1 alike.
    for (const kind of COUNT_KINDS) {
      const { chip, zero, figure, zeroFigure } = COUNT_LOOK[kind];
      for (const dark of [false, true]) {
        const theme = `${kind} (${dark ? 'dark' : 'light'})`;
        for (const under of groundsFor(kind, dark)) {
          const on = ground(chip, dark, under);
          const on0 = ground(zero, dark, under);
          expect(
            contrast(words(figure, dark), on) - contrast(words(zeroFigure, dark), on0),
            `figure ${theme}`,
          ).toBeGreaterThanOrEqual(2.5);
          expect(contrast(words(zero, dark), on0), `words ${theme}`).toBeLessThan(
            contrast(words(chip, dark), on),
          );
          expect(deltaE2000(on0, under), `ground ${theme}`).toBeLessThanOrEqual(
            0.6 * deltaE2000(on, under),
          );
          if (dark) {
            expect(
              contrast(outlineOf(kind, dark, under), under) -
                contrast(outlineOf(kind, dark, under, 'zero'), under),
              `edge ${theme}`,
            ).toBeGreaterThanOrEqual(0.5);
          }
        }
      }
    }
  });

  it('R27d critic — a 0’s ICON is plainly fainter than its count’s (1:1 or more under it) on every ground, light and dark', () => {
    // `zeroMark` is «fainter than a count's» — the critic found it was not, by day: the boxes' 0 wore
    // its count's very purple-500 (3.78:1 on its grey against 3.69:1 on purple-50 — LOUDER). Each 0's
    // icon is measured against its count's, on every ground the count stands on: never louder, and
    // a whole 1:1 or more under it, so a 0 sits back in its icon too — and still 3:1 (above).
    for (const kind of COUNT_KINDS) {
      const { chip, zero, mark, zeroMark } = COUNT_LOOK[kind];
      for (const dark of [false, true]) {
        for (const under of groundsFor(kind, dark)) {
          const count = contrast(words(mark, dark), ground(chip, dark, under));
          const none = contrast(words(zeroMark, dark), ground(zero, dark, under));
          expect(count - none, `${kind} (${dark ? 'dark' : 'light'})`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('never one grey for the three packages’ zeros — each 0’s ICON its own hue and drawing, 20 or more apart', () => {
    // R26 wrote every 0 in the same grey: «0 كراتين», «0 حقائب», «0 صناديق» read as one thing. Round
    // 27d greys a 0's tile, word and figure on purpose («بالوان اهدى»): its ICON keeps its hue and its
    // own drawing, so the three still read as three (Round 27 measured the 0's coloured figures).
    expect(new Set(PACKAGE_KINDS.map((kind) => COUNT_LOOK[kind].zeroMark)).size).toBe(3);
    expect(new Set(PACKAGE_KINDS.map((kind) => COUNT_LOOK[kind].icon.join(' '))).size).toBe(3);
    for (const dark of [false, true]) {
      PACKAGE_KINDS.forEach((one, at) => {
        for (const two of PACKAGE_KINDS.slice(at + 1)) {
          expect(
            deltaE2000(
              words(COUNT_LOOK[one].zeroMark, dark),
              words(COUNT_LOOK[two].zeroMark, dark),
            ),
            `${one} ~ ${two} (${dark ? 'dark' : 'light'})`,
          ).toBeGreaterThanOrEqual(20);
        }
      });
    }
  });

  it('the page’s figure squares draw each icon at 3:1 or better, in the count’s own hue', () => {
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

  it('R27d critic — the bar’s squares wear ONE tint by day (/10), «السيارات»’ grey too; by night it is never the heaviest', () => {
    // Round 27d set every square on the page's bar to /10 by day — the counts' and «بلا سيارة»'s —
    // and left «السيارات»' grey square at /15, the darkest tint on the bar.
    const squares: Record<string, string> = {
      vans: VANS_FIGURE,
      unplaced: COLUMN_WARN.figure,
      ...Object.fromEntries(COUNT_KINDS.map((kind) => [kind, COUNT_LOOK[kind].square])),
    };
    /** A square's tint in a theme — its own `dark:` ground by night, else its day one (it holds). */
    const tint = (classes: string, dark: boolean): number =>
      token(
        dark && own(classes, true).some((c) => c.startsWith('bg-'))
          ? pick(classes, 'bg', true)
          : pick(classes, 'bg', false),
      ).alpha;
    for (const [name, classes] of Object.entries(squares)) {
      expect(tint(classes, false), name).toBe(0.1);
    }
    const hued = Object.entries(squares).filter(([name]) => name !== 'vans');
    expect(tint(VANS_FIGURE, true)).toBeLessThanOrEqual(
      Math.min(...hued.map(([, classes]) => tint(classes, true))),
    );
  });

  it('Round 27d — no coloured glow or halo on the BOARD: the look’s tokens and every class the two screens write themselves', () => {
    // «بالوان اهدى»: Round 27's glows — the code pill's blue, the محصنات' cyan, «بلا قائد»'s rose, the
    // kept row's amber, the waiting column's rose count — and the 3px halos by day are gone. A
    // neutral soft shadow (slate / black) is all a card keeps; a drag's «here» keeps Round 25's lift.
    // R27d critic — this is what it measures, and no more: the colours in `distribution-look.ts` and
    // the classes written in the two screens' own files. The app's SHARED brand buttons they use —
    // «حفظ» and «تسليم» (`ADD_BUTTON`), the confirmation's own (`DesignSave`) — keep the app's brand
    // shadow, as on every other screen; this round does not touch them.
    const looks: Record<string, unknown> = {
      VANS_FIGURE,
      VAN_LOOK,
      VAN_CARD: { ...VAN_CARD, place: '' },
      VAN_STATE_STRIPE,
      COUNT_LOOK,
      HEAD_PILL,
      CAPTAIN_FRAME,
      CAPTAIN_MARK,
      LOAD_LOOK,
      KEPT_NOTICE,
      CHIP_LOOK,
      CHIP_DOT,
      CHIP_WORDS,
      COLUMN_WARN,
    };
    const strings = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? []
          : typeof value === 'object' && value !== null
            ? Object.values(value).flatMap(strings)
            : [];
    for (const [name, look] of Object.entries(looks)) {
      for (const classes of strings(look)) {
        expect(classes, name).not.toMatch(/rgba\(|shadow-\[/);
        for (const c of classes.split(/\s+/).filter((one) => /^(dark:)?shadow-/.test(one))) {
          expect(c, `${name}: ${classes}`).toMatch(/^(dark:)?shadow-(sm|md|lg|slate-|black\/)/);
        }
      }
    }
    // R27d critic — and the classes the screens write by hand, outside the look (a menu's, a chip's
    // shadow): any shadow utility, in any variant (`dark:`, `hover:`, `focus:` …), is a size or a
    // neutral colour — never a hue, never an arbitrary one.
    const written = [
      './SecuredDistributionParts.tsx',
      '../pages/SecuredDistributionPage.tsx',
      '../pages/VaultHandoverPage.tsx',
    ].flatMap((file) =>
      (
        readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').match(
          /(?<![\w-])(?:[\w-]+:)*shadow-[^\s'"`]+/g,
        ) ?? []
      ).map((c): [string, string] => [file, c]),
    );
    // The scan sees them: the move menu's and the chip's own shadows are written there.
    expect(written.map(([, c]) => c)).toEqual(
      expect.arrayContaining(['shadow-2xl', 'shadow-slate-900/15', 'dark:shadow-black/60']),
    );
    for (const [file, c] of written) {
      expect(c, file).toMatch(
        /^(?:[\w-]+:)*shadow-(?:none|sm|md|lg|xl|2xl|inner|(?:slate|black)(?:-\d+)?(?:\/(?:\d+|\[[\d.]+\]))?)$/,
      );
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

describe('the captain’s own frame — as Round 26b drew it («والكارت بتاع القائد خليه زي ما انت ما كنت عامله»)', () => {
  it('green, unchanged — his name, his mark and «بلا قائد» readable on it', () => {
    expect(CAPTAIN_FRAME.some).toBe(
      'bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30',
    );
    expect(CAPTAIN_MARK).toBe('bg-emerald-700 text-white dark:bg-emerald-700 dark:text-white');
    // R27 critic — its «بلا قائد» state is NOT Round 26b's. Round 27d — as light as the rest of the
    // card: by day rose-300 → rose-200; by night /[0.12] → /[0.08] ground and rose-500/50 →
    // rose-400/30 edge. Pinned, so the frame with a captain is the only part said to be «unchanged».
    expect(CAPTAIN_FRAME.none).toBe(
      'bg-rose-50 ring-rose-200 dark:bg-rose-500/[0.08] dark:ring-rose-400/30',
    );
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

describe('the load and the kept notice', () => {
  it('an empty load’s words, and a refusing van’s, read at 4.5:1 or better on its ground', () => {
    for (const dark of [false, true]) {
      for (const under of groundsOf(dark)) {
        expect(
          contrast(words(LOAD_LOOK.empty, dark), ground(LOAD_LOOK.area, dark, under)),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(words(LOAD_LOOK.refuseWords, dark), ground(LOAD_LOOK.refuse, dark, under)),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(worst(LOAD_LOOK.refuse, dark)).toBeGreaterThanOrEqual(4.5);
      expect(pick(LOAD_LOOK.refuse, 'bg', dark)).toMatch(/^rose-/);
    }
  });

  it('a kept row’s notice: amber, its words 4.5:1 and its icon 3:1', () => {
    for (const dark of [false, true]) {
      expect(pick(KEPT_NOTICE.strip, 'bg', dark)).toMatch(/^amber-/);
      expect(worst(KEPT_NOTICE.strip, dark)).toBeGreaterThanOrEqual(4.5);
      for (const under of groundsOf(dark)) {
        expect(
          contrast(words(KEPT_NOTICE.icon, dark), ground(KEPT_NOTICE.strip, dark, under)),
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('the chips — the design’s rows, the chip’s own shape (Round 27)', () => {
  /**
   * The tones measured here — every one but an unsaved move's, which is drawn in `brand`, the app's
   * own palette read from the page's CSS at run time (not a Tailwind colour to measure here).
   */
  const TONES = ['van', 'unplaced', 'proposed', 'refused'] as const;
  /** What a chip of a tone stands on: a van's load (on a van), a column (on no van). */
  const under = (tone: keyof typeof CHIP_LOOK, dark: boolean): Rgb[] =>
    tone === 'unplaced'
      ? COLUMN_GROUND(dark)
      : [ground(LOAD_LOOK.area, dark, dark ? CARD_DARK : WHITE)];

  it('one ground and one edge each; on no van a light DASHED ROSE edge on a faint rose tint — on a van a quiet row', () => {
    for (const tone of Object.keys(CHIP_LOOK) as (keyof typeof CHIP_LOOK)[]) {
      for (const dark of [false, true]) {
        pick(CHIP_LOOK[tone], 'bg', dark);
        pick(CHIP_LOOK[tone], 'border', dark);
      }
    }
    expect(CHIP_LOOK.unplaced).toContain('border-dashed');
    for (const dark of [false, true]) {
      expect(pick(CHIP_LOOK.unplaced, 'bg', dark)).toMatch(/^rose-/);
      expect(pick(CHIP_LOOK.unplaced, 'border', dark)).toMatch(/^rose-/);
      expect(pick(CHIP_LOOK.van, 'border', dark)).toMatch(/^slate-/);
    }
    expect(CHIP_LOOK.van).not.toContain('dashed');
  });

  it('Round 27d — the rose edge of a chip on no van is light and quiet, still plainly rose on its column', () => {
    // Round 27 asked 3:1 of this dashed edge. «بالوان اهدى» — a light dashed rose (rose-300 by day,
    // rose-400/35 by night): the chip's place is said by its column («بلا سيارة»), and its state
    // by its rose dot at 3:1 (below) — the edge only echoes them. Never louder than 2.75:1, and still
    // 20 or more from the column it stands on (CIEDE2000).
    for (const dark of [false, true]) {
      for (const column of COLUMN_GROUND(dark)) {
        const on = ground(CHIP_LOOK.unplaced, dark, column);
        const rim = edge(CHIP_LOOK.unplaced, 'border', dark, on);
        const theme = dark ? 'dark' : 'light';
        expect(contrast(rim, column), theme).toBeLessThanOrEqual(2.75);
        expect(deltaE2000(rim, column), theme).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('its words read at 4.5:1 or better on every tone’s ground — neutral slate on no van too (Round 27d)', () => {
    for (const tone of TONES) {
      const set = tone === 'unplaced' ? CHIP_WORDS.unplaced : CHIP_WORDS.plain;
      for (const dark of [false, true]) {
        for (const column of under(tone, dark)) {
          const on = ground(CHIP_LOOK[tone], dark, column);
          for (const part of ['bank', 'branch'] as const) {
            expect(
              contrast(words(set[part], dark), on),
              `${tone} ${part} (${dark ? 'dark' : 'light'})`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
    // Round 27d — Round 27 wrote a waiting chip's words rose; the rose is its ground, edge and dot.
    for (const dark of [false, true]) {
      for (const part of ['bank', 'dot', 'branch'] as const) {
        expect(pick(CHIP_WORDS.unplaced[part], 'text', dark)).toMatch(/^(slate-\d+|white)$/);
      }
    }
  });

  it('its dot: cyan on a van (the محصنات’ colour), rose on no van, amber for a proposal — 3:1 on its ground', () => {
    for (const dark of [false, true]) {
      expect(pick(CHIP_DOT.van, 'bg', dark).split('-')[0]).toBe(COUNT_LOOK.shipments.hue);
      expect(pick(CHIP_DOT.unplaced, 'bg', dark)).toMatch(/^rose-/);
      expect(pick(CHIP_DOT.proposed, 'bg', dark)).toMatch(/^amber-/);
      for (const tone of TONES) {
        for (const column of under(tone, dark)) {
          const on = ground(CHIP_LOOK[tone], dark, column);
          expect(
            contrast(fill(CHIP_DOT[tone], dark, on), on),
            `${tone} dot (${dark ? 'dark' : 'light'})`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('the column of chips on no van: a rose warning icon (3:1) and a NEUTRAL count (4.5:1) — Round 27d', () => {
    for (const dark of [false, true]) {
      for (const column of COLUMN_GROUND(dark)) {
        expect(worst(COLUMN_WARN.count, dark, [column])).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(words(COLUMN_WARN.icon, dark), ground(COLUMN_WARN.icon, dark, column)),
        ).toBeGreaterThanOrEqual(3);
        // Where the icon gives way (1280–1440), the warning in the count stays rose — 3:1 on it.
        expect(
          contrast(words(COLUMN_WARN.glyph, dark), ground(COLUMN_WARN.count, dark, column)),
        ).toBeGreaterThanOrEqual(3);
      }
      // Round 27d — the count a neutral pill (Round 27: rose with a rose glow); the icon rose on a
      // faint rose square, with no ring.
      expect(pick(COLUMN_WARN.count, 'bg', dark)).toMatch(/^slate-/);
      expect(pick(COLUMN_WARN.count, 'text', dark)).toMatch(/^slate-/);
      expect(pick(COLUMN_WARN.icon, 'text', dark)).toMatch(/^rose-/);
      expect(pick(COLUMN_WARN.glyph, 'text', dark)).toBe(pick(COLUMN_WARN.icon, 'text', dark));
      expect(COLUMN_WARN.icon).not.toMatch(/ring/);
      // R27 critic — the page's «بلا سيارة» figure in the same rose: its warning 3:1 on the bar's
      // pill (white by day, `#111827` by night), the same hue as the head's icon.
      const pill = dark ? hex('#111827') : WHITE;
      expect(
        contrast(words(COLUMN_WARN.figure, dark), ground(COLUMN_WARN.figure, dark, pill)),
      ).toBeGreaterThanOrEqual(3);
      expect(pick(COLUMN_WARN.figure, 'text', dark)).toBe(pick(COLUMN_WARN.icon, 'text', dark));
    }
  });
});
