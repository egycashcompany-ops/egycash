import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The version the app shows — on the sign-in screen and in the user menu — is stamped here, at
// build time, as two variables the client reads like any other `import.meta.env` value:
//
//   VITE_APP_VERSION  the platform's version, from the repository root's package.json: the one
//                     number the platform is released and presented under.
//   VITE_APP_BUILD    the commit the bundle was built from, so "which build is this?" has an answer
//                     on the screen itself. Railway provides RAILWAY_GIT_COMMIT_SHA to a build
//                     deployed from GitHub; a local or CI build asks git; a build with neither (a
//                     source tarball) gets no build id rather than a failed build.
//
// A non-empty value already set in the environment wins, so a deployment can pin either one (a
// blank variable counts as unset). They go into `process.env` rather than `define` because Vite
// assembles `import.meta.env` from the VITE_-prefixed variables it finds there, after this file has
// run — so every reader of `import.meta.env`, including bracket access, sees them.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const platformVersion = (): string => {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as { version?: string };
  return pkg.version ?? '';
};

const buildId = (): string => {
  const fromHost = process.env['RAILWAY_GIT_COMMIT_SHA'] ?? process.env['GITHUB_SHA'];
  if (fromHost !== undefined && fromHost !== '') return fromHost.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
};

process.env['VITE_APP_VERSION'] ||= platformVersion();
process.env['VITE_APP_BUILD'] ||= buildId();

// Subpath deployments (e.g. https://egycash.com.eg/ecms): VITE_BASE_PATH sets the asset
// base and — via import.meta.env.BASE_URL — the router basename. Root ('/') by default.
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, '.', 'VITE_').VITE_BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
  },
}));
