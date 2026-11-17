// «الطقم الثابت» in the design of «تعيين السيارات» — the DESIGN SAMPLE's shooter, with its checks.
//
// Served by Vite on 127.0.0.1:5316 (apps/web/zz-vite-fixed.config.mjs) from the sample tree
// /home/user/egycash-fx: /zz-fixed-sample.html#/fleet/fixed-roster is the sample (zz files only, in the
// real AppShell), /zz-fixed-sample.html#/fleet/roster the REAL merged daily roster on the same figures.
// Every /api/v1/** answer comes from the page's own stand-in (apps/web/src/zz-fixed-sample-data.ts).
//
//   node shoot.mjs [all | name,name…]      → ./*.png (owner set), ./extra/*.png, ./checks.txt
//   node shoot.mjs ref                      → ./ref/*.png (the daily reference; NOT part of «all» since
//                                             the owner's answers of 2026-11-17 — ref/ stays as sent)
//
// DARK only, deviceScaleFactor 2. Checks on every shot: no sideways page scroll, no cut text, no
// Latin text (only the shell's «ECMS»/«EN», the pill's «Excel», and «ATM» inside «ضم ATM»), no
// Arabic-Indic digit, no error boundary, no request left unanswered; per shot the counts against the
// figure set (gap map §9) and every function of fixed-functions.md visible or reachable (FUNCS).
//
// The owner's answers «1 ب / 2 ج» (2026-11-17), checked on EVERY sample shot (`answers`):
//   Q1 ب  no flag for a standing member who can no longer drive — none of «الملف موقوف», «ليس على
//         وظيفة سائق», «رخصة منتهية» anywhere, no amber seat frame (those flags are the daily's);
//   Q2 ج  the old header on top — the real PageHeader once: breadcrumb «الحركة» linking /fleet ›
//         «الطقم الثابت», ONE «الطقم الثابت» title; ONE Excel control; no «StandingBox»; the board's
//         first row 24px under the header's line at every width (V-R2-3).
// Review round 2: the desk owner pictures `fixed-dark` / `fixed-edit-dark` GROW past 1080 (growToShow)
// so the drivers list shows to its end and the edit shows 214 (V-R2-1); `extra-landscape` reads the
// header's cost on the touch split view against the real daily — the numbers told in owner.md (V-R2-2).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const REF = join(HERE, 'ref');
const EXTRA = join(HERE, 'extra');
mkdirSync(REF, { recursive: true });
mkdirSync(EXTRA, { recursive: true });
const PORT = 5316;
const CLOCK = '2026-11-17T08:00:00Z';
const MOHANDESSIN = `6b01${'1'.padStart(20, '0')}`;
/** «بدر الدين عاطف سالم» (12221), the free driver the scenario seats on 158. */
const BADR = `e2f0${'38'.padStart(20, '0')}`;
const URL_OF = (route, search = '') => `http://127.0.0.1:${PORT}/zz-fixed-sample.html${search}#${route}`;

// ── the figure set (gap map §9) ──────────────────────────────────────────────────────────────────
const FIG = {
  company: { cars: 20, workshop: 3, crewed: 16, uncrewed: 4, pool: 11 },
  branch: { cars: 9, workshop: 2, crewed: 6, uncrewed: 3, pool: 28, otherVehicle: 18 },
  missions: {
    'نقل أموال (يومي)': 7,
    'سفر': 2,
    'إحتياطي سفر': 1,
    'مسائي': 1,
    'محصنة': 1,
    'شلاتين': 0,
    'إيباج': 1,
    'بدون سائق': 0,
    'ضم ATM': 1,
    'إحتياطى': 1,
    'أسوان': 0,
    'مأمورية': 1,
  },
  edited: { crewed: 17, uncrewed: 3, evening: 2, pool: 10, codes: ['158', '171', '205', '214', '433'] },
  // The picker on 171 seat 2: the 10 free drivers, then «معيّنون على سيارات أخرى (27)» — the 26 a
  // car of the board holds (each with its code) and «إيهاب» held off it on 199 («سيارة أخرى»).
  pickerFree: 10,
  pickerSeated: 27,
};
const CODES_COMPANY = ['150', '152', '158', '163', '171', '176', '205', '214', '231', '247', '262', '305', '318', '340', '376', '410', '433', '118', '120', '133'];
const CODES_BRANCH = ['150', '152', '158', '163', '171', '176', '214', '118', '133'];

// ── the log ──────────────────────────────────────────────────────────────────────────────────────
const lines = [];
let failures = 0;
const pass = (label, what) => lines.push(`PASS ${label} — ${what}`);
const fail = (label, what) => {
  failures += 1;
  lines.push(`FAIL ${label} — ${what}`);
  console.error(`FAIL ${label} — ${what}`);
};
const info = (label, what) => lines.push(`INFO ${label} — ${what}`);
const check = (label, okay, what, detail = '') =>
  okay ? pass(label, what) : fail(label, `${what}${detail === '' ? '' : `: ${detail}`}`);

// ── opening a page ───────────────────────────────────────────────────────────────────────────────
const open = async (browser, { width, height, label, route = '/fleet/fixed-roster', search = '', branch = null, touch = width < 1280, wait = null, light = false }) => {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: light ? 'light' : 'dark',
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    ...(touch ? { hasTouch: true, isMobile: width < 1024 } : {}),
  });
  await context.clock.setFixedTime(new Date(CLOCK));
  await context.addInitScript(([active, theme]) => {
    try {
      localStorage.setItem('ecms.theme', theme);
      localStorage.setItem('ecms.locale', 'ar');
      if (active !== null) localStorage.setItem('ecms.activeBranch', active);
    } catch {
      /* storage refused */
    }
  }, [branch, light ? 'light' : 'dark']);
  const page = await context.newPage();
  page.on('pageerror', (error) => fail(label, `[page error] ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !/Failed to load resource/u.test(text)) console.error(`[console ${label}] ${text.slice(0, 300)}`);
    if (text.startsWith('[zz mock] unknown')) info(label, text);
  });
  await page.goto(URL_OF(route, search), { waitUntil: 'networkidle' });
  const ready = wait ?? (width >= 1280 ? 'main tbody tr[data-car], [data-zz-error]' : 'main [data-car], [data-zz-error]');
  await page.waitForSelector(`${ready}, [data-zz-error]`, { timeout: 45_000 });
  if ((await page.$('[data-zz-error]')) !== null) {
    throw new Error(`ERROR BOUNDARY:\n${(await page.textContent('[data-zz-error]')).slice(0, 1500)}`);
  }
  if (!light) {
    await page.evaluate(() => {
      const root = document.documentElement;
      root.classList.add('dark');
      root.dataset.theme = 'dark';
      root.style.colorScheme = 'dark';
    });
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  return { context, page };
};

// ── the common checks ────────────────────────────────────────────────────────────────────────────
const LATIN_OK = ['ECMS', 'EN', 'Excel'];
/** Latin letters a reader sees: none, but the shell's «ECMS»/«EN», «Excel», and «ATM» in «ضم ATM». */
const latinText = (page) =>
  page.evaluate((allowed) => {
    const found = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const el = node.parentElement;
      if (el === null || el.closest('script,style,[data-zz-error]') !== null) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const inMain = el.closest('main, [data-sheet], [role=dialog]') !== null;
      const text = node.textContent.replace(/ضم ATM/gu, 'ضم');
      for (const word of text.match(/[A-Za-z]+/gu) ?? []) {
        if (allowed.includes(word)) continue;
        // The shell's search box shows «⌘K»: one letter, outside the page — the ref shots' rule.
        if (!inMain && word.length < 2) continue;
        found.add(word);
      }
    }
    return [...found];
  }, LATIN_OK);
const arabicDigits = (page) => page.evaluate(() => (document.body.innerText.match(/[٠-٩]/gu) ?? []).length);
/** Sideways scroll of the page itself and of the shell's scrolling `main`. */
const sideways = (page) =>
  page.evaluate(() => {
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const main = document.querySelector('main');
    const inner = main === null ? 0 : main.scrollWidth - main.clientWidth;
    return Math.max(doc, inner);
  });
/**
 * Text cut by its box: an element showing its own text, clipped (overflow hidden/clip or an ellipsis
 * or a line clamp) and holding more than it shows. Scrollers that scroll on purpose (the counters'
 * row, the code list, a list) are `overflow: auto` and not counted.
 */
const cutText = (page) =>
  page.evaluate(() => {
    const cut = [];
    for (const el of document.querySelectorAll('main *, [data-sheet] *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
      if (!own) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // A note held to three lines with the WHOLE note in its title is today's rule (truncate +
      // title), not a cut — every other clamp still counts.
      if (el.hasAttribute('data-notes') && el.getAttribute('title') === el.textContent) continue;
      const clipsX = /(hidden|clip)/u.test(style.overflowX) || style.textOverflow === 'ellipsis';
      const clamped = style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '';
      const wide = el.scrollWidth > el.clientWidth + 1;
      const tall = el.scrollHeight > el.clientHeight + 1;
      if ((clipsX && wide) || (clamped && tall)) cut.push(el.textContent.trim().slice(0, 40));
    }
    // A table cell's own content wider than its cell (the table scrolls under the pinned actions).
    return [...new Set(cut)];
  });
const unanswered = (page) => page.evaluate(() => [...(window.__zzUnknown ?? [])]);

const common = async (page, label) => {
  const latin = await latinText(page);
  check(label, latin.length === 0, 'no Latin text in the UI', latin.join(', '));
  check(label, (await arabicDigits(page)) === 0, 'no Arabic-Indic digits');
  const side = await sideways(page);
  check(label, side <= 1, 'no sideways page scroll', `${side}px`);
  const cut = await cutText(page);
  check(label, cut.length === 0, 'no cut text', cut.join(' | '));
  const missing = await unanswered(page);
  check(label, missing.length === 0, 'every /api/v1 request answered', missing.join(', '));
  const initials = await page.evaluate(() =>
    [...document.querySelectorAll('main *')]
      .filter((el) => el.children.length === 0 && /^[؀-ۿ]\s?[؀-ۿ]?$/u.test(el.textContent.trim()) && el.closest('[data-car], [data-drivers-panel], [data-sheet]') !== null)
      .map((el) => el.textContent.trim()),
  );
  check(label, initials.length === 0, 'no letter initials drawn (person marks are icon discs)', initials.join(' '));
};

// ── the owner's answers (2026-11-17): Q1 ب, Q2 ج — on every sample shot ────────────────────────────
const FLAG_WORDS = ['الملف موقوف', 'ليس على وظيفة سائق', 'رخصة منتهية'];
const answers = async (page, label) => {
  const r = await page.evaluate((words) => {
    const text = document.body.innerText;
    const main = document.querySelector('main');
    const navs = [...main.querySelectorAll('nav[aria-label="breadcrumb"]')];
    const nav = navs[0] ?? null;
    const link = nav?.querySelector('a') ?? null;
    const head = nav?.closest('.border-b') ?? null;
    const visible = (el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // On screen sideways too: the phone's closed side-menu drawer waits off the screen's edge.
      return box.width > 0 && box.height > 0 && box.right > 0 && box.left < innerWidth && style.visibility !== 'hidden' && style.display !== 'none';
    };
    // Every visible «الطقم الثابت» on the page, its sheets and dialogs that is not the header's own
    // (its h1 and its last crumb). The shell's side menu keeps its «الطقم الثابت» entry — a link to
    // the screen, not a title of it.
    const others = [...document.querySelectorAll('main *, [data-sheet] *, [role="dialog"] *')].filter(
      (el) =>
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === 'الطقم الثابت') &&
        visible(el) &&
        (head === null || !head.contains(el)),
    );
    // The board's first row: the desk toolbar («20 سيارة» · Excel) or the touch car search.
    const firstRow = document.querySelector('main [data-roster-toolbar], main [data-car-search]');
    return {
      words: words.filter((w) => text.includes(w)),
      marks: document.querySelectorAll('[data-problem], [data-driver-out], [data-driver-licence]').length,
      amber: [...document.querySelectorAll('[data-seat-state="filled"], [data-slot-state="filled"], [data-dialog-seat]')]
        .filter((el) => /(^|\s)(dark:)?border-amber-(400|500|600)/u.test(el.className))
        .map((el) => el.closest('[data-car]')?.getAttribute('data-car') ?? '?'),
      navs: navs.length,
      linkText: link?.textContent.trim() ?? null,
      href: link?.getAttribute('href') ?? null,
      crumbs: nav === null ? [] : [...nav.querySelectorAll('li')].map((li) => li.textContent.trim()),
      h1s: [...main.querySelectorAll('h1')].map((el) => el.textContent.trim()),
      titleInHead: head !== null && [...head.querySelectorAll('h1')].some((el) => el.textContent.trim() === 'الطقم الثابت'),
      others: others.map((el) => el.tagName.toLowerCase()),
      headControls: head === null ? -1 : head.querySelectorAll('button, [data-export], a[download]').length,
      headAbove:
        head !== null &&
        firstRow !== null &&
        (head.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
        head.getBoundingClientRect().bottom <= firstRow.getBoundingClientRect().top + 1,
      excel: document.querySelectorAll('[data-export]').length,
      excelButtons: [...document.querySelectorAll('button, a')].filter((el) =>
        /إكسيل|Excel/u.test(`${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.textContent}`),
      ).length,
      standing: document.querySelectorAll('[data-standing-box]').length,
      // The room under the header (V-R2-3): from its bottom line to the board's first row, read
      // only on an unscrolled page (a stuck portrait filter block sits elsewhere by design).
      gap:
        head === null || firstRow === null || !visible(firstRow) || main.scrollTop > 0 || scrollY > 0
          ? null
          : Math.round(firstRow.getBoundingClientRect().top - head.getBoundingClientRect().bottom),
    };
  }, FLAG_WORDS);
  check(label, r.words.length === 0 && r.marks === 0, 'Q1 ب: no «الملف موقوف» / «ليس على وظيفة سائق» / «رخصة منتهية» anywhere', `${r.words.join(', ')} marks ${r.marks}`);
  check(label, r.amber.length === 0, 'Q1 ب: no amber frame on any seat', r.amber.join(' '));
  check(label, r.navs === 1 && r.linkText === 'الحركة' && /\/fleet$/u.test(r.href ?? '') && r.crumbs.join(' › ') === 'الحركة › الطقم الثابت', 'Q2 ج: the header\'s breadcrumb «الحركة» (link to /fleet) › «الطقم الثابت», once', JSON.stringify({ navs: r.navs, link: r.linkText, href: r.href, crumbs: r.crumbs }));
  check(label, r.h1s.length === 1 && r.h1s[0] === 'الطقم الثابت' && r.titleInHead && r.others.length === 0, 'Q2 ج: ONE title «الطقم الثابت» (the header\'s), no second one on the board', JSON.stringify({ h1s: r.h1s, others: r.others }));
  check(label, r.headControls === 0 && r.headAbove, 'Q2 ج: the header on top, with no Excel or other action in it', JSON.stringify({ controls: r.headControls, above: r.headAbove }));
  check(label, r.excel === 1 && r.excelButtons === 1, 'one Excel control', `data-export ${r.excel}, buttons ${r.excelButtons}`);
  check(label, r.standing === 0, 'Q2 ج: no «الطقم الثابت» box in the stepper\'s place (StandingBox gone)');
  if (r.gap === null) info(label, 'room under the header not read (scrolled, or no board row yet)');
  else check(label, Math.abs(r.gap - 24) <= 1, 'the board starts 24px under the header\'s line (its mb-6), as today\'s page at every width', `${r.gap}px`);
};

const shot = async (page, file, options = {}) => {
  if (!file.startsWith(REF)) await answers(page, `${file.replace(`${HERE}/`, '')}`);
  await page.screenshot({ path: file, ...options });
  lines.push(`SHOT ${file.replace(`${HERE}/`, '')}`);
};

/** The laptop rule (Q2 ج): with the header back, the table still shows at least `min` whole rows. */
const rowsFit = async (page, label, min) => {
  const r = await page.evaluate(() => {
    const scroller = document.querySelector('[data-roster-table] table').parentElement;
    const top = scroller.getBoundingClientRect().top;
    const bottom = top + scroller.clientHeight;
    const rows = [...document.querySelectorAll('main tbody tr[data-car]')];
    const main = document.querySelector('main');
    return {
      whole: rows.filter((tr) => {
        const b = tr.getBoundingClientRect();
        return b.top >= top - 1 && b.bottom <= bottom + 1;
      }).length,
      tableTop: Math.round(top),
      down: main.scrollHeight - main.clientHeight,
    };
  });
  const { width, height } = page.viewportSize();
  info(label, `${width}×${height}: ${r.whole} whole rows under the header (table from ${r.tableTop}px)`);
  check(label, r.whole >= min, `at least ${min} whole rows fit under the header at ${width}×${height}`, String(r.whole));
  check(label, r.down <= 1, 'the page itself never scrolls (the table scrolls inside)', `${r.down}px`);
};

/** Grow the viewport until neither the page nor `main` has anything left to scroll down. */
const growToContent = async (page, width) => {
  for (let i = 0; i < 12; i += 1) {
    const need = await page.evaluate(() => {
      const main = document.querySelector('main');
      const inner = main === null ? 0 : main.scrollHeight - main.clientHeight;
      return Math.max(document.documentElement.scrollHeight - innerHeight, inner);
    });
    if (need <= 1) return;
    const { height } = page.viewportSize();
    await page.setViewportSize({ width, height: height + need });
    await page.waitForTimeout(250);
  }
};

/**
 * The owner's computer shots end on a WHOLE row (look L7): the viewport is shortened by the part of
 * the row the table's frame cuts, so the frame's bottom meets a row boundary.
 */
const fitRows = async (page, label) => {
  for (let i = 0; i < 3; i += 1) {
    const cut = await page.evaluate(() => {
      const scroller = document.querySelector('[data-roster-table] table')?.parentElement;
      if (scroller === null || scroller === undefined) return 0;
      const bottom = scroller.getBoundingClientRect().top + scroller.clientHeight;
      for (const tr of document.querySelectorAll('main tbody tr[data-car]')) {
        const r = tr.getBoundingClientRect();
        if (r.top < bottom - 1 && r.bottom > bottom + 1) return Math.ceil(bottom - r.top);
      }
      return 0;
    });
    if (cut === 0) break;
    const { width, height } = page.viewportSize();
    await page.setViewportSize({ width, height: height - cut });
    await page.waitForTimeout(300);
  }
  const whole = await page.evaluate(() => {
    const scroller = document.querySelector('[data-roster-table] table')?.parentElement;
    const bottom = scroller.getBoundingClientRect().top + scroller.clientHeight;
    return [...document.querySelectorAll('main tbody tr[data-car]')].every((tr) => {
      const r = tr.getBoundingClientRect();
      return r.bottom <= bottom + 1 || r.top >= bottom - 1;
    });
  });
  check(label, whole, 'the table frame ends on a whole row (no half row at the bottom)', `viewport ${page.viewportSize().height}px`);
};

/**
 * The drivers list ends on a whole row too: when a row or the «معيّنون على سيارات أخرى» head peeks in
 * at the panel's bottom edge, the viewport loses that sliver — only when the table has the room under
 * its last row (no table row is cut for it).
 */
const fitPanel = async (page, label) => {
  const d = await page.evaluate(() => {
    const list = document.querySelector('[data-drivers-list="pool"]');
    const edge = list.getBoundingClientRect().bottom;
    const cross = [...list.querySelectorAll('li, [data-seated-head]')].find((el) => {
      const r = el.getBoundingClientRect();
      return r.top < edge - 1 && r.bottom > edge + 1;
    });
    if (cross === undefined) return 0;
    const need = Math.ceil(edge - cross.getBoundingClientRect().top);
    const scroller = document.querySelector('[data-roster-table] table').parentElement;
    const frame = scroller.getBoundingClientRect().top + scroller.clientHeight;
    const last = Math.max(...[...document.querySelectorAll('main tbody tr[data-car]')].map((tr) => tr.getBoundingClientRect().bottom).filter((b) => b <= frame + 1));
    return need <= frame - last + 1 ? need : 0;
  });
  if (d > 0) {
    const { width, height } = page.viewportSize();
    await page.setViewportSize({ width, height: height - d });
    await page.waitForTimeout(300);
  }
  const whole = await page.evaluate(() => {
    const list = document.querySelector('[data-drivers-list="pool"]');
    const edge = list.getBoundingClientRect().bottom;
    // The head's WORDS (its top padding may sit above the edge with nothing drawn in it).
    return [...list.querySelectorAll('[data-seated-head]')].every((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return r.bottom <= edge + 1 || r.top >= edge - 1;
    });
  });
  check(label, whole, 'no half-shown section head at the drivers list\'s bottom edge', `viewport ${page.viewportSize().height}px`);
};

/**
 * V-R2-1: an owner computer picture that must SHOW given rows (the edit's 214) and/or the drivers
 * list to its end («معيّنون على سيارات أخرى (1)» · «إيهاب … سيارة أخرى», told item 9). The header
 * costs ~109px at 1920×1080, so the viewport GROWS (never shrinks) until each is whole, then on to
 * the next whole table row. The laptop rule itself is read at 1920×1080 before (rowsFit).
 */
const growToShow = async (page, label, { rows = [], poolEnd = false }) => {
  const start = page.viewportSize().height;
  const measure = () =>
    page.evaluate(
      ({ rows, poolEnd }) => {
        const scroller = document.querySelector('[data-roster-table] table').parentElement;
        const frame = scroller.getBoundingClientRect().top + scroller.clientHeight;
        let need = 0;
        for (const code of rows) {
          const tr = document.querySelector(`main tbody tr[data-car="${code}"]`);
          need = Math.max(need, tr.getBoundingClientRect().bottom - frame);
        }
        if (poolEnd) {
          const list = document.querySelector('[data-drivers-list="pool"]');
          const items = list.querySelectorAll('li, [data-seated-head]');
          need = Math.max(need, items[items.length - 1].getBoundingClientRect().bottom - list.getBoundingClientRect().bottom);
        }
        let cut = 0;
        for (const tr of document.querySelectorAll('main tbody tr[data-car]')) {
          const r = tr.getBoundingClientRect();
          if (r.top < frame - 1 && r.bottom > frame + 1) cut = Math.ceil(r.bottom - frame);
        }
        return { need: Math.ceil(need), cut };
      },
      { rows, poolEnd },
    );
  for (let i = 0; i < 6; i += 1) {
    const { need, cut } = await measure();
    const more = need > 0 ? need : cut;
    if (more <= 0) break;
    const { width, height } = page.viewportSize();
    await page.setViewportSize({ width, height: height + more });
    await page.waitForTimeout(300);
  }
  const seen = await page.evaluate(
    ({ rows, poolEnd }) => {
      const scroller = document.querySelector('[data-roster-table] table').parentElement;
      const top = scroller.getBoundingClientRect().top;
      const frame = top + scroller.clientHeight;
      const whole = (el, lo, hi) => {
        const b = el.getBoundingClientRect();
        return b.top >= lo - 1 && b.bottom <= hi + 1;
      };
      const list = document.querySelector('[data-drivers-list="pool"]');
      const l = list.getBoundingClientRect();
      const head = list.querySelector('[data-seated-head]');
      const last = [...list.querySelectorAll('li')].at(-1);
      return {
        rows: rows.filter((code) => whole(document.querySelector(`main tbody tr[data-car="${code}"]`), top, frame)),
        pool: !poolEnd || (head !== null && whole(head, l.top, l.bottom) && whole(last, l.top, l.bottom)),
        headText: head?.textContent.trim() ?? '',
        lastText: last?.textContent ?? '',
      };
    },
    { rows, poolEnd },
  );
  const { width, height } = page.viewportSize();
  info(label, `owner picture grown ${start}px → ${height}px tall at ${width} to show ${[...rows, ...(poolEnd ? ['the pool to its end'] : [])].join(' · ')}`);
  if (rows.length > 0) check(label, seen.rows.length === rows.length, `the picture shows ${rows.join(' · ')} whole`, seen.rows.join(' '));
  if (poolEnd) {
    check(
      label,
      seen.pool && seen.headText.replace(/\s+/gu, ' ').startsWith('معيّنون على سيارات أخرى') && seen.lastText.includes('إيهاب سمير الحسيني') && seen.lastText.includes('سيارة أخرى'),
      'the picture shows the drivers list to its end: «معيّنون على سيارات أخرى» + «إيهاب سمير الحسيني» «سيارة أخرى» (told 9)',
      `${seen.headText} | ${seen.lastText}`,
    );
  }
};

/** Every note: ≤ 3 lines, the whole note in its title, never under the pinned «إجراءات». */
const checkNotes = async (page, label) => {
  const notes = await page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll('main tbody tr[data-car]')) {
      const note = tr.querySelector('[data-notes]');
      if (note === null) continue;
      const pinned = tr.querySelector('td:last-child [data-row-actions]')?.closest('td') ?? null;
      const n = note.getBoundingClientRect();
      const lines = Math.round(n.height / parseFloat(getComputedStyle(note).lineHeight));
      out.push({
        code: tr.dataset.car,
        lines,
        titled: note.getAttribute('title') === note.textContent,
        under: pinned === null ? 0 : Math.max(0, pinned.getBoundingClientRect().right - n.left),
        row: Math.round(tr.getBoundingClientRect().height),
      });
    }
    const scroller = document.querySelector('[data-roster-table] table').parentElement;
    return { out, overflow: scroller.scrollWidth - scroller.clientWidth };
  });
  info(label, `notes: ${notes.out.map((n) => `${n.code} ${n.lines}L/${n.row}px`).join(' · ')} · table overflow ${notes.overflow}px`);
  check(label, notes.out.every((n) => n.lines <= 3 && n.titled), 'every note ≤ 3 lines, the whole note in its title (today\'s truncate + title)', JSON.stringify(notes.out.filter((n) => n.lines > 3 || !n.titled)));
  check(label, notes.out.every((n) => n.under <= 1), 'no note box under the pinned «إجراءات»', JSON.stringify(notes.out.filter((n) => n.under > 1)));
  check(label, notes.overflow <= 1, 'the table fits its frame (nothing scrolls under the pinned column)', `${notes.overflow}px`);
};

/** The drivers panel: free drivers first, then the grey section with everyone a crew holds. */
const checkPoolOrder = async (page, label, scope, wantSection) => {
  const r = await page.evaluate((sel) => {
    const box = document.querySelector(sel);
    const head = box.querySelector('[data-seated-head]');
    const rows = [...box.querySelectorAll('[data-driver-card], [data-seated-driver]')];
    const after = (el) => head !== null && (head.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const held = rows.filter((el) => el.hasAttribute('data-held-elsewhere'));
    return {
      head: head?.textContent.replace(/\s+/gu, ' ').trim() ?? null,
      heldAfter: held.every(after),
      freeBefore: rows.filter((el) => !el.hasAttribute('data-held-elsewhere') && !el.hasAttribute('data-seated-driver')).every((el) => !after(el)),
      heldBlue: held.every((el) =>
        [...el.querySelectorAll('span')].some((s) => s.textContent.trim() === 'سيارة أخرى' && /sky|blue/u.test(s.className)),
      ),
    };
  }, scope);
  check(label, r.head === wantSection, `section «${wantSection}» under the free drivers`, String(r.head));
  check(label, r.heldAfter && r.freeBefore, 'free drivers first, every «سيارة أخرى» driver in the section');
  check(label, r.heldBlue, '«سيارة أخرى» in the daily\'s info (blue) tone');
};

// ── reading the board ────────────────────────────────────────────────────────────────────────────
const counters = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('main [data-counter]')].map((el) => {
        const spans = el.querySelectorAll(':scope > span');
        return [spans[0].textContent.trim(), Number(spans[1].textContent.trim())];
      }),
    ),
  );
const carsShown = (page) =>
  page.evaluate(() => [...document.querySelectorAll('main [data-car]')].map((el) => el.getAttribute('data-car')));

const checkCounters = async (page, label, want, missions = FIG.missions) => {
  const got = await counters(page);
  info(label, `counters: ${Object.entries(got).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  check(label, got['إجمالي'] === want.cars, `«إجمالي» = ${want.cars}`, String(got['إجمالي']));
  check(label, got['صيانة'] === want.workshop, `«صيانة» = ${want.workshop}`, String(got['صيانة']));
  check(label, got['بطقم'] === want.crewed, `«بطقم» = ${want.crewed}`, String(got['بطقم']));
  check(label, got['بلا طقم'] === want.uncrewed, `«بلا طقم» = ${want.uncrewed}`, String(got['بلا طقم']));
  check(label, got['بطقم'] + got['بلا طقم'] === got['إجمالي'], '«بطقم» + «بلا طقم» = «إجمالي»');
  if (missions !== null) {
    const wrong = Object.entries(missions).filter(([name, n]) => got[name] !== n);
    check(label, wrong.length === 0, 'one chip per mission type, counts as the figure set', wrong.map(([k, v]) => `${k}: ${got[k]}≠${v}`).join(', '));
  }
  // The day's counters are not on a standing board.
  const day = ['تشغيل', 'جاهزة', 'بلا سائق', 'غياب الطاقم الثابت'].filter((k) => k in got && !(k in FIG.missions));
  check(label, day.length === 0, 'no day counters («تشغيل», «جاهزة», «غياب الطاقم الثابت»)', day.join(', '));
  return got;
};

const noDayWords = async (page, label) => {
  const words = await page.evaluate(() => {
    const text = document.querySelector('main')?.innerText ?? '';
    return ['اليوم', 'التاريخ', 'في هذا التاريخ', 'خطة اليوم', 'يوم سابق', 'متاح ', 'غير المتاحين'].filter((w) => text.includes(w));
  });
  check(label, words.length === 0, 'no day words on the board', words.join(', '));
};

// ── FUNCS: every function of fixed-functions.md, visible or reachable (per layout) ──────────────
const FUNCS_DESK = [
  ['F1 no date stepper / no past banner', 'main:not(:has([data-day-stepper], [data-readonly-day]))'],
  ['F3 seat 2 waits for seat 1 («عيّن السائق الأول أولاً»)', '[data-drop-disabled="needsFirstDriver"]'],
  ['F4 workshop car keeps an editable crew (mission select enabled on 163)', 'tr[data-car="163"] select:not([disabled])'],
  ['F4 workshop car: «+ اختيار سائق» on 176', 'tr[data-car="176"] [data-seat-state="empty"] button[aria-haspopup]'],
  ['F6/F7 code with the car card on hover', 'tr[data-car="150"] td:first-child span[dir="ltr"]'],
  ['F8 «الحالة» badges (workshop + crewed/uncrewed)', 'tr[data-car="163"] [data-status-cell]'],
  ['F8 «بلا طقم» badge', 'tr[data-car="158"] [data-uncrewed]'],
  ['F9 «نوع المهمة» in-cell select', 'tr[data-car="150"] select'],
  ['F10 seat drop zones', '[data-drop-zone]'],
  ['F10 filled seat: name + code + bin', 'tr[data-car="150"] [data-seat-state="filled"] [data-clear-slot]'],
  ['F11 driver card on the seat name (hover)', 'tr[data-car="150"] [data-driver-chip]'],
  ['F12 «ملاحظات»', 'tr[data-car="150"] [data-notes]'],
  ['F13 pen «تعديل» on every row', 'tr[data-car="158"] [data-edit-row]'],
  ['F13/F23 crew bin «إفراغ الطقم»', 'tr[data-car="150"] [data-clear-crew]'],
  ['NEW swap «تبديل السائق الأول والثاني»', 'tr[data-car="163"] [data-swap-drivers]'],
  ['F18 «سيارة أخرى» badge in the pool', '[data-drivers-panel] [data-driver-card]'],
  ['F19 pool panel: heading + count + search + list', '[data-drivers-panel] [data-drivers-head]'],
  ['F19 pool search', '[data-drivers-panel] input'],
  ['F20 pool rows drag', '[data-drivers-panel] [draggable="true"]'],
  ['F21 «+ اختيار سائق» picker', '[data-seat-state="empty"] button[aria-haspopup]'],
  ['F36 «كود السيارة» filter', '[data-roster-filters] [aria-haspopup], [data-roster-filters] input, [data-roster-filters] button'],
  ['F38 chips (counters + filters)', '[data-counter="total"][aria-pressed="true"]'],
  ['F43 sortable «كود السيارة» / «الحالة»', 'thead th [aria-sort], thead th button'],
  ['F45 Excel', '[data-export="roster"]'],
  ['F46 Q2 ج header: breadcrumb «الحركة» → /fleet', 'main nav[aria-label="breadcrumb"] a[href$="/fleet"]'],
  ['F46 Q2 ج header: title h1', 'main h1'],
  ['F48 full-height page (table and panel scroll inside)', '[data-roster-table] [class*="overflow"]'],
];
const checkFuncs = async (page, label, funcs) => {
  for (const [what, selector] of funcs) {
    const found = await page.$(selector);
    check(label, found !== null, what, selector);
  }
};

// ── the shots ────────────────────────────────────────────────────────────────────────────────────
const SHOTS = {};

/** Owner shot 1 — the computer, 1920, the company, a planner. */
SHOTS['fixed-dark'] = async (browser) => {
  const label = 'fixed-dark';
  const { context, page } = await open(browser, { width: 1920, height: 1080, label });
  await common(page, label);
  await noDayWords(page, label);
  const rows = await carsShown(page);
  check(label, rows.length === 20 && rows.join() === CODES_COMPANY.join(), '20 rows in the fleet order (150 upward, «الملاكى» last)', rows.join(' '));
  check(label, (await page.textContent('[data-filtered-count]')).trim() === '20 سيارة', 'toolbar «20 سيارة»');
  await checkCounters(page, label, FIG.company);
  const head = (await page.textContent('[data-drivers-head]')).replace(/\s+/gu, '');
  check(label, head === `السائقون(${FIG.company.pool})`, `pool heading «السائقون (${FIG.company.pool})»`, head);
  const pool = await page.$$eval('[data-drivers-panel] [data-driver-card]', (els) => els.length);
  check(label, pool === FIG.company.pool, `pool lists ${FIG.company.pool} drivers`, String(pool));
  const other = await page.$$eval('[data-drivers-panel] li', (els) => els.filter((el) => el.textContent.includes('سيارة أخرى')).map((el) => el.textContent));
  check(label, other.length === 1 && other[0].includes('إيهاب سمير الحسيني'), '«سيارة أخرى» on «إيهاب سمير الحسيني» only (car 199 out of service)', other.join(' | '));
  const noFree = await page.evaluate(() => !document.querySelector('[data-drivers-panel]').textContent.includes('متاح'));
  check(label, noFree, 'no «متاح» badge in the pool');
  await checkPoolOrder(page, label, '[data-drivers-panel]', 'معيّنون على سيارات أخرى (1)');
  check(label, (await page.$('[data-edits-bar]')) === null, 'no unsaved bar on arrival');
  await checkFuncs(page, label, FUNCS_DESK);
  const ws = await page.$$eval('tr[data-tint="workshop"]', (els) => els.map((el) => el.getAttribute('data-car')));
  check(label, ws.join() === '163,176,340', 'workshop rows tinted rose (163 · 176 · 340)', ws.join());
  // L2/L4: a heading, and the gap counter in the daily's gap hue.
  const looks = await page.evaluate(() => {
    const head = document.querySelector('[data-drivers-head]');
    const style = (el) => getComputedStyle(el);
    return {
      headShadow: style(head).boxShadow,
      uncrewed: document.querySelector('[data-counter="uncrewed"]').className,
      workshop: document.querySelector('[data-counter="workshop"]').className,
    };
  });
  check(label, looks.headShadow === 'none', 'pool heading is a plain heading (no raised pill)', looks.headShadow);
  // Q2 ج: the toolbar row is the daily's: «20 سيارة» at the start, the Excel pill at the end — nothing
  // in the day stepper's place.
  const toolbar = await page.evaluate(() => {
    const bar = document.querySelector('[data-roster-toolbar]');
    return { kids: bar.children.length, excel: bar.querySelector('[data-export="roster"]') !== null };
  });
  check(label, toolbar.kids === 2 && toolbar.excel, 'toolbar row = «20 سيارة» + the Excel pill, nothing in the stepper\'s place', JSON.stringify(toolbar));
  // Q1 ب: 247's «صبري أنور الفقي» (switched-off profile) and 410's «وائل رشاد عبد الغني» (expired
  // licence) sit in their seats as any driver does; «حمدي عبد الستار رزق» is a plain pool row.
  const plain = await page.evaluate(() => ({
    sabry: document.querySelector('tr[data-car="247"] [data-drop-zone$=":driver2EmployeeId"]')?.textContent ?? '',
    wael: document.querySelector('tr[data-car="410"] [data-drop-zone$=":driver2EmployeeId"]')?.textContent ?? '',
    hamdy: [...document.querySelectorAll('[data-drivers-panel] [data-driver-card]')].find((el) => el.textContent.includes('حمدي عبد الستار رزق'))?.textContent ?? '',
  }));
  check(label, plain.sabry.replace(/\s+/gu, '') === 'صبريأنورالفقي12259' && plain.wael.replace(/\s+/gu, '') === 'وائلرشادعبدالغني11968' && plain.hamdy.replace(/\s+/gu, '') === 'حمديعبدالستاررزق12113', 'Q1 ب: 247 / 410 seats and «حمدي» in the pool carry name + code only', JSON.stringify(plain));
  check(label, looks.uncrewed.includes('yellow') && !looks.uncrewed.includes('rose') && looks.workshop.includes('rose'), '«بلا طقم» in the daily gap hue (yellow); rose stays the workshop\'s');
  await checkNotes(page, label);
  await rowsFit(page, label, 9);
  await growToShow(page, label, { poolEnd: true });
  await fitRows(page, label);
  await fitPanel(page, label);
  await common(page, `${label} (fitted)`);
  await shot(page, join(HERE, 'fixed-dark.png'));
  // The car card on 150 (hover): «مرسيدس اسيليو 915» in «المهندسين».
  await page.hover('tr[data-car="150"] td:first-child span[dir="ltr"]');
  await page.waitForTimeout(700);
  const card = await page.evaluate(() => document.body.innerText);
  check(label, card.includes('مرسيدس اسيليو 915') && card.includes('المهندسين'), 'car card of 150: «مرسيدس اسيليو 915» · «المهندسين»');
  await shot(page, join(EXTRA, 'fixed-1920-carcard-dark.png'));
  await context.close();
};

/** Owner shot 2 — the computer, 1920, the top bar on «المهندسين». */
SHOTS['fixed-branch-dark'] = async (browser) => {
  const label = 'fixed-branch-dark';
  const { context, page } = await open(browser, { width: 1920, height: 1080, label, branch: MOHANDESSIN });
  await common(page, label);
  await noDayWords(page, label);
  const switcher = await page.evaluate(() => document.querySelector('header')?.innerText ?? '');
  check(label, switcher.includes('المهندسين'), 'the top bar names «المهندسين»');
  const rows = await carsShown(page);
  check(label, rows.join() === CODES_BRANCH.join(), `${FIG.branch.cars} rows of «المهندسين»`, rows.join(' '));
  await checkCounters(page, label, FIG.branch, null);
  const head = (await page.textContent('[data-drivers-head]')).replace(/\s+/gu, '');
  check(label, head === `السائقون(${FIG.branch.pool})`, `company-wide pool «السائقون (${FIG.branch.pool})»`, head);
  const other = await page.$$eval('[data-drivers-panel] li', (els) => els.filter((el) => el.textContent.includes('سيارة أخرى')).length);
  check(label, other === FIG.branch.otherVehicle, `«سيارة أخرى» on ${FIG.branch.otherVehicle} drivers (held on other branches' cars + 199)`, String(other));
  await checkPoolOrder(page, label, '[data-drivers-panel]', `معيّنون على سيارات أخرى (${FIG.branch.otherVehicle})`);
  const firstTen = await page.$$eval('[data-drivers-panel] [data-driver-card]', (els) => els.slice(0, 10).map((el) => el.hasAttribute('data-held-elsewhere')));
  check(label, firstTen.length === 10 && firstTen.every((held) => !held), 'the 10 free drivers lead the list');
  await checkNotes(page, label);
  await fitRows(page, label);
  await fitPanel(page, label);
  await shot(page, join(HERE, 'fixed-branch-dark.png'));
  await context.close();
};

/** The edit scenario (gap map §9) — 1920, company. */
const editScenario = async (page, label) => {
  // (1) «+ اختيار سائق» on 158 seat 1 → «بدر الدين عاطف سالم».
  await page.click('tr[data-car="158"] [data-drop-zone$=":driver1EmployeeId"] button[aria-haspopup]');
  await page.waitForSelector('[data-driver-picker-panel] input');
  await page.fill('[data-driver-picker-panel] input', 'بدر الدين');
  await page.waitForTimeout(300);
  await page.click(`[data-driver-picker-panel] [data-driver-option="${BADR}"]`);
  const seat1 = await page.$eval('tr[data-car="158"] [data-drop-zone$=":driver1EmployeeId"]', (el) => el.textContent);
  check(label, seat1.includes('بدر الدين عاطف سالم'), '158 seat 1 = «بدر الدين عاطف سالم» (picked)', seat1);
  // (2) drag «طارق محمود فهمي» from 214 seat 2 onto 171 seat 2.
  await page.dragAndDrop('tr[data-car="214"] [data-drop-zone$=":driver2EmployeeId"] [data-driver-chip]', 'tr[data-car="171"] [data-drop-zone$=":driver2EmployeeId"]');
  // (3) ⇄ on 205.
  await page.click('tr[data-car="205"] [data-swap-drivers]');
  // (4) 433's mission «بدون نوع مهمة» → «مسائي».
  const evening = await page.$eval('tr[data-car="433"] select', (sel) => [...sel.options].find((o) => o.textContent.trim() === 'مسائي')?.value ?? '');
  await page.selectOption('tr[data-car="433"] select', evening);
  await page.waitForTimeout(500);
  const bar = await page.$$eval('[data-edited-code]', (els) => els.map((el) => el.getAttribute('data-edited-code')));
  check(label, bar.slice().sort().join() === FIG.edited.codes.join(), `the bar lists ${FIG.edited.codes.join(' · ')}`, bar.join());
  const amber = await page.$$eval('tr[data-tint="unsaved"]', (els) => els.map((el) => el.getAttribute('data-car')).sort());
  check(label, amber.join() === FIG.edited.codes.join(), 'exactly those rows amber', amber.join());
  const hint = await page.$eval('tr[data-car="171"]', (el) => el.querySelector('[data-transfer-hint]')?.textContent ?? '');
  check(label, hint.includes('سيُنقل من السيارة 214 عند الحفظ'), 'move strip «سيُنقل من السيارة 214 عند الحفظ» on 171', hint);
  const got = await counters(page);
  check(label, got['بطقم'] === FIG.edited.crewed && got['بلا طقم'] === FIG.edited.uncrewed && got['مسائي'] === FIG.edited.evening, 'counters follow the draft (بطقم 17 · بلا طقم 3 · مسائي 2)', JSON.stringify(got));
  const head = (await page.textContent('[data-drivers-head]')).replace(/\s+/gu, '');
  check(label, head === `السائقون(${FIG.edited.pool})`, `pool «السائقون (${FIG.edited.pool})»`, head);
  check(label, (await page.$('[data-undo-edit]:not([disabled])')) !== null, '«تراجع» live');
};

SHOTS['fixed-edit-dark'] = async (browser) => {
  const label = 'fixed-edit-dark';
  const { context, page } = await open(browser, { width: 1920, height: 1080, label });
  await editScenario(page, label);
  await common(page, label);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  // 214 is where the moved «طارق محمود فهمي» comes from (its seat 2 now «اختيار سائق»).
  await growToShow(page, label, { rows: ['158', '171', '205', '214'], poolEnd: true });
  const from214 = await page.$eval('tr[data-car="214"]', (tr) => ({
    tint: tr.getAttribute('data-tint'),
    seat2: tr.querySelector('[data-drop-zone$=":driver2EmployeeId"]')?.textContent ?? '',
  }));
  check(label, from214.tint === 'unsaved' && from214.seat2.includes('اختيار سائق') && !from214.seat2.includes('طارق'), '214 in the picture: amber, seat 2 emptied («اختيار سائق»)', JSON.stringify(from214));
  await fitRows(page, label);
  await fitPanel(page, label);
  await common(page, `${label} (fitted)`);
  await shot(page, join(HERE, 'fixed-edit-dark.png'));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(300);
  // «تراجع» takes back the mission; «إلغاء» asks first (more than one car), then empties the bar.
  await page.click('[data-undo-edit]');
  await page.waitForTimeout(300);
  const after = await page.$$eval('[data-edited-code]', (els) => els.map((el) => el.getAttribute('data-edited-code')).sort());
  check(label, !after.includes('433'), '«تراجع» takes back the last edit (433 mission)', after.join());
  await page.click('[data-discard-edits]');
  await page.waitForSelector('[data-confirm="discard"]');
  check(label, true, '«إلغاء» asks first when more than one car changed');
  await shot(page, join(EXTRA, 'fixed-1920-discard-confirm-dark.png'));
  await page.click('[data-confirm="discard"]');
  await page.waitForTimeout(400);
  check(label, (await page.$('[data-edits-bar]')) === null, '«إلغاء التغييرات» drops every edit');
  // A save: the pen dialog on 158, then «حفظ» → toast «تم حفظ الطقم الثابت».
  await page.click('tr[data-car="158"] [data-edit-row]');
  const DIALOG = '[role="dialog"]:has-text("نوع المهمة والطقم والملاحظات")';
  await page.waitForSelector(DIALOG);
  await page.waitForTimeout(400);
  const dialog = await page.textContent(DIALOG);
  check(label, dialog.includes('تعديل · 158') && dialog.includes('نوع المهمة والطقم والملاحظات — تُحفظ معًا'), 'pen dialog «تعديل · 158» with its hint');
  // L6: the seats in the daily DriverSlot look — no native seat selects; seat 2 waits for seat 1.
  check(label, (await page.$$(`${DIALOG} select`)).length === 1, 'one select only (the mission); the seats are name rows / «اختيار سائق»');
  check(label, (await page.$(`${DIALOG} [data-dialog-seat="driver2"] button[disabled]`)) !== null && dialog.includes('عيّن السائق الأول أولاً'), 'seat 2 disabled with «عيّن السائق الأول أولاً»');
  await page.click(`${DIALOG} [data-dialog-seat="driver1"] button:has-text("اختيار سائق")`);
  await page.waitForTimeout(300);
  const offered = await page.$$eval(`${DIALOG} [data-dialog-option]`, (els) => els.map((el) => el.textContent));
  check(label, offered.length === FIG.company.pool && offered.some((o) => o.includes('إيهاب سمير الحسيني') && o.includes('سيارة أخرى')) && offered.some((o) => o.includes('حمدي') && !o.includes('رخصة منتهية')), `the list: the ${FIG.company.pool} of the pool, «سيارة أخرى» on «إيهاب», no licence flag on «حمدي» (Q1 ب)`, String(offered.length));
  await common(page, `${label} dialog`);
  await shot(page, join(EXTRA, 'fixed-1920-dialog-dark.png'));
  await page.click(`${DIALOG} [data-dialog-option="${BADR}"]`);
  await page.waitForTimeout(200);
  const seated = await page.textContent(`${DIALOG} [data-dialog-seat="driver1"]`);
  check(label, seated.includes('بدر الدين عاطف سالم') && seated.includes('12221'), 'seat 1 = name row «بدر الدين عاطف سالم · 12221» with ✕');
  check(label, (await page.$(`${DIALOG} [data-dialog-seat="driver2"] button:not([disabled])`)) !== null, 'seat 2 opens once seat 1 is set');
  await page.click(`${DIALOG} button:has-text("حفظ")`);
  await page.waitForTimeout(300);
  await page.click('[data-save-roster]');
  await page.waitForTimeout(900);
  const toast = await page.evaluate(() => document.body.innerText.includes('تم حفظ الطقم الثابت'));
  check(label, toast, '«حفظ» → toast «تم حفظ الطقم الثابت», bar gone');
  check(label, (await page.$('[data-edits-bar]')) === null, 'no bar after the save');
  await context.close();
};

/** Owner shot 3 — the tablet, 768 (portrait). */
SHOTS['fixed-tablet-dark'] = async (browser) => {
  const label = 'fixed-tablet-dark';
  const { context, page } = await open(browser, { width: 768, height: 1024, label });
  await common(page, label);
  await noDayWords(page, label);
  check(label, (await page.$('[data-roster-touch="portrait"]')) !== null, 'portrait board');
  const cards = await carsShown(page);
  check(label, cards.join() === CODES_COMPANY.join(), '20 cards in the fleet order, workshop cars in their place', cards.join(' '));
  check(label, (await page.$('[data-workshop-group]')) === null, 'no folded workshop group');
  check(label, (await page.$('[data-car="163"] [data-mission]')) !== null, 'workshop car 163: mission pill editable');
  check(label, (await page.$('[data-car="176"] [data-slot-state="empty"]')) !== null, 'workshop car 176: «اختيار سائق» seat');
  check(label, (await page.$('[data-car="163"] [data-swap-drivers]')) !== null, 'workshop car 163: swap');
  await checkCounters(page, label, FIG.company);
  const pool = (await page.textContent('[data-open-pool]')).trim();
  check(label, pool.includes(String(FIG.company.pool)), `«السائقون» button counts ${FIG.company.pool}`, pool);
  check(label, (await page.$('[data-car-search]')) !== null, 'car-code search');
  check(label, (await page.$('[data-open-filters]')) !== null, '«عوامل التصفية»');
  await shot(page, join(HERE, 'fixed-tablet-dark.png'));
  // The ⋮ menu: «تعديل» and «إفراغ الطقم».
  await page.click('[data-card-menu="150"]');
  await page.waitForTimeout(250);
  const menu = await page.$$eval('[role="menu"] [data-menu-item]', (els) => els.map((el) => el.textContent.trim()));
  check(label, menu.join() === 'تعديل,إفراغ الطقم', '⋮ «تعديل» · «إفراغ الطقم»', menu.join());
  await shot(page, join(EXTRA, 'fixed-768-menu-dark.png'));
  await context.close();
};

/** Owner shot 4 — the phone, 375, the whole board. */
SHOTS['fixed-phone-dark'] = async (browser) => {
  const label = 'fixed-phone-dark';
  const { context, page } = await open(browser, { width: 375, height: 812, label });
  await common(page, label);
  await noDayWords(page, label);
  check(label, (await page.$('[data-roster-touch="phone"]')) !== null, 'phone board');
  await checkCounters(page, label, FIG.company);
  const cards = await carsShown(page);
  check(label, cards.length === 20, '20 cards', String(cards.length));
  const plain = await page.evaluate(() => ({
    sabry: document.querySelector('[data-car="247"] [data-slot="247:2"]')?.textContent ?? '',
    wael: document.querySelector('[data-car="410"] [data-slot="410:2"]')?.textContent ?? '',
  }));
  check(label, plain.sabry.replace(/\s+/gu, '') === 'السائقالثانيصبريأنورالفقي12259' && plain.wael.replace(/\s+/gu, '') === 'السائقالثانيوائلرشادعبدالغني11968', 'Q1 ب: 247 / 410 seat 2 = caption, name and code only', JSON.stringify(plain));
  check(label, (await page.$('[data-roster-touch="phone"] [data-car-search] + [data-export="roster"], [data-roster-touch="phone"] > div:has(> [data-car-search]) > [data-export="roster"]')) !== null, 'Excel stays at the end of the board\'s first row (beside the car search)');
  await growToContent(page, 375);
  await common(page, `${label} (grown)`);
  // The picture reaches the owner at full size only up to 8000px tall: it ends on the last WHOLE
  // card that fits (deviceScaleFactor 2 → 4000 CSS px), 10px into the gap under it.
  const cut = await page.evaluate(() => {
    const bottoms = [...document.querySelectorAll('main [data-car]')].map((el) => el.getBoundingClientRect().bottom);
    const fit = bottoms.filter((b) => b + 10 <= 4000);
    const end = Math.max(...fit);
    const next = bottoms.find((b) => b > end) ?? null;
    return { height: Math.floor(end + 10), cards: fit.length, nextTop: next === null ? null : document.querySelectorAll('main [data-car]')[fit.length].getBoundingClientRect().top };
  });
  check(label, cut.height * 2 <= 8000 && (cut.nextTop === null || cut.nextTop >= cut.height), `phone picture ≤ 8000px tall, ending on a whole card (${cut.cards} cards)`, `${cut.height * 2}px`);
  await shot(page, join(HERE, 'fixed-phone-dark.png'), { clip: { x: 0, y: 0, width: 375, height: cut.height } });
  await context.close();
};

/** Owner shot 5 — the phone, the picker sheet on 171 seat 2. */
SHOTS['fixed-phone-sheet-dark'] = async (browser) => {
  const label = 'fixed-phone-sheet-dark';
  const { context, page } = await open(browser, { width: 375, height: 812, label });
  await page.click('[data-car="171"] [data-slot="171:2"]');
  await page.waitForSelector('[data-sheet="picker"]');
  await page.waitForTimeout(600);
  const sheet = await page.textContent('[data-sheet="picker"]');
  check(label, sheet.includes('تعديل · 171') && sheet.includes('السائق الثاني'), 'title «تعديل · 171» / «السائق الثاني»');
  const free = await page.$$eval('[data-sheet="picker"] [data-driver-card]:not([data-held-elsewhere])', (els) => els.length);
  check(label, free === FIG.pickerFree, `free drivers ${FIG.pickerFree}`, String(free));
  const seatedHead = (await page.textContent('[data-sheet="picker"] [data-seated-head]')).replace(/\s+/gu, ' ').trim();
  check(label, seatedHead === `معيّنون على سيارات أخرى (${FIG.pickerSeated})`, `«معيّنون على سيارات أخرى (${FIG.pickerSeated})»`, seatedHead);
  check(label, !sheet.includes('غير المتاحين') && !sheet.includes('متاح'), 'one list: no «غير المتاحين» tab, no «متاح»');
  await checkPoolOrder(page, label, '[data-sheet="picker"]', `معيّنون على سيارات أخرى (${FIG.pickerSeated})`);
  await common(page, label);
  // The sheet's list scrolled so the end of the free list and the head of «معيّنون على سيارات
  // أخرى (27)» with its car codes share the screen — and the first row under the search rule is
  // WHOLE (look L8): the cut row above it is scrolled out of sight.
  await page.evaluate(() => {
    const head = document.querySelector('[data-sheet="picker"] [data-seated-head]');
    let box = head?.parentElement ?? null;
    while (box !== null && !/(auto|scroll)/u.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (head === null || box === null) return;
    const delta = head.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTop += delta - box.clientHeight * 0.45;
    const top = box.getBoundingClientRect().top;
    for (const li of box.querySelectorAll('li')) {
      const r = li.getBoundingClientRect();
      if (r.top < top - 0.5 && r.bottom > top + 0.5) {
        box.scrollTop += r.bottom - top;
        break;
      }
    }
  });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(400);
  const inView = await page.evaluate(() => {
    const r = document.querySelector('[data-sheet="picker"] [data-seated-head]').getBoundingClientRect();
    return r.top > 0 && r.bottom < innerHeight;
  });
  check(label, inView, '«معيّنون على سيارات أخرى» in sight with the free list');
  const aligned = await page.evaluate(() => {
    const head = document.querySelector('[data-sheet="picker"] [data-seated-head]');
    let box = head.parentElement;
    while (!/(auto|scroll)/u.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    const top = box.getBoundingClientRect().top;
    return [...box.querySelectorAll('li')].every((li) => {
      const r = li.getBoundingClientRect();
      return r.bottom <= top + 0.5 || r.top >= top - 0.5;
    });
  });
  check(label, aligned, 'the list opens on a whole row under the search (no half row)');
  await shot(page, join(HERE, 'fixed-phone-sheet-dark.png'));
  // C2: a term that finds nobody free but finds a driver on another car says nothing above him.
  await page.fill('[data-sheet="picker"] input', 'سامر');
  await page.waitForTimeout(400);
  const searched = await page.evaluate(() => ({
    empty: document.querySelector('[data-sheet="picker"] [data-pool-empty]')?.textContent ?? null,
    seated: [...document.querySelectorAll('[data-sheet="picker"] [data-seated-driver]')].map((el) => el.textContent),
  }));
  check(label, searched.empty === null && searched.seated.length === 1 && searched.seated[0].includes('سامر عادل منصور'), 'C2: «سامر» → no «لا يوجد سائق مطابق للبحث» over «سامر عادل منصور · 150»', JSON.stringify(searched));
  await page.fill('[data-sheet="picker"] input', 'zzz');
  await page.waitForTimeout(400);
  const none = await page.textContent('[data-sheet="picker"]');
  check(label, none.includes('لا يوجد سائق مطابق للبحث'), 'a term found nowhere still says «لا يوجد سائق مطابق للبحث»');
  await page.fill('[data-sheet="picker"] input', '');
  await page.waitForTimeout(300);
  // A tap on a driver seated elsewhere MOVES him: «طارق محمود فهمي» (214) → 171 seat 2.
  await page.click('[data-sheet="picker"] [data-seated-driver] >> text=طارق محمود فهمي');
  await page.waitForTimeout(500);
  const hint = await page.$eval('[data-car="171"]', (el) => el.querySelector('[data-transfer-hint]')?.textContent ?? '');
  check(label, hint.includes('سيُنقل من السيارة 214 عند الحفظ'), 'a tap moves him: strip on 171', hint);
  check(label, (await page.$('[data-edits-bar]')) !== null, 'phone unsaved bar');
  await shot(page, join(EXTRA, 'fixed-375-moved-dark.png'));
  await context.close();
};

// ── internal shots (extra/) ──────────────────────────────────────────────────────────────────────
SHOTS['extra-landscape'] = async (browser) => {
  const label = 'extra-1180-landscape';
  const { context, page } = await open(browser, { width: 1180, height: 820, label });
  check(label, (await page.$('[data-roster-touch="landscape"]')) !== null, 'landscape board');
  await page.click('[data-car="171"] [data-slot="171:2"]');
  await page.waitForTimeout(400);
  const banner = await page.textContent('[data-target-banner]');
  check(label, banner.includes('يُعيَّن الآن: السيارة 171 · السائق الثاني'), 'target banner on 171 seat 2', banner);
  await common(page, label);
  await shot(page, join(EXTRA, 'fixed-1180-target-dark.png'));
  await context.close();
  // V-R2-2: the header's cost on a tablet held sideways — the split view is fixed in height, so the
  // header stays on screen (it does not scroll away as on portrait / phone). Read against the REAL
  // daily on the same figures; the numbers are the ones told to the owner (owner.md, س2).
  const TOLD = { '1024x768': { cards: 2, pool: 4, dailyCards: 3, dailyPool: 6 }, '1180x820': { cards: 2, pool: 5, dailyCards: 3, dailyPool: 7 } };
  for (const [size, told] of Object.entries(TOLD)) {
    const [width, height] = size.split('x').map(Number);
    const got = {};
    for (const [who, route] of [['sample', '/fleet/fixed-roster'], ['daily', DAILY]]) {
      const lab = `landscape fit ${size} (${who})`;
      const opened = await open(browser, { width, height, label: lab, route });
      got[who] = await opened.page.evaluate(() => {
        const main = document.querySelector('main');
        const col = document.querySelector('[data-cars-column]');
        const c = col.getBoundingClientRect();
        const cards = [...col.querySelectorAll('[data-car]')].filter((el) => {
          const b = el.getBoundingClientRect();
          return b.top >= c.top - 1 && b.bottom <= c.bottom + 1;
        }).length;
        const list = document.querySelector('[data-drivers-panel] .overflow-y-auto') ?? document.querySelector('[data-drivers-panel]');
        const p = list.getBoundingClientRect();
        const pool = [...list.querySelectorAll('li')].filter((el) => {
          const b = el.getBoundingClientRect();
          return b.top >= p.top - 1 && b.bottom <= p.bottom + 1;
        }).length;
        const head = main.querySelector('nav[aria-label="breadcrumb"]')?.closest('.border-b') ?? null;
        return {
          layout: document.querySelector('[data-roster-touch]')?.getAttribute('data-roster-touch') ?? '?',
          cards,
          pool,
          column: Math.round(c.height),
          headOnScreen: head === null ? null : head.getBoundingClientRect().top >= main.getBoundingClientRect().top - 1,
          scrolls: main.scrollHeight - main.clientHeight,
        };
      });
      await opened.context.close();
    }
    info(label, `${size}: sample ${got.sample.cards} whole cars / ${got.sample.pool} drivers rows (column ${got.sample.column}px) — daily ${got.daily.cards} / ${got.daily.pool} (column ${got.daily.column}px)`);
    check(label, got.sample.layout === 'landscape' && got.sample.headOnScreen === true && got.sample.scrolls <= 1, `${size}: landscape split view, the header stays on screen, the page does not scroll`, JSON.stringify(got.sample));
    check(
      label,
      got.sample.cards === told.cards && got.sample.pool === told.pool && got.daily.cards === told.dailyCards && got.daily.pool === told.dailyPool,
      `${size}: what owner.md tells — ${told.cards} cars and ${told.pool} drivers without scrolling (the daily ${told.dailyCards} / ${told.dailyPool})`,
      JSON.stringify(got),
    );
  }
};
SHOTS['extra-viewer'] = async (browser) => {
  const label = 'extra-viewer';
  const { context, page } = await open(browser, { width: 1920, height: 1080, label, search: '?viewer=1' });
  check(label, (await page.$('[data-row-actions]')) === null, 'no «إجراءات» for a reader');
  check(label, (await page.$('[data-seat-state="empty"]')) === null, 'no picker for a reader');
  check(label, (await page.$('[data-clear-slot]')) === null, 'no bins for a reader');
  const noDriver = await page.evaluate(() => document.querySelector('tr[data-car="158"]').textContent.includes('بدون سائق'));
  check(label, noDriver, 'empty seats say «بدون سائق»');
  await common(page, label);
  await shot(page, join(EXTRA, 'fixed-1920-viewer-dark.png'));
  await context.close();
};
SHOTS['extra-filtered'] = async (browser) => {
  const label = 'extra-filtered';
  const { context, page } = await open(browser, { width: 1920, height: 1080, label });
  await page.click('[data-counter="uncrewed"]');
  await page.waitForTimeout(400);
  const rows = await carsShown(page);
  check(label, rows.join() === '158,176,376,133', '«بلا طقم» → 158 · 176 · 376 · 133', rows.join());
  check(label, (await page.textContent('[data-filtered-count]')).trim() === '4 سيارة', 'toolbar «4 سيارة»');
  check(label, (await page.$('[data-roster-filters] button[title="مسح عوامل التصفية"]')) !== null, 'red reset shown');
  await checkCounters(page, label, FIG.company);
  await common(page, label);
  await shot(page, join(EXTRA, 'fixed-1920-filtered-dark.png'));
  await page.click('[data-roster-filters] button[title="مسح عوامل التصفية"]');
  await page.waitForTimeout(300);
  check(label, (await carsShown(page)).length === 20, 'reset → 20 rows');
  await context.close();
};
SHOTS['extra-1366'] = async (browser) => {
  const label = 'extra-1366';
  const { context, page } = await open(browser, { width: 1366, height: 768, label });
  await common(page, label);
  await checkNotes(page, label);
  await rowsFit(page, label, 5);
  const arrows = await page.$$eval('[data-counters-arrow]', (els) => els.length);
  info(label, `counter arrows: ${arrows}`);
  await shot(page, join(EXTRA, 'fixed-1366-dark.png'));
  await context.close();
};
/** L1/L10: the laptop band the daily lets scroll — notes held to three lines, nothing under the pin. */
SHOTS['extra-1280'] = async (browser) => {
  const label = 'extra-1280';
  const { context, page } = await open(browser, { width: 1280, height: 800, label });
  await common(page, label);
  await checkNotes(page, label);
  await rowsFit(page, label, 5);
  const rows = await page.$$eval('main tbody tr[data-car]', (els) => Math.max(...els.map((el) => el.getBoundingClientRect().height)));
  check(label, rows <= 76, 'no row taller than a three-line note (≤ 76px)', `${Math.round(rows)}px`);
  const mission = await page.$$eval('main tbody tr[data-car] select', (els) =>
    els.filter((sel) => {
      const canvas = document.createElement('canvas').getContext('2d');
      const style = getComputedStyle(sel);
      canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = sel.selectedOptions[0]?.textContent ?? '';
      const room = sel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return canvas.measureText(text).width > room + 1;
    }).map((sel) => sel.selectedOptions[0]?.textContent),
  );
  check(label, mission.length === 0, 'every mission name whole in its box (the daily\'s 9rem)', mission.join(', '));
  await shot(page, join(EXTRA, 'fixed-1280-dark.png'));
  await context.close();
};
SHOTS['extra-1536'] = async (browser) => {
  const label = 'extra-1536';
  const { context, page } = await open(browser, { width: 1536, height: 864, label });
  await common(page, label);
  await checkNotes(page, label);
  await rowsFit(page, label, 6);
  await fitRows(page, label);
  await shot(page, join(EXTRA, 'fixed-1536-dark.png'));
  await context.close();
};
/** L10: the one new sentence, «لا يوجد سائقون بلا طقم ثابت», on the computer and in the phone sheet. */
SHOTS['extra-empty-pool'] = async (browser) => {
  let label = 'extra-empty-pool (desk)';
  let { context, page } = await open(browser, { width: 1920, height: 1080, label, search: '?nopool=1' });
  const desk = await page.evaluate(() => ({
    empty: document.querySelector('[data-drivers-panel] [data-pool-empty]')?.textContent ?? null,
    head: document.querySelector('[data-drivers-panel] [data-drivers-head]')?.textContent.replace(/\s+/gu, '') ?? null,
    section: document.querySelector('[data-drivers-panel] [data-seated-head]')?.textContent.replace(/\s+/gu, ' ').trim() ?? null,
  }));
  check(label, desk.empty === 'لا يوجد سائقون بلا طقم ثابت', 'empty free list says «لا يوجد سائقون بلا طقم ثابت»', String(desk.empty));
  check(label, desk.head === 'السائقون(1)' && desk.section === 'معيّنون على سيارات أخرى (1)', 'the one driver held off the board stays listed under the section', JSON.stringify(desk));
  await common(page, label);
  await fitRows(page, label);
  await shot(page, join(EXTRA, 'fixed-1920-empty-pool-dark.png'));
  await context.close();
  label = 'extra-empty-pool (phone)';
  ({ context, page } = await open(browser, { width: 375, height: 812, label, search: '?nopool=1' }));
  await page.click('[data-open-pool]');
  await page.waitForSelector('[data-sheet="pool"]');
  await page.waitForTimeout(500);
  const phone = await page.textContent('[data-sheet="pool"]');
  check(label, phone.includes('لا يوجد سائقون بلا طقم ثابت') && phone.includes('معيّنون على سيارات أخرى'), 'phone sheet: the sentence, then the section');
  await common(page, label);
  await shot(page, join(EXTRA, 'fixed-375-empty-pool-dark.png'));
  await context.close();
};
/** Light still exists in the product: the same checks in light, no picture sent (DECISIONS: dark only). */
SHOTS['extra-light'] = async (browser) => {
  for (const [width, height] of [[1920, 1080], [375, 812]]) {
    const label = `extra-light ${width}`;
    const { context, page } = await open(browser, { width, height, label, search: '?theme=light', light: true });
    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    check(label, !dark, 'light theme on');
    await common(page, label);
    await answers(page, label);
    if (width >= 1280) await checkNotes(page, label);
    await page.screenshot({ path: join(HERE, '..', 'fixed-crew', 'probe', `light-${width}.png`) });
    await context.close();
  }
};
SHOTS['extra-states'] = async (browser) => {
  for (const [search, name, wait] of [
    ['?fail=1', 'error', 'main [role="alert"], main button'],
    ['?slow=1', 'loading', 'main table'],
  ]) {
    const label = `extra-${name}`;
    const { context, page } = await open(browser, { width: 1920, height: 1080, label, search, wait });
    await page.waitForTimeout(500);
    await shot(page, join(EXTRA, `fixed-1920-${name}-dark.png`));
    await context.close();
  }
};
SHOTS['extra-phone-pool'] = async (browser) => {
  const label = 'extra-phone-pool';
  const { context, page } = await open(browser, { width: 375, height: 812, label });
  await page.click('[data-open-pool]');
  await page.waitForSelector('[data-sheet="pool"]');
  await page.waitForTimeout(500);
  const sheet = await page.textContent('[data-sheet="pool"]');
  check(label, sheet.includes('اختر سائقًا، ثم اختر له خانة في إحدى السيارات.'), 'driver-first hint');
  const title = (await page.textContent('[data-sheet="pool"] h2')).trim();
  check(label, title === `السائقون (${FIG.company.pool})`, `sheet title «السائقون (${FIG.company.pool})» (L9)`, title);
  await common(page, label);
  await shot(page, join(EXTRA, 'fixed-375-pool-dark.png'));
  await page.click('[data-sheet="pool"] [data-driver-card] >> nth=0');
  await page.waitForTimeout(500);
  check(label, (await page.$('[data-pending-driver]')) !== null, 'pending driver banner');
  await shot(page, join(EXTRA, 'fixed-375-pending-dark.png'));
  await page.click('[data-open-filters]');
  await page.waitForSelector('[data-sheet="filters"]');
  await page.waitForTimeout(500);
  await common(page, `${label} filters`);
  await shot(page, join(EXTRA, 'fixed-375-filters-dark.png'));
  await context.close();
};

// ── FUNCS: fixed-functions.md F1–F53, each found on the sample or worked through it ──────────────
const VID = (code) => `c2f0${code.padStart(20, '0')}`;
const seatText = (page, code, slot) =>
  page.$eval(`tr[data-car="${code}"] [data-drop-zone="${VID(code)}:${slot}"]`, (el) => el.textContent.trim());
const rowCodes = (page) => page.$$eval('main tbody tr[data-car]', (els) => els.map((el) => el.getAttribute('data-car')));
const F = (label, n, okay, what, detail = '') => check(label, okay, `F${n} ${what}`, detail);

SHOTS['funcs'] = async (browser) => {
  const label = 'funcs (desk 1920)';
  let { context, page } = await open(browser, { width: 1920, height: 1080, label });
  F(label, 1, (await page.$('[data-day-stepper], [data-readonly-day]')) === null, 'no date anywhere (no stepper, no past banner)');
  F(label, 2, (await page.$('[data-drivers-panel] [role="tab"]')) === null, 'one undivided pool (no «غير المتاحين» tab)');
  F(label, 3, (await page.$('tr[data-car="158"] [data-drop-disabled="needsFirstDriver"]')) !== null, 'seat 2 waits for seat 1');
  F(label, 4, (await page.$('tr[data-car="163"] select:not([disabled])')) !== null && (await page.$('tr[data-car="176"] [data-seat-state="empty"]')) !== null, 'a workshop car keeps an editable crew');
  // F5 + F20: drag «سامر» (150 seat 1) onto 152 seat 2 → a MOVE; 150 promotes «محمود», 152's
  // «كريم» goes back to the pool, «سامر» is on the board once.
  await page.dragAndDrop('tr[data-car="150"] [data-drop-zone$=":driver1EmployeeId"] [data-driver-chip]', 'tr[data-car="152"] [data-drop-zone$=":driver2EmployeeId"]');
  await page.waitForTimeout(300);
  const samer = await page.$$eval('main tbody [data-driver-chip]', (els) => els.filter((el) => el.textContent.includes('سامر عادل منصور')).length);
  F(label, 5, samer === 1, 'one crew per driver (a drop onto another car MOVES him)', String(samer));
  F(label, 20, (await seatText(page, '150', 'driver1EmployeeId')).includes('محمود سعيد عبد الحميد'), 'a move re-seats the car that lost its first driver');
  F(label, 20, (await page.$$eval('[data-drivers-panel] [data-driver-card]', (els) => els.some((el) => el.textContent.includes('كريم نبيل عبد الحميد')))), 'the displaced driver goes back to the pool');
  // Drop on the other seat of the same car = swap.
  await page.dragAndDrop('tr[data-car="205"] [data-drop-zone$=":driver1EmployeeId"] [data-driver-chip]', 'tr[data-car="205"] [data-drop-zone$=":driver2EmployeeId"]');
  await page.waitForTimeout(300);
  F(label, 20, (await seatText(page, '205', 'driver1EmployeeId')).includes('أيمن صبري عبد الفتاح'), 'a drop onto the same car\'s other seat SWAPS');
  await page.click('[data-undo-edit]');
  await page.click('[data-undo-edit]');
  await page.waitForTimeout(300);
  F(label, 26, (await page.$('[data-edits-bar]')) === null, '«تراجع» ×2 → nothing unsaved again');
  F(label, 6, (await page.$('tr[data-car="150"] td:first-child span[dir="ltr"]')) !== null, 'code cell (plain, ltr; colour chip restyled — T-11)');
  F(label, 8, (await page.$eval('tr[data-car="176"] [data-status-cell]', (el) => el.textContent)).includes('بلا طقم'), '«الحالة»: «في الورشة» + «بلا طقم»');
  // F11: the driver card on a seated name (hover).
  await page.hover('tr[data-car="150"] [data-driver-chip] [data-seat-name]');
  await page.waitForTimeout(700);
  F(label, 11, (await page.evaluate(() => document.body.innerText.includes('01014827736'))), 'driver card on hover (name, code, phone)');
  await page.mouse.move(5, 5);
  F(label, 12, (await page.$eval('tr[data-car="214"] [data-notes]', (el) => el.getAttribute('title'))).includes('السائق الثاني بديل'), '«ملاحظات»: up to three lines, the whole note in its title');
  F(label, 13, (await page.$$eval('main tbody tr[data-car]', (els) => els.every((el) => el.querySelector('[data-edit-row]') !== null))), 'pen «تعديل» on every row');
  // F19: the pool's own search.
  await page.fill('[data-drivers-panel] input', 'حمدي');
  await page.waitForTimeout(300);
  const found = await page.$$eval('[data-drivers-panel] [data-driver-card]', (els) => els.map((el) => el.textContent));
  F(label, 19, found.length === 1 && found[0].includes('حمدي عبد الستار رزق'), 'pool search by name', found.join(' | '));
  await page.fill('[data-drivers-panel] input', 'zzz');
  await page.waitForTimeout(300);
  F(label, 19, (await page.textContent('[data-drivers-panel]')).includes('لا يوجد سائق مطابق للبحث'), 'search miss «لا يوجد سائق مطابق للبحث»');
  await page.fill('[data-drivers-panel] input', '');
  // F22: the seat bin on 150 seat 1 promotes seat 2.
  await page.click(`tr[data-car="150"] [data-clear-slot="${VID('150')}:driver1EmployeeId"]`);
  await page.waitForTimeout(300);
  F(label, 22, (await seatText(page, '150', 'driver1EmployeeId')).includes('محمود سعيد عبد الحميد'), 'seat bin on seat 1 promotes seat 2');
  // F23: «إفراغ الطقم» on 214 — both seats, mission and note stay, no confirm.
  await page.click('tr[data-car="214"] [data-clear-crew]');
  await page.waitForTimeout(300);
  const r214 = await page.$eval('tr[data-car="214"]', (el) => ({
    seats: [...el.querySelectorAll('[data-seat-state]')].map((s) => s.getAttribute('data-seat-state')).join(),
    text: el.textContent,
    mission: el.querySelector('select')?.selectedOptions[0]?.textContent ?? '',
  }));
  F(label, 23, r214.seats === 'empty,locked' && r214.mission.includes('نقل أموال (يومي)') && r214.text.includes('السائق الثاني بديل') && (await page.$('[role="dialog"]:has-text("إفراغ")')) === null, '«إفراغ الطقم»: both seats, mission + note stay, no confirm', JSON.stringify({ seats: r214.seats, mission: r214.mission }));
  // F28/F29: two cars amber; «حفظ» sends exactly those rows.
  const amber = await page.$$eval('tr[data-tint="unsaved"]', (els) => els.map((el) => el.getAttribute('data-car')).sort());
  F(label, 28, amber.join() === '150,214', 'unsaved rows amber (150, 214)', amber.join());
  // F30: the draft survives a reload (this tab).
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('main tbody tr[data-car]');
  await page.waitForTimeout(600);
  const kept = await page.$$eval('tr[data-tint="unsaved"]', (els) => els.map((el) => el.getAttribute('data-car')).sort());
  F(label, 30, kept.join() === '150,214', 'the draft survives a reload', kept.join());
  F(label, 27, (await page.$('[data-undo-edit][disabled]')) !== null, 'after a reload «تراجع» has no steps (the draft does)');
  await page.click('[data-save-roster]');
  await page.waitForTimeout(900);
  const saves = await page.evaluate(() => window.__zzSaves);
  const sent = (saves.at(-1)?.rows ?? []).map((row) => row.vehicleId).sort();
  F(label, 29, sent.join() === [VID('150'), VID('214')].sort().join(), '«حفظ» sends the changed rows only', sent.join());
  F(label, 32, (await page.evaluate(() => document.body.innerText.includes('تم حفظ الطقم الثابت'))) && (await page.$('[data-edits-bar]')) === null, 'saved: toast «تم حفظ الطقم الثابت», bar gone');
  // F33: a refused save keeps the draft — 247 holds a switched-off profile; the screen flags nobody
  // beforehand (Q1 ب), so the server's refusal is all the reader learns, as today (T-16).
  const daily = await page.$eval('tr[data-car="247"] select', (sel) => [...sel.options].find((o) => o.textContent.trim() === 'سفر')?.value ?? '');
  await page.selectOption('tr[data-car="247"] select', daily);
  await page.click('[data-save-roster]');
  await page.waitForTimeout(900);
  F(label, 33, (await page.$('[data-edits-bar]')) !== null && (await page.$('tr[data-car="247"][data-tint="unsaved"]')) !== null, 'refused save: draft kept, bar stays');
  F(label, 33, (await page.evaluate(() => document.body.innerText.includes('profile is inactive'))), 'refusal toasted with the server\'s detail (English today — T-16)');
  await page.click('[data-discard-edits]');
  await page.waitForTimeout(300);
  F(label, 31, (await page.$('[data-edits-bar]')) === null, '«إلغاء» (one car: no question) drops the draft');
  // F33, the other refusal (C1): «إيهاب» («سيارة أخرى», held on 199) dropped on 158 → 409 DUPLICATE,
  // which the web has no friendly line for: the server's English sentence is toasted (T-16).
  await page.dragAndDrop('[data-drivers-panel] [data-held-elsewhere]', 'tr[data-car="158"] [data-drop-zone$=":driver1EmployeeId"]');
  await page.waitForTimeout(300);
  await page.click('[data-save-roster]');
  await page.waitForTimeout(900);
  const conflict = await page.evaluate(() => document.body.innerText);
  F(label, 33, (await page.$('tr[data-car="158"][data-tint="unsaved"]')) !== null && conflict.includes('already belongs to the fixed crew of vehicle 199'), 'a «سيارة أخرى» driver saved → refused (409), draft kept, the server\'s English sentence toasted (T-16)');
  await page.click('[data-discard-edits]');
  await page.waitForTimeout(300);
  // F35/F36/F38–F41: the one-line bar, the code filter, the chips as filters.
  const barHeight = await page.$eval('[data-roster-filters]', (el) => el.getBoundingClientRect().height);
  F(label, 35, barHeight < 90, 'filter bar on ONE line', `${barHeight}px`);
  const before = await counters(page);
  await page.click('[data-counter="crewed"]');
  await page.waitForTimeout(300);
  await page.click(`[data-counter="${'a7c0' + '1'.padStart(20, '0')}"]`);
  await page.waitForTimeout(300);
  const and = await page.$$eval('main tbody tr[data-car]', (els) =>
    els.map((el) => ({
      code: el.getAttribute('data-car'),
      daily: (el.querySelector('select')?.selectedOptions[0]?.textContent ?? '').includes('نقل أموال (يومي)'),
      crewed: !el.querySelector('[data-status-cell]').textContent.includes('بلا طقم'),
    })),
  );
  // After the save above 214 has no crew: the AND keeps the daily-mission cars that have one.
  F(label, 40, and.length === 6 && and.every((r) => r.daily && r.crewed), 'filters AND (بطقم × نقل أموال (يومي))', and.map((r) => r.code).join());
  const counts = await counters(page);
  F(label, 39, JSON.stringify(counts) === JSON.stringify(before), 'counters count the whole board, not the filtered rows');
  F(label, 38, (await page.$('[data-counter="crewed"][aria-pressed="true"]')) !== null, 'a chip is a filter (pressed, ringed)');
  await page.click('[data-roster-filters] button[title="مسح عوامل التصفية"]');
  await page.waitForTimeout(300);
  F(label, 41, (await rowCodes(page)).length === 20 && (await page.$('[data-roster-filters] button[title="مسح عوامل التصفية"]')) === null, 'red reset clears all and hides itself');
  // F43: sort by «الحالة» → workshop first.
  await page.click('thead th:has-text("الحالة") button, thead th:has-text("الحالة")');
  await page.waitForTimeout(300);
  const sorted = await rowCodes(page);
  F(label, 43, sorted.slice(0, 3).join() === '163,176,340', '«الحالة» sorts workshop → crewed → uncrewed', sorted.slice(0, 5).join());
  // F45: Excel downloads the rows on screen.
  const download = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
  await page.click('[data-export="roster"]');
  const file = await download;
  // (The name is the real saveBlob's; headless chromium loses it when the blob URL is revoked at once.)
  F(label, 45, file !== null, 'Excel pill writes a file (the rows on screen)', file?.suggestedFilename() ?? 'none');
  F(label, 46, (await page.$('main nav[aria-label="breadcrumb"] a[href$="/fleet"]')) !== null && (await page.$$eval('main h1', (els) => els.map((el) => el.textContent.trim()).join())) === 'الطقم الثابت', 'the screen names itself: the old header «الحركة › الطقم الثابت» + «الطقم الثابت» (Q2 ج)');
  const pageScroll = await page.evaluate(() => document.querySelector('main').scrollHeight - document.querySelector('main').clientHeight);
  F(label, 48, pageScroll <= 1, 'the page never scrolls (table and pool scroll inside)', `${pageScroll}px`);
  F(label, 52, (await page.$('tr[data-car="247"] [data-driver-out], tr[data-car="247"] [data-problem], [data-driver-licence]')) === null, 'no flag for a standing member who can no longer drive (Q1 ب — the daily\'s only)');
  await context.close();
  // F36/F37/F42/F47 through the URL and a reload.
  ({ context, page } = await open(browser, { width: 1920, height: 1080, label, route: '/fleet/fixed-roster?q=150,152' }));
  F(label, 36, (await rowCodes(page)).join() === '150,152', '«كود السيارة» `?q=150,152`');
  await context.close();
  ({ context, page } = await open(browser, { width: 1920, height: 1080, label, route: `/fleet/fixed-roster?mission=${'a7c0' + '4'.padStart(20, '0')}` }));
  F(label, 37, (await rowCodes(page)).join() === '171', '`?mission=` links still narrow (مسائي → 171)');
  await page.click('[data-counter="total"]');
  await page.waitForTimeout(300);
  await page.click('[data-counter="uncrewed"]');
  await page.waitForTimeout(400);
  await page.goto(URL_OF('/fleet/fixed-roster', '?again=1'), { waitUntil: 'networkidle' });
  await page.waitForSelector('main tbody tr[data-car]');
  await page.waitForTimeout(600);
  F(label, 42, (await page.$('[data-counter="uncrewed"][aria-pressed="true"]')) !== null, 'filters remembered across visits');
  await context.close();
  ({ context, page } = await open(browser, { width: 1920, height: 1080, label, route: '/fleet/fixed-roster?q=999', wait: 'main table' }));
  await page.waitForTimeout(400);
  F(label, 47, (await page.textContent('main')).includes('لا توجد سيارات'), 'empty «لا توجد سيارات»');
  await context.close();
  ({ context, page } = await open(browser, { width: 1920, height: 1080, label, search: '?fail=1', wait: 'main button' }));
  F(label, 47, (await page.textContent('main')).includes('إعادة المحاولة'), 'error + «إعادة المحاولة»');
  await context.close();

  // Touch (375): every edit reachable by a tap (F49/F50, F21, F24, F25, F23, F37).
  const tl = 'funcs (touch 375)';
  ({ context, page } = await open(browser, { width: 375, height: 812, label: tl }));
  await page.click('[data-mission="433"]');
  await page.waitForSelector('[data-sheet="mission"]');
  F(tl, 25, (await page.textContent('[data-sheet="mission"]')).includes('تعديل · 433'), 'mission pill → «تعديل · 433» sheet');
  await page.click('[data-sheet="mission"] [data-option]:has-text("مسائي")');
  await page.waitForTimeout(500);
  F(tl, 25, (await page.$eval('[data-car="433"] [data-mission]', (el) => el.textContent)).includes('مسائي'), 'mission picked by tap');
  await page.click('[data-card-menu="150"]');
  await page.click('[data-menu-item="edit"]');
  await page.waitForSelector('[data-sheet="notes"]');
  const max = await page.$eval('[data-notes-input]', (el) => el.getAttribute('maxlength'));
  F(tl, 24, max === '500', '⋮ «تعديل» → note sheet, 500 letters', String(max));
  await page.click('[data-sheet="notes"] button:has-text("إلغاء")');
  await page.waitForTimeout(400);
  await page.click('[data-card-menu="262"]');
  await page.click('[data-menu-item="clear-crew"]');
  await page.waitForTimeout(400);
  F(tl, 23, (await page.$('[data-car="262"] [data-slot="262:1"][data-slot-state="empty"]')) !== null, '⋮ «إفراغ الطقم» empties both seats');
  await page.click('[data-car="158"] [data-slot="158:1"]');
  await page.waitForSelector('[data-sheet="picker"]');
  await page.click('[data-sheet="picker"] [data-driver-card] >> nth=0');
  await page.waitForTimeout(400);
  F(tl, 21, (await page.$('[data-car="158"] [data-slot="158:1"][data-slot-state="filled"]')) !== null, 'empty seat → picker → seated by a tap');
  await page.click('[data-open-filters]');
  await page.waitForSelector('[data-sheet="filters"]');
  F(tl, 37, (await page.textContent('[data-sheet="filters"]')).includes('كل المهمات'), 'filters sheet: «كود السيارة» + «نوع المهمة»');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const bar = await page.$$eval('[data-edited-code]', (els) => els.map((el) => el.getAttribute('data-edited-code')).sort());
  F(tl, 26, bar.join() === '158,262,433', 'phone bar lists the edited cars', bar.join());
  await shot(page, join(EXTRA, 'fixed-375-edited-dark.png'));
  await context.close();
  for (const n of [34, 51, 53]) info(label, `F${n} server side / unchanged by the design — not a screen element`);
  for (const n of [9, 10, 14, 15, 16, 17, 18, 44, 49, 50]) info(label, `F${n} checked in the owner and extra shots (FUNCS_DESK, viewer, branch, filtered, tablet, phone)`);
};

// ── the REAL daily roster, same figures, same sizes (ref/) ─────────────────────────────────────────
const DAILY = '/fleet/roster';
SHOTS['ref'] = async (browser) => {
  for (const [name, opts] of [
    ['daily-dark', { width: 1920, height: 1080 }],
    ['daily-branch-dark', { width: 1920, height: 1080, branch: MOHANDESSIN }],
    ['daily-tablet-dark', { width: 768, height: 1024 }],
    ['daily-phone-dark', { width: 375, height: 812, full: true }],
    ['daily-phone-sheet-dark', { width: 375, height: 812, sheet: true }],
  ]) {
    const label = `ref ${name}`;
    const { context, page } = await open(browser, { ...opts, label, route: DAILY });
    if (opts.full) await growToContent(page, opts.width);
    if (opts.sheet) {
      await page.click('[data-car="171"] [data-slot="171:2"]');
      await page.waitForSelector('[data-sheet="picker"]');
      await page.waitForTimeout(600);
    }
    const side = await sideways(page);
    check(label, side <= 1, 'no sideways page scroll', `${side}px`);
    await shot(page, join(REF, `${name}.png`), opts.full ? { fullPage: true } : {});
    await context.close();
  }
};

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
const wanted = (process.argv[2] ?? 'all').split(',');
// ref/ (the daily, as the owner saw it) is shot only when asked by name.
const ALL = Object.keys(SHOTS).filter((name) => name !== 'ref');
const names = wanted.includes('all') ? [...ALL, ...wanted.filter((name) => name !== 'all')] : wanted;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
try {
  for (const name of names) {
    if (SHOTS[name] === undefined) throw new Error(`no shot ${name}`);
    try {
      await SHOTS[name](browser);
    } catch (error) {
      fail(name, `threw: ${error.message.split('\n').slice(0, 6).join(' / ')}`);
    }
  }
} finally {
  await browser.close();
}
lines.push(`${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
writeFileSync(join(HERE, ALL.every((name) => names.includes(name)) ? 'checks.txt' : 'checks-partial.txt'), `${lines.join('\n')}\n`);
console.log(lines.filter((l) => !l.startsWith('PASS')).join('\n'));
console.log(`${lines.filter((l) => l.startsWith('PASS')).length} passed, ${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
