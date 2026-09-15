// The operator CLIs have to EXIST on the deployed machine.
//
// The image installs with `--omit=dev`, so `tsx` is not there and no `npm run …` script that uses
// it can run. What exists is exactly what tsup emits — which is why the go-live imports are listed
// as build entries and run the way the deployment guide runs the seed:
//
//   node apps/api/dist/fleet-vocabulary.cli.js --write
//   node apps/api/dist/fleet-vehicles-import.cli.js --file ./cars.json --photos ./photos --write
//
// Dropping one from the entry list breaks nothing locally — `npm run import:vehicles` still works
// through tsx — and is invisible until somebody on a production shell finds the file is not there.
// This is what makes that loud.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = readFileSync(join(HERE, '../tsup.config.ts'), 'utf8');
const PKG = JSON.parse(readFileSync(join(HERE, '../package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  dependencies: Record<string, string>;
};

describe('the operator CLIs reach the deployed image', () => {
  const CLIS = ['src/fleet-vocabulary.cli.ts', 'src/fleet-vehicles-import.cli.ts'];

  it('builds every go-live CLI, not only the long-running services', () => {
    const entry = CONFIG.slice(
      CONFIG.indexOf('entry: ['),
      CONFIG.indexOf(']', CONFIG.indexOf('entry: [')),
    );
    for (const cli of CLIS) {
      expect(entry, `${cli} is a build entry`).toContain(cli);
    }
    // The services stay, obviously — this is an addition, not a replacement.
    for (const service of ['src/server.ts', 'src/worker.ts', 'src/seed.ts']) {
      expect(entry).toContain(service);
    }
  });

  it('is the ONLY way they can run there — tsx is dev-only', () => {
    // If tsx were a runtime dependency the npm scripts would work on the image and the entries
    // above would be a convenience. It is not, so they are the mechanism.
    expect(PKG.devDependencies.tsx, 'tsx is a devDependency').toBeDefined();
    expect(PKG.dependencies.tsx, 'and not a runtime one').toBeUndefined();
    for (const script of ['seed:fleet-vocabulary', 'import:vehicles']) {
      expect(PKG.scripts[script], `${script} runs through tsx, so it is local-only`).toContain(
        'tsx',
      );
    }
  });
});
