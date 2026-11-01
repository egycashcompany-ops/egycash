// One version number for the platform.
//
// The package files said 2.1.0 while the screens were meant to say 2.2.0, and a contract generator
// stamped a hand-typed «ecms-api/2.1.0». The owner settled it («أعتمد دا 2.2.0»), and this keeps
// it settled: every workspace declares the same version, which is the one the app shows and the
// contracts carry. A release bumps them together:
// `npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version`.
//
// Not the kernel's PLATFORM_VERSION. That is the platform-contract version module manifests are
// checked against (Review R25), moved by contract changes, not by releases — tied to this, a major
// release would fail every module's `requiresPlatform` at boot.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './app-version';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const declared = (dir: string): string =>
  (JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as { version: string })
    .version;

describe('the platform has one version', () => {
  it('is a plain x.y.z', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(['.', 'apps/api', 'apps/web', 'packages/contracts', 'packages/config'])(
    'declared the same in %s/package.json',
    (dir) => {
      expect(declared(dir)).toBe(APP_VERSION);
    },
  );
});
