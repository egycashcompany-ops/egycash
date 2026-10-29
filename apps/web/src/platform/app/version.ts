// The version the app shows, as the build stamped it (see `vite.config.ts`).
//
// One reader for every screen that shows it (the user menu, the crash screen, the captain's phone
// screens, the driver profile), so no two can disagree about which build a person is looking at —
// which is the whole point of showing it: when somebody reports a problem, the number on their
// screen says what they were running.
//
// Displayed only to a signed-in session (`AppVersion` checks): a version printed on a public page
// is a banner for anybody probing the site. It is not a secret — the bundle carries it, as it
// carries every library's version — so nothing relies on it being one.

const read = (key: 'VITE_APP_VERSION' | 'VITE_APP_BUILD'): string => {
  const value = import.meta.env[key] as unknown;
  return typeof value === 'string' ? value.trim() : '';
};

/** The platform version, e.g. «2.2.0». Empty when nothing stamped it — a test run, for instance. */
export const APP_VERSION = read('VITE_APP_VERSION');

/** The short commit the bundle was built from, e.g. «390dce6». Empty when the build had none. */
export const APP_BUILD = read('VITE_APP_BUILD');

/**
 * «2.2.0 · 390dce6»; «2.2.0» when there is no build id; '' when nothing is known — callers render
 * nothing at all then, rather than a label with no number after it.
 */
export const versionText = (version: string = APP_VERSION, build: string = APP_BUILD): string =>
  [version, build].filter((part) => part !== '').join(' · ');
