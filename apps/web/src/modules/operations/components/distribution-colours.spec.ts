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
    // Its number white by night, as in the design.
    expect(pick(VAN_LOOK.pill, 'text', true)).toBe('white');
    // It glows softly by night — a shadow of its own blue.
    expect(VAN_LOOK.ring).toMatch(/dark:shadow-\[[^\]]*rgba\(59,130,246,/);
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

  it('the pill’s blue EDGE draws its shape on the band at 3:1 or better — both themes (R26b critic)', () => {
    // By night the tint and the band are both dark: the edge, a 1px ring over the pill's own ground,
    // is what draws it (R26b critic: a `white/15` edge left the van's code a dark slab).
    for (const dark of [false, true]) {
      const band = bandOf(dark);
      const pill = ground(VAN_LOOK.pill, dark, band);
      expect(
        contrast(edge(VAN_LOOK.ring, 'ring', dark, pill), band),
        dark ? 'dark' : 'light',
      ).toBeGreaterThanOrEqual(3);
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

  it('the time a neutral pill, the direction a sky one (the design’s), «بلا اتجاه» neutral — each opaque, 4.5:1', () => {
    for (const dark of [false, true]) {
      for (const pill of [HEAD_PILL.time, HEAD_PILL.direction, HEAD_PILL.none]) {
        expect(token(pick(pill, 'bg', dark)).alpha, pill).toBe(1);
        expect(worst(pill, dark), `${pill} ${dark ? 'dark' : 'light'}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(pick(HEAD_PILL.time, 'text', dark)).toMatch(/^(slate-\d+|white)$/);
      expect(pick(HEAD_PILL.none, 'text', dark)).toMatch(/^slate-\d+$/);
      expect(pick(HEAD_PILL.direction, 'text', dark)).toMatch(/^sky-/);
      expect(pick(HEAD_PILL.direction, 'ring', dark)).toMatch(/^sky-/);
      // The direction's edge draws it on the band; its arrow and the clock read at 3:1.
      const band = bandOf(dark);
      const dir = ground(HEAD_PILL.direction, dark, band);
      expect(contrast(edge(HEAD_PILL.direction, 'ring', dark, dir), band)).toBeGreaterThanOrEqual(
        3,
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

  it('«بلا قائد»: a solid rose edge with a rose glow; a kept row: a DASHED amber edge with an amber glow', () => {
    for (const dark of [false, true]) {
      expect(pick(VAN_CARD.noCaptain, 'border', dark)).toMatch(/^rose-/);
      expect(pick(VAN_CARD.kept, 'border', dark)).toMatch(/^amber-/);
    }
    expect(VAN_CARD.noCaptain).not.toContain('border-dashed');
    expect(VAN_CARD.kept).toContain('border-dashed');
    expect(VAN_CARD.noCaptain).toMatch(/dark:shadow-\[[^\]]*rgba\(244,63,94,/);
    expect(VAN_CARD.kept).toMatch(/dark:shadow-\[[^\]]*rgba\(245,158,11,/);
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

describe('the counts — four hues, OUTLINED as the owner drew them (Round 27)', () => {
  it('four kinds, four hues, four icons — محصنات cyan, كراتين amber, حقائب blue, صناديق purple', () => {
    expect(COUNT_KINDS.map((kind) => COUNT_LOOK[kind].hue)).toEqual([
      'cyan',
      'amber',
      'blue',
      'purple',
    ]);
    expect(new Set(COUNT_KINDS.map((kind) => COUNT_LOOK[kind].icon.join(' '))).size).toBe(4);
    // Each look is its own hue throughout — ground, edge, words, figure, icon; its 0 too.
    for (const kind of COUNT_KINDS) {
      const { hue, chip, figure, mark, zero, zeroFigure, square } = COUNT_LOOK[kind];
      for (const classes of [chip, figure, mark, zero, zeroFigure, square]) {
        for (const dark of [false, true]) {
          for (const c of own(classes, dark).filter((one) => /^(bg|text|ring)-/.test(one))) {
            expect(c, `${kind}: ${classes}`).toContain(`-${hue}-`);
          }
        }
      }
    }
  });

  it('OUTLINED — a 1px edge of its colour on a tinted ground of the same colour, never dashed', () => {
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
      const night = token(pick(COUNT_LOOK[kind].chip, 'bg', true)).alpha;
      expect(night, kind).toBeGreaterThanOrEqual(0.08);
      expect(night, kind).toBeLessThanOrEqual(0.25);
    }
    // The محصنات' tile glows softly by night, as in the design.
    expect(COUNT_LOOK.shipments.chip).toMatch(/dark:shadow-\[[^\]]*rgba\(34,211,238,/);
  });

  it('every edge reads at 3:1 or better against the card it stands on — a count’s and a 0’s, light and dark', () => {
    for (const kind of COUNT_KINDS) {
      for (const look of ['chip', 'zero'] as const) {
        for (const dark of [false, true]) {
          for (const under of groundsFor(kind, dark)) {
            expect(
              contrast(outlineOf(kind, dark, under, look), under),
              `${kind} ${look} (${dark ? 'dark' : 'light'})`,
            ).toBeGreaterThanOrEqual(3);
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

  it('their edges are 15 or more apart, their grounds 10 by day and 7 by night — the tile told apart whole', () => {
    // Round 26b's FILLED tiles were told apart by the ground alone (10 or more). The owner's design
    // outlines them on a thin tint of their hue — its own grounds are 8.4 apart at the closest (cyan
    // and blue): the edge and the icon carry the hue now, the ground follows it. R27 critic — on
    // EVERY ground they stand on (a `slice(0, 2)` had dropped two), and the three packages also on
    // «تسليم»'s confirmation, where bags and boxes stood 6.5 apart.
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
            ).toBeGreaterThanOrEqual(15);
            expect(
              deltaE2000(chipGround(one, dark, under), chipGround(two, dark, under)),
              `grounds ${pair}`,
            ).toBeGreaterThanOrEqual(dark ? 7 : 10);
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
      expect(deltaE2000(tile, frame), `ground ~ frame (${theme})`).toBeGreaterThanOrEqual(5);
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

  it('a 0 keeps its hue and its edge, quieter — a lighter ground, a quieter figure — its figure and words still 4.5:1', () => {
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
        // The same colour of edge as its count's.
        expect(pick(zero, 'ring', dark).split('/')[0], kind).toBe(
          pick(chip, 'ring', dark).split('/')[0],
        );
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
          expect(contrast(words(mark, dark), on0), `${kind} 0 icon`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('R27 critic — a 0 is PLAINLY quieter than its count: its figure, its words, its ground — and by night its edge', () => {
    // The critic, by night: «0 كراتين» read as loud as «2 كرتونتان» — the 0's figure only 1.2:1
    // under a count's, its words LOUDER than a count's, its edge as strong. Each part measured, on
    // every ground the count stands on. By day a 0's edge stays its count's: the lightest of its hue
    // that still draws the tile at 3:1 on white (and a 0 never loses its edge).
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
            ).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  it('never one grey for the three packages’ zeros — each its own hue, 20 or more apart', () => {
    // R26 wrote every 0 in the same grey: «0 كراتين», «0 حقائب», «0 صناديق» read as one thing.
    expect(new Set(PACKAGE_KINDS.map((kind) => COUNT_LOOK[kind].zero)).size).toBe(3);
    for (const dark of [false, true]) {
      PACKAGE_KINDS.forEach((one, at) => {
        for (const two of PACKAGE_KINDS.slice(at + 1)) {
          expect(
            deltaE2000(
              words(COUNT_LOOK[one].zeroFigure, dark),
              words(COUNT_LOOK[two].zeroFigure, dark),
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
    // R27 critic — its «بلا قائد» state is NOT Round 26b's: a firmer rose (rose-200 → rose-300 by
    // day; /10 → /[0.12] ground and /30 → /50 edge by night), the design's «بلا قائد» box. Pinned,
    // so the frame with a captain is the only part said to be «unchanged».
    expect(CAPTAIN_FRAME.none).toBe(
      'bg-rose-50 ring-rose-300 dark:bg-rose-500/[0.12] dark:ring-rose-500/50',
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

  it('one ground and one edge each; on no van a DASHED ROSE edge on a rose tint — on a van a quiet row', () => {
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

  it('the rose edge of a chip on no van reads at 3:1 or better against its column', () => {
    for (const dark of [false, true]) {
      for (const column of COLUMN_GROUND(dark)) {
        const on = ground(CHIP_LOOK.unplaced, dark, column);
        expect(
          contrast(edge(CHIP_LOOK.unplaced, 'border', dark, on), column),
          dark ? 'dark' : 'light',
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('its words read at 4.5:1 or better on every tone’s ground — rose-tinted on no van', () => {
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
    for (const dark of [false, true]) {
      expect(pick(CHIP_WORDS.unplaced.bank, 'text', dark)).toMatch(/^rose-/);
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

  it('the column of chips on no van: a rose warning icon (3:1) and a rose count (4.5:1)', () => {
    for (const dark of [false, true]) {
      for (const column of COLUMN_GROUND(dark)) {
        expect(worst(COLUMN_WARN.count, dark, [column])).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(words(COLUMN_WARN.icon, dark), ground(COLUMN_WARN.icon, dark, column)),
        ).toBeGreaterThanOrEqual(3);
      }
      expect(pick(COLUMN_WARN.count, 'bg', dark)).toMatch(/^rose-/);
      expect(pick(COLUMN_WARN.icon, 'text', dark)).toMatch(/^rose-/);
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
