// «إعداد المذكرات» as stored → as printed: a paper saved in a valid shape prints as saved; a paper
// never saved, or no longer valid, prints his own names. And a snapshot is always a copy.
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  FLEET_CUSTODY_PAPERS,
  type FleetCustodyPaperSignatures,
} from '@ecms/contracts';

const stored: { doc: unknown } = { doc: null };
vi.mock('./custody-paper-settings.repository', () => ({
  fleetCustodyPaperSettingsRepository: { findByKey: async () => stored.doc },
}));

const { fleetCustodyPapersService, mergePaperSettings } = await import('./custody-papers.service');

const tyres: FleetCustodyPaperSignatures = {
  blocks: [
    { role: 'preparer', office: 'مشرف  الصيانه', name: 'أ', on: true },
    { role: 'director', office: 'مدير', name: 'ب', on: true },
    { role: 'endorser', office: '', name: 'ج', on: false },
  ],
  note: 'سطر',
};

describe('mergePaperSettings', () => {
  it('nothing stored: all seven papers are his defaults', () => {
    for (const value of [undefined, null, {}, 'junk', 42]) {
      expect(mergePaperSettings(value)).toEqual(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES);
    }
  });

  it('a saved paper prints as saved — inner double spaces kept — the rest stay his', () => {
    const merged = mergePaperSettings({ tyres });
    expect(merged.tyres).toEqual(tyres);
    expect(merged.tyres.blocks[0]?.office).toBe('مشرف  الصيانه');
    for (const paper of FLEET_CUSTODY_PAPERS.filter((p) => p !== 'tyres')) {
      expect(merged[paper], paper).toEqual(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES[paper]);
    }
  });

  it('a paper no longer valid falls back to his — never half a block', () => {
    const merged = mergePaperSettings({
      // the roles out of order
      tyres: { ...tyres, blocks: [...tyres.blocks].reverse() },
      // a memo's preparer switched off
      wash: {
        ...tyres,
        blocks: tyres.blocks.map((b) => (b.role === 'preparer' ? { ...b, on: false } : b)),
      },
      // an older shape
      fuel: { agent: 'x' },
      // a letter saved right is kept
      charge: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.settle,
    });
    expect(merged.tyres).toEqual(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.tyres);
    expect(merged.wash).toEqual(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.wash);
    expect(merged.fuel).toEqual(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.fuel);
    expect(merged.charge).toEqual(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.settle);
  });

  it('hands out copies — changing one never reaches the defaults', () => {
    const merged = mergePaperSettings(null);
    (merged.tyres.blocks[0] as { name: string }).name = 'changed';
    expect(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.tyres.blocks[0]?.name).not.toBe('changed');
  });
});

describe('the service', () => {
  it('before anybody saved: his defaults, version null', async () => {
    stored.doc = null;
    expect(await fleetCustodyPapersService.getSettings()).toEqual({
      papers: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
      version: null,
    });
  });

  it('after a save: the saved papers and the row’s version', async () => {
    stored.doc = { _id: 'x', papers: { tyres }, __v: 3 };
    const settings = await fleetCustodyPapersService.getSettings();
    expect(settings.version).toBe(3);
    expect(settings.papers.tyres).toEqual(tyres);
  });

  it('signaturesFor is a deep copy of that one paper — a snapshot no later change can reach', async () => {
    stored.doc = { _id: 'x', papers: { tyres }, __v: 3 };
    const snap = await fleetCustodyPapersService.signaturesFor('tyres');
    expect(snap).toEqual(tyres);
    (snap.blocks[0] as { name: string }).name = 'changed';
    expect(tyres.blocks[0]?.name).toBe('أ');
    expect((await fleetCustodyPapersService.signaturesFor('tyres')).blocks[0]?.name).toBe('أ');

    stored.doc = null;
    const fallback = await fleetCustodyPapersService.signaturesFor('settle');
    expect(fallback).toEqual(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.settle);
    expect(fallback).not.toBe(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.settle);
  });
});
