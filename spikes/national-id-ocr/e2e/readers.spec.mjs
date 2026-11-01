// Gates G6 (themes, invalid state, a11y, RTL), G8 (motion) and G9 (heroes) on the Readers site: a
// home page and one page per reader (#/national-id, #/egycash-id, #/army-exemption).
// Screenshots go to build/e2e/shots; they show synthetic states only, never a real card.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SHOTS = "../build/e2e/shots";
const THEMES = { national_id: "nid", egycash_id: "egyid", army_exemption: "army" };
const ROUTES = { national_id: "national-id", egycash_id: "egycash-id", army_exemption: "army-exemption" };
const INVALID = {
  national_id: ["This does not look like a National ID Card.", "هذه لا تبدو بطاقة رقم قومي."],
  egycash_id: ["This is not an EGY CASH ID.", "هذه ليست بطاقة EGY CASH ID."],
  army_exemption: ["This does not look like an Army Exemption Certificate.", "هذه لا تبدو شهادة إعفاء من الخدمة العسكرية."],
};
const notMatch = (type) => ({ documentType: type, verdict: { status: "not_match", reasons: ["no_text"] }, fields: {} });
const matchResult = (type) => ({
  documentType: type,
  verdict: { status: "match", reasons: [] },
  fields: { fullNameAr: { value: "اسم تجريبي", confidence: "high" }, nationalId: { value: "29001011234567", confidence: "medium" } },
  scores: { fullNameAr: 94, nationalId: 81 },
});

async function open(page, type = null) {
  await page.goto(type ? `/readers#/${ROUTES[type]}` : "/readers");
  await page.waitForFunction(() => window.__readers && window.__readers.panels.length === 3);
}

async function drive(page, type, state, result) {
  await page.evaluate(([t, s, r]) => {
    const R = window.__readers;
    R.setState(R.panels.find((p) => p.type.id === t), s, { elapsedMs: 4200, result: r });
  }, [type, state, result]);
}

const pageOf = (page, type) => page.locator(`[data-page="${ROUTES[type]}"]`);

test("G6: home links to one page per reader, each in its own theme", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-page="home"]')).toBeVisible();
  const accents = new Set();
  for (const [type, theme] of Object.entries(THEMES)) {
    await page.locator(`[data-nav="${type}"]`).click();
    await expect(pageOf(page, type)).toBeVisible();
    await expect(page.locator('[data-page="home"]')).toBeHidden();
    await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(`[data-nav="${type}"]`)).toHaveAttribute("aria-current", "page");
    accents.add(await pageOf(page, type).evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim()));
    await page.screenshot({ path: `${SHOTS}/${type}-idle.png`, fullPage: true });
  }
  expect(accents.size).toBe(3);
});

for (const type of Object.keys(THEMES)) {
  test(`G6: not_match switches ${type} to the invalid theme with both messages`, async ({ page }) => {
    await open(page, type);
    const panel = page.locator(`.panel[data-type="${type}"]`);
    const before = await panel.evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim());
    await drive(page, type, "invalid", notMatch(type));
    await expect(panel).toHaveAttribute("data-state", "invalid");
    const alert = panel.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(INVALID[type][0]);
    await expect(alert).toContainText(INVALID[type][1]);
    // Never colour alone: the state's word and icon are there too.
    await expect(panel.locator(".chip.state")).toContainText("Not this document");
    const after = await panel.evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim());
    expect(after).not.toBe(before);
    await expect(page.locator(`[data-nav="${type}"]`)).toHaveAttribute("data-state", "invalid");
    await panel.screenshot({ path: `${SHOTS}/${type}-invalid.png` });
  });
}

test("G6: match shows the fields with their bands", async ({ page }) => {
  await open(page, "national_id");
  await drive(page, "national_id", "match", matchResult("national_id"));
  const panel = page.locator('.panel[data-type="national_id"]');
  await expect(panel.locator(".field")).toHaveCount(2);
  await expect(panel.locator(".band.high")).toContainText("High");
  await expect(panel.locator(".band.medium")).toContainText("Check");
  await panel.screenshot({ path: `${SHOTS}/national_id-match.png` });
});

test("G6: the National ID Card shows both sides and the holder's photo, each downloadable", async ({ page }) => {
  await open(page, "national_id");
  // A 1x1 grey JPEG stands in for each image: synthetic, never a real card.
  const px = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  await drive(page, "national_id", "match", { ...matchResult("national_id"), orientedImages: { front: px, back: px }, portraitImage: px });
  const panel = page.locator('.panel[data-type="national_id"]');
  await expect(panel.locator(".as-read .side")).toHaveCount(2);
  await expect(panel.locator(".as-read .side a").first()).toHaveAttribute("download", /national-id-(front|back)\.jpg/);
  await expect(panel.locator(".portrait-row")).toBeVisible();
  await expect(panel.locator(".portrait-dl")).toHaveAttribute("download", "national-id-photo.jpg");
  // Cleared with the read: nothing lingers on screen.
  await drive(page, "national_id", "idle", null);
  await expect(panel.locator(".as-read")).toBeHidden();
});

test("G6: a read that cannot reach the service says so plainly, with the detail folded away", async ({ page }) => {
  await open(page, "egycash_id");
  await page.evaluate(() => {
    const R = window.__readers;
    R.setState(R.panels[1], "failed", { error: "The OCR service at http://127.0.0.1:8099 did not answer (refused)" });
  });
  const alert = page.locator('.panel[data-type="egycash_id"]').getByRole("alert");
  await expect(alert).toContainText("The reading service is not running");
  await expect(alert.locator(".detail")).toBeVisible();
  await expect(alert.locator(".detail code")).toBeHidden(); // folded
  await expect(page.locator("#service")).toHaveAttribute("data-up", "no");
});

test("G6: every page passes axe in English and in Arabic (RTL), with match and invalid shown", async ({ page }) => {
  await open(page, "egycash_id");
  await drive(page, "egycash_id", "invalid", notMatch("egycash_id"));
  await drive(page, "national_id", "match", matchResult("national_id"));
  for (const route of ["", "#/national-id", "#/egycash-id", "#/army-exemption"]) {
    await page.evaluate((hash) => { location.hash = hash; }, route);
    await page.waitForTimeout(900); // let entrances finish: axe reads colours mid-fade otherwise
    const en = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(en.violations.map((v) => `${route} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  }
  await page.locator("#lang").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("[data-nav=national_id]")).toContainText("بطاقة الرقم القومي");
  const ar = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(ar.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/rtl.png`, fullPage: true });
});

test("G6: the Read button is reachable by keyboard", async ({ page }) => {
  await open(page, "national_id");
  let reached = false;
  for (let i = 0; i < 30 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.classList.contains("read") ?? false);
  }
  expect(reached).toBe(true);
});

test("G8: animations touch transform and opacity only", async ({ page }) => {
  await open(page);
  const bad = await page.evaluate(() => {
    const allowed = new Set(["transform", "opacity", "stroke-dashoffset"]);
    const found = [];
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule.type !== CSSRule.KEYFRAMES_RULE) continue;
        for (const frame of rule.cssRules) {
          for (let i = 0; i < frame.style.length; i += 1) {
            const name = frame.style[i];
            if (!allowed.has(name) && !name.startsWith("--")) found.push(`${rule.name}: ${name}`);
          }
        }
      }
    }
    return found;
  });
  expect(bad).toEqual([]);
});

test("G8: invalid shakes once, then stays still", async ({ page }) => {
  await open(page, "egycash_id");
  await drive(page, "egycash_id", "invalid", notMatch("egycash_id"));
  const iterations = await page.locator('.panel[data-type="egycash_id"] .alert')
    .evaluate((el) => getComputedStyle(el).animationIterationCount);
  expect(iterations).toBe("1");
});

test("G8: no layout shift while a reader starts reading", async ({ page }) => {
  await open(page, "army_exemption");
  await page.waitForTimeout(1300);
  await page.evaluate(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: false });
  });
  await drive(page, "army_exemption", "reading", null);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.1);
});

test("G8/G9: reduced motion draws one still frame and runs no loop", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await open(page, "egycash_id");
  await expect(page.locator(".hero .scene")).toHaveCount(0);
  expect(await page.evaluate(async () => (await import("/ui/heroes.js")).loopRunning())).toBe(false);
  await drive(page, "egycash_id", "reading", null);
  const loops = await page.locator('.panel[data-type="egycash_id"] .chip.state .icon')
    .evaluate((el) => getComputedStyle(el).animationIterationCount);
  expect(loops).toBe("1");
  await page.screenshot({ path: `${SHOTS}/reduced-motion.png`, fullPage: true });
  await context.close();
});

test("G9: each theme has its own hero; the logo turns, settles on match, stops on invalid", async ({ page }) => {
  await open(page, "egycash_id");
  const hero = '[data-page="egycash-id"] .hero';
  await expect(page.locator(`${hero} canvas.gl`)).toHaveCount(1); // the WebGL mark
  const angle = () => page.locator(hero).evaluate((el) => el.__hero.pose.ry);
  const first = await angle();
  await page.waitForTimeout(500);
  expect(await angle()).not.toBe(first); // idle: turning
  await drive(page, "egycash_id", "match", matchResult("egycash_id"));
  await page.waitForTimeout(1800);
  const turn = 2 * Math.PI;
  const settled = (((await angle()) % turn) + turn) % turn;
  expect(Math.min(settled, turn - settled)).toBeLessThan(0.05); // facing the viewer
  await drive(page, "egycash_id", "invalid", notMatch("egycash_id"));
  const held = await angle();
  await page.waitForTimeout(500);
  expect(await angle()).toBeCloseTo(held, 3); // stopped
  for (const state of ["idle", "reading", "match", "invalid"]) {
    await drive(page, "egycash_id", state, state === "match" ? matchResult("egycash_id") : notMatch("egycash_id"));
    await page.waitForTimeout(800);
    await page.locator(hero).screenshot({ path: `${SHOTS}/hero-egyid-${state}.png` });
  }
  await page.evaluate(() => { location.hash = "#/national-id"; });
  await expect(page.locator('[data-page="national-id"] .hero canvas.gl')).toHaveCount(1); // the WebGL card
  await page.waitForTimeout(800);
  await page.locator('[data-page="national-id"] .hero').screenshot({ path: `${SHOTS}/hero-nid.png` });
  await page.evaluate(() => { location.hash = "#/army-exemption"; });
  await expect(page.locator('[data-page="army-exemption"] .hero .sheet')).toHaveCount(1);
});

test("G9: rendering pauses when the tab is hidden", async ({ page }) => {
  await open(page);
  const running = () => page.evaluate(async () => (await import("/ui/heroes.js")).loopRunning());
  await page.waitForTimeout(300);
  expect(await running()).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(200);
  expect(await running()).toBe(false);
  await expect(page.locator(".hero").first()).toHaveClass(/is-paused/);
});

test("G8/G9: a reader's page holds ~60 fps with its hero reading", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const type of Object.keys(THEMES)) {
    await open(page, type);
    await drive(page, type, "reading", null);
    const fps = await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = (now) => {
        frames += 1;
        if (now - start < 2000) requestAnimationFrame(tick);
        else resolve(frames / ((now - start) / 1000));
      };
      requestAnimationFrame(tick);
    }));
    expect(fps, type).toBeGreaterThan(55);
  }
});

test("G9: hero code stays far under 300 KB", async ({ request }) => {
  let total = 0;
  for (const file of ["/ui/heroes.js", "/ui/gl3d.js"]) total += (await (await request.get(file)).body()).length;
  expect(total).toBeLessThan(300 * 1024);
});
