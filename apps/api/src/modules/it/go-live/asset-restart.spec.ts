// The IT asset restart reaches the company by DEPLOYING, or it does not reach the company — the
// Fleet go-live lesson (`fleet/go-live/go-live.spec.ts`): what has to be guarded is the CALLER.
// The behaviour itself is proved against a real mongo in
// `tests/integration/it-go-live-asset-restart.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatAssetCode } from '../assets/asset-number';
import {
  IT_ASSET_RESTART_MARK,
  KEPT_ASSET_CODE,
  RESTARTED_ASSET_CODE,
  retiredAssetCode,
} from './asset-restart';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the asset restart is started by the deploy', () => {
  it.each(['src/server.ts', 'src/worker.ts'])('%s starts it', (file) => {
    expect(code(file)).toContain('startItAssetRestartGoLive();');
  });
});

describe('what the restart was asked for', () => {
  it('keeps AST-00005 as AST-00001, once, under a versioned key', () => {
    expect(KEPT_ASSET_CODE).toBe('AST-00005');
    expect(RESTARTED_ASSET_CODE).toBe(formatAssetCode(1));
    expect(RESTARTED_ASSET_CODE).toBe('AST-00001');
    expect(IT_ASSET_RESTART_MARK).toMatch(/:v\d+$/);
  });

  it('frees a deleted asset’s code into one no allocation or scan can produce', () => {
    const retired = retiredAssetCode('AST-00002', '652f0c0c0c0c0c0c0c0c0c0c');
    expect(retired).toContain('AST-00002');
    expect(retired).toContain('652f0c0c0c0c0c0c0c0c0c0c');
    expect(retired).not.toMatch(/^AST-\d+$/);
  });

  it('decides once — a refusal is recorded, never retried on a later boot', () => {
    const source = code('src/modules/it/go-live/asset-restart.ts');
    const refusal = source.slice(source.indexOf('if (kept === null)'));
    expect(refusal.indexOf('recordItGoLiveRun(')).toBeGreaterThan(-1);
    expect(refusal.indexOf('recordItGoLiveRun(')).toBeLessThan(refusal.indexOf("'refused'"));
  });
});
