// The parts of the index sync that need no database: which mode a run is in, and which models it
// walks. What it does against a server is tests/integration/index-sync.spec.ts.
import mongoose, { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { indexSyncModeFrom, registeredModels } from './index-sync';

describe('the mode a run is in', () => {
  it('only reports unless told to build', () => {
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js'], 'report')).toBe('report');
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js'], '')).toBe('report');
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js'], 'APPLY')).toBe('report');
  });

  it('builds with --apply, or with INDEX_SYNC_MODE=apply', () => {
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js', '--apply'], 'report')).toBe('apply');
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js'], 'apply')).toBe('apply');
  });
});

describe('the models a run walks', () => {
  it('includes every model on a shared collection, not only the first', () => {
    // `notification_preferences` holds two models, each with its own index. Walking one model per
    // collection left the second one's index unbuilt.
    const shared = `index_sync_shared_${process.pid}`;
    const first = mongoose.model(`IndexSyncFirst${process.pid}`, new Schema({ a: String }), shared);
    const second = mongoose.model(
      `IndexSyncSecond${process.pid}`,
      new Schema({ b: String }),
      shared,
    );
    try {
      const walked = registeredModels();
      expect(walked).toContain(first);
      expect(walked).toContain(second);
    } finally {
      mongoose.deleteModel(first.modelName);
      mongoose.deleteModel(second.modelName);
    }
  });
});
