// What `db:sync-indexes` loads is what it can build. A model it never loads is a set of indexes
// that is never built in production — `autoIndex` is off there — and nothing says so: the report
// lists what is missing among the models it knows, and is silent about the ones it does not.
//
// So the loader is checked against the source tree, not trusted: every file that defines a model
// is imported after it, and any model that appears only then is one the deploy step would miss.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { DRIVER_SIDE_INDEX_HINTS, FORWARDED_INDEX_OPTIONS } from './shared/base/index-plan';
import { registeredModels } from './shared/base/index-sync';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A `model(…)` / `model<…>(…)` call — how every model in this codebase is defined. */
const DEFINES_A_MODEL = /\bmodel\s*(?:<[^>]*>)?\s*\(/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')
      ? [path]
      : [];
  });

/**
 * Files below src/ that define a model. The entry files directly in src/ are left out: server,
 * worker and the CLIs start the process when imported, and none of them defines a model.
 */
const modelFiles = (): string[] =>
  sourceFiles(HERE)
    .filter((path) => relative(HERE, path).includes('/'))
    .filter((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes('mongoose') && DEFINES_A_MODEL.test(source);
    });

beforeAll(async () => {
  await import('./sync-indexes.models');
}, 120_000);

describe('the deploy step loads every model the api declares', () => {
  it('reaches the collections a production boot never indexed', () => {
    // Before the source tree is imported below, so this is what the loader alone registers.
    const collections = new Set(registeredModels().map((model) => model.collection.collectionName));
    for (const name of [
      'sessions',
      'users',
      'hr_employees',
      'notification_preferences',
      'it_go_live_runs',
    ]) {
      expect(collections, name).toContain(name);
    }
  });

  it('no model file registers a model the loader missed', async () => {
    const files = modelFiles();
    // A broken pattern would find nothing and pass; the tree has well over a hundred model files.
    expect(files.length).toBeGreaterThan(100);

    const loaded = new Set(mongoose.modelNames());
    for (const file of files) await import(pathToFileURL(file).href);
    const missed = mongoose
      .modelNames()
      .filter((name) => !loaded.has(name))
      .map((name) => `${name} (${mongoose.model(name).collection.collectionName})`);

    expect(missed, 'import these models in sync-indexes.models.ts').toEqual([]);
  }, 120_000);
});

describe('every index option a schema declares reaches createIndex', () => {
  it('declares nothing outside the forwarded set and the known driver hints', () => {
    // An option outside both lists would be dropped by `indexBuildPlan` without a word, and the
    // index built without it — a TTL with no expiry, a partial index over every row.
    const known = new Set<string>([...FORWARDED_INDEX_OPTIONS, ...DRIVER_SIDE_INDEX_HINTS]);
    const unknown: string[] = [];
    for (const model of registeredModels()) {
      for (const [, options] of model.schema.indexes()) {
        for (const option of Object.keys(options ?? {})) {
          if (!known.has(option)) unknown.push(`${model.modelName}: ${option}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});
