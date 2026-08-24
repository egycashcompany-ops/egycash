// What makes ECMS installable as an APP rather than a shortcut.
//
// WHY A TEST. The symptom of getting this wrong is not an error anywhere — it is Chrome's menu
// quietly offering "Create shortcut" instead of "Install", which opens a browser tab wearing an
// icon. Nothing logs, nothing throws, and the only way to notice is for somebody to try to
// install the app and describe what they got. Every field asserted below is one Chrome refuses
// the install over, so each is pinned with the reason it is there.
//
// The manifest is a static file rather than something the build generates, and these read it the
// same way the browser does: fetch the bytes, parse them, check the members.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '../../..');
const read = (file: string): string => readFileSync(resolve(WEB, file), 'utf8');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}
interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  lang: string;
  dir: string;
  icons: ManifestIcon[];
  id?: string;
  prefer_related_applications?: boolean;
}

const manifest = (): Manifest => JSON.parse(read('public/manifest.webmanifest')) as Manifest;
const INDEX = read('index.html');
const SW = read('public/sw.js');

describe('the manifest carries what an install needs', () => {
  it('names the app, both in full and short', () => {
    // `name` is the install dialog's heading; `short_name` is what fits under the desktop icon.
    expect(manifest().name).not.toBe('');
    expect(manifest().short_name).not.toBe('');
  });

  it('opens in its own window — the whole point', () => {
    // Anything outside this set installs as a shortcut into a browser tab, which is the bug.
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest().display);
  });

  it('ships a 192px and a 512px icon, which is the size floor Chrome enforces', () => {
    const any = manifest().icons.filter((icon) => icon.purpose === 'any');
    expect(any.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512']);
    for (const icon of any) expect(icon.type).toBe('image/png');
  });

  it('ships a maskable icon too, so Android does not letterbox the mark', () => {
    // A launcher crops a non-maskable icon to its own shape; the maskable copy keeps the mark
    // inside the safe zone so the crop never eats it.
    const maskable = manifest().icons.filter((icon) => icon.purpose === 'maskable');
    expect(maskable).toHaveLength(1);
    expect(maskable[0]?.sizes).toBe('512x512');
  });

  it('reads right-to-left in Arabic, like the app it installs', () => {
    expect(manifest().lang).toBe('ar');
    expect(manifest().dir).toBe('rtl');
  });

  it('declares the window and splash colours', () => {
    for (const colour of [manifest().theme_color, manifest().background_color]) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('does not defer to a native app', () => {
    // `prefer_related_applications: true` tells the browser to offer a store listing instead of
    // installing this. There is no native ECMS, so the field must not be on.
    expect(manifest().prefer_related_applications ?? false).toBe(false);
  });
});

// A manifest can only promise a size; the FILE is what Chrome measures. The two drifting apart
// is a silent install refusal, so the bytes are read here the way the browser reads them.
describe('every icon the manifest promises is really there, at the size claimed', () => {
  /** Width and height out of a PNG's IHDR — the first chunk, at a fixed offset. */
  const pngSize = (file: string): { signature: boolean; width: number; height: number } => {
    const bytes = readFileSync(resolve(WEB, 'public', file));
    return {
      signature: bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  };

  it.each(manifest().icons.map((icon) => [icon.src, icon.sizes] as const))(
    '%s really is a %s PNG',
    (src, sizes) => {
      const [width, height] = sizes.split('x').map(Number);
      const png = pngSize(src);
      expect(png.signature, `${src} is a PNG`).toBe(true);
      expect([png.width, png.height]).toEqual([width, height]);
    },
  );

  it('and the apple-touch-icon the document links is a real 180px PNG', () => {
    // iOS never reads the manifest, so this one is only ever pinned from the document side.
    expect(pngSize('apple-touch-icon.png')).toEqual({ signature: true, width: 180, height: 180 });
  });
});

// The one thing that makes a subpath deployment (VITE_BASE_PATH=/ecms/) work with no build step
// of its own: every URL in the manifest resolves against the manifest's own address.
describe('the manifest is deployment-agnostic', () => {
  it('states its start url and scope relatively', () => {
    expect(manifest().start_url).toBe('.');
    expect(manifest().scope).toBe('.');
  });

  it('and points at its icons relatively', () => {
    for (const icon of manifest().icons) {
      expect(icon.src.startsWith('/'), icon.src).toBe(false);
      expect(icon.src.startsWith('http'), icon.src).toBe(false);
    }
  });

  it('claims no absolute id, which would collide between two apps on one origin', () => {
    // An `id` is resolved against the ORIGIN, not the manifest — so a subpath deployment that
    // spelled one out would answer to the root app's identity. Omitted, it defaults to start_url.
    expect(manifest().id).toBeUndefined();
  });
});

describe('the document points the browser at all of it', () => {
  it('links the manifest, through the base-url token so a subpath resolves', () => {
    expect(INDEX).toContain('<link rel="manifest" href="%BASE_URL%manifest.webmanifest" />');
  });

  it('carries an apple-touch-icon, the only icon iOS reads', () => {
    expect(INDEX).toContain('rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon.png"');
  });

  it('sets a theme colour for each scheme, so the title bar matches the shell', () => {
    expect(INDEX).toContain('name="theme-color" media="(prefers-color-scheme: light)"');
    expect(INDEX).toContain('name="theme-color" media="(prefers-color-scheme: dark)"');
  });
});

// The worker exists to make the install PROMPT eligible — Chrome's prompt algorithm still wants a
// fetch handler. What it must never become is a cache in front of an authenticated, per-user API.
describe('the service worker keeps its hands off the API', () => {
  it('has a fetch handler at all, which is what the prompt looks for', () => {
    expect(SW).toContain("self.addEventListener('fetch'");
  });

  it('answers nothing under the api or health paths from cache', () => {
    expect(SW).toContain('const isReserved = (pathname) =>');
    expect(SW).toContain('`${BASE}api/`');
    expect(SW).toContain('`${BASE}health/`');
    // The guard must run before anything is served, so a reserved path is never intercepted.
    expect(SW.indexOf('if (isReserved(url.pathname)) return;')).toBeLessThan(
      SW.indexOf('event.respondWith'),
    );
  });

  it('serves the HTML shell network-first, so a deploy is live on the next load', () => {
    expect(SW).toContain('event.respondWith(networkFirstShell(request));');
    expect(SW).toContain('const response = await fetch(request);');
  });

  it('only ever caches-first the content-hashed build output', () => {
    expect(SW).toContain('`${BASE}assets/`');
    expect(SW).toContain('event.respondWith(cacheFirstAsset(request));');
  });

  it('ignores other origins and non-GET requests', () => {
    expect(SW).toContain("if (request.method !== 'GET') return;");
    expect(SW).toContain('if (url.origin !== self.location.origin) return;');
  });

  it('derives every path from its own scope, so a subpath needs no configuration', () => {
    expect(SW).toContain('const BASE = new URL(self.registration.scope).pathname;');
  });
});
