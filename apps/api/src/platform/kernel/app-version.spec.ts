// One version number for the platform.
//
// It used to be three: the package files said 2.1.0, the kernel's platform contract said 2.2.0,
// and a contract generator stamped a hand-typed «ecms-api/2.1.0». The owner settled it
// («أعتمد دا 2.2.0»), and this keeps it settled: every workspace declares the same version, and the
// platform-contract version the modules are checked against is that same number. A release bumps
// them together (`npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version`,
// then PLATFORM_VERSION) or this fails.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './app-version';
import { PLATFORM_VERSION } from './module-registry';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const declared = (dir: string): string =>
  (JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as { version: string }).version;

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

  it('and is the platform-contract version the modules are checked against', () => {
    expect(PLATFORM_VERSION, 'bump PLATFORM_VERSION with the package versions').toBe(APP_VERSION);
  });
});
