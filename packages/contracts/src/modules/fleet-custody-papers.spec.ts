// The custody papers' signature blocks («إعداد المذكرات») and the names each paper starts with —
// his own papers, word for word. These pin what a careless edit would lose silently: a paper's
// blocks in print order, the memo blocks that always print, his inner double spaces, and the
// spellings that differ from paper to paper on purpose.
import { describe, expect, it } from 'vitest';
import {
  FLEET_CUSTODY_LETTERS,
  FLEET_CUSTODY_PAPERS,
  FLEET_CUSTODY_PAPER_ROLES,
  FLEET_CUSTODY_SOURCES,
  FleetCustodyPaperSetSchema,
  FleetCustodySignBlockSchema,
  SaveFleetCustodyPaperSettingsSchema,
  isFleetCustodyMemoPaper,
  type FleetCustodyPaperSet,
} from './fleet.js';
import { DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES as DEFAULTS } from './fleet-custody-paper-defaults.js';

const copy = (): FleetCustodyPaperSet => structuredClone(DEFAULTS);
const issuePaths = (papers: unknown) => {
  const result = SaveFleetCustodyPaperSettingsSchema.safeParse({ papers });
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('the custody papers and their signature blocks', () => {
  it('has seven papers — the four memos, then the three letters', () => {
    expect(FLEET_CUSTODY_PAPERS).toEqual([
      'tyres',
      'fuel',
      'maintenance',
      'wash',
      'replenish',
      'settle',
      'charge',
    ]);
    expect(FLEET_CUSTODY_PAPERS.filter(isFleetCustodyMemoPaper).sort()).toEqual(
      [...FLEET_CUSTODY_SOURCES].sort(),
    );
    expect(FLEET_CUSTODY_PAPERS.filter((p) => !isFleetCustodyMemoPaper(p))).toEqual([
      ...FLEET_CUSTODY_LETTERS,
    ]);
    for (const paper of FLEET_CUSTODY_PAPERS) {
      expect(FLEET_CUSTODY_PAPER_ROLES[paper]).toEqual(
        isFleetCustodyMemoPaper(paper)
          ? ['preparer', 'director', 'endorser']
          : ['director', 'finance', 'endorser'],
      );
    }
  });

  it('his defaults are a valid set, unchanged by parsing', () => {
    const parsed = SaveFleetCustodyPaperSettingsSchema.parse({ papers: DEFAULTS });
    expect(parsed.papers).toEqual(DEFAULTS);
    expect(Object.keys(DEFAULTS)).toEqual([...FLEET_CUSTODY_PAPERS]);
    expect(
      SaveFleetCustodyPaperSettingsSchema.parse({ papers: DEFAULTS, version: 3 }).version,
    ).toBe(3);
  });

  it('every paper is its own object — no paper shares a block with another', () => {
    const blocks = FLEET_CUSTODY_PAPERS.flatMap((paper) => DEFAULTS[paper].blocks);
    expect(new Set(blocks).size).toBe(blocks.length);
    const sets = FLEET_CUSTODY_PAPERS.map((paper) => DEFAULTS[paper]);
    expect(new Set(sets).size).toBe(sets.length);
    expect(new Set(sets.map((set) => set.blocks)).size).toBe(sets.length);
  });

  it('refuses blocks out of their print order, missing, or doubled', () => {
    const swapped = copy();
    swapped.fuel.blocks = [
      swapped.fuel.blocks[1]!,
      swapped.fuel.blocks[0]!,
      swapped.fuel.blocks[2]!,
    ];
    expect(issuePaths(swapped)).toEqual(['papers.fuel.blocks']);

    const short = copy();
    short.charge.blocks = short.charge.blocks.slice(0, 2);
    expect(issuePaths(short)).toEqual(['papers.charge.blocks']);

    const doubled = copy();
    doubled.tyres.blocks = [...doubled.tyres.blocks, { ...doubled.tyres.blocks[2]! }];
    expect(issuePaths(doubled)).toEqual(['papers.tyres.blocks']);

    const letterOnMemo = copy();
    letterOnMemo.wash.blocks = structuredClone(DEFAULTS.replenish.blocks);
    expect(issuePaths(letterOnMemo)).toEqual(['papers.wash.blocks']);

    const missing: Partial<FleetCustodyPaperSet> = copy();
    delete missing.settle;
    expect(issuePaths(missing)).toEqual(['papers.settle']);
  });

  it('a memo always prints its preparer and director; its endorser and every letter block may be off', () => {
    for (const paper of ['tyres', 'fuel', 'maintenance', 'wash'] as const) {
      for (const index of [0, 1]) {
        const off = copy();
        off[paper].blocks[index]!.on = false;
        expect(issuePaths(off), `${paper} ${String(index)}`).toEqual([
          `papers.${paper}.blocks.${String(index)}.on`,
        ]);
      }
      const endorserOff = copy();
      endorserOff[paper].blocks[2]!.on = false;
      expect(issuePaths(endorserOff)).toEqual([]);
    }
    for (const paper of FLEET_CUSTODY_LETTERS) {
      const off = copy();
      for (const block of off[paper].blocks) block.on = false;
      expect(issuePaths(off), paper).toEqual([]);
    }
  });

  it('keeps his inner double spaces, trimming only the ends', () => {
    const parsed = FleetCustodySignBlockSchema.parse({
      role: 'director',
      office: '  مدير إدارة  الحركة  ',
      name: ' لواء ا . ح  : جمال أبو إسماعيل ',
      on: true,
    });
    expect(parsed.office).toBe('مدير إدارة  الحركة');
    expect(parsed.name).toBe('لواء ا . ح  : جمال أبو إسماعيل');
    const saved = SaveFleetCustodyPaperSettingsSchema.parse({ papers: DEFAULTS }).papers;
    expect(saved.tyres.blocks[1]!.office).toBe('مدير إدارة  الحركة');
    expect(saved.tyres.blocks[2]!.name).toContain('أبواسماعيل  -  المدير العام');
    expect(saved.charge.blocks[2]!.name).toBe('لواء ا . ح  : جمال أبو إسماعيل');
  });

  it('holds its length limits and refuses anything else', () => {
    const block = { role: 'preparer', office: '', name: '', on: true };
    expect(FleetCustodySignBlockSchema.safeParse(block).success).toBe(true);
    expect(
      FleetCustodySignBlockSchema.safeParse({ ...block, office: 'x'.repeat(200) }).success,
    ).toBe(true);
    expect(
      FleetCustodySignBlockSchema.safeParse({ ...block, office: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(FleetCustodySignBlockSchema.safeParse({ ...block, name: 'x'.repeat(300) }).success).toBe(
      true,
    );
    expect(FleetCustodySignBlockSchema.safeParse({ ...block, name: 'x'.repeat(301) }).success).toBe(
      false,
    );
    expect(FleetCustodySignBlockSchema.safeParse({ ...block, role: 'manager' }).success).toBe(
      false,
    );
    expect(FleetCustodySignBlockSchema.safeParse({ ...block, title: 'x' }).success).toBe(false);
    expect(
      FleetCustodySignBlockSchema.safeParse({ role: 'preparer', office: '', name: '' }).success,
    ).toBe(false);

    const longNote = copy();
    longNote.tyres.note = 'x'.repeat(301);
    expect(issuePaths(longNote)).toEqual(['papers.tyres.note']);
    const extraPaper = { ...copy(), licence: copy().charge };
    expect(FleetCustodyPaperSetSchema.safeParse(extraPaper).success).toBe(false);
    expect(
      SaveFleetCustodyPaperSettingsSchema.safeParse({ papers: DEFAULTS, version: -1 }).success,
    ).toBe(false);
    expect(
      SaveFleetCustodyPaperSettingsSchema.safeParse({ papers: DEFAULTS, extra: true }).success,
    ).toBe(false);
  });
});

describe('the names each paper starts with — his papers, word for word', () => {
  it('the washing memo is his tyres paper — its names too', () => {
    expect(DEFAULTS.wash).toEqual(DEFAULTS.tyres);
    expect(DEFAULTS.wash).not.toBe(DEFAULTS.tyres);
  });

  it('the settle letter leaves the general manager off; every other block prints', () => {
    expect(DEFAULTS.settle.blocks.map((block) => [block.role, block.on])).toEqual([
      ['director', true],
      ['finance', true],
      ['endorser', false],
    ]);
    for (const paper of FLEET_CUSTODY_PAPERS.filter((p) => p !== 'settle')) {
      expect(
        DEFAULTS[paper].blocks.every((block) => block.on),
        paper,
      ).toBe(true);
    }
  });

  it('spells the finance manager as each letter does — «الأستاذ» on the charge, «الاستاذ» elsewhere', () => {
    const finance = (paper: 'replenish' | 'settle' | 'charge') =>
      DEFAULTS[paper].blocks.find((block) => block.role === 'finance')!.name;
    expect(finance('charge')).toBe('الأستاذ : مصطفى حسب الله');
    expect(finance('replenish')).toBe('الاستاذ : مصطفى حسب الله');
    expect(finance('settle')).toBe('الاستاذ : مصطفى حسب الله');
  });

  it('the memos keep his review line, except fuel; the letters have none', () => {
    const review = 'يرجى المراجعة والتصديق على اجمالى المصروفات';
    expect(DEFAULTS.tyres.note).toBe(review);
    expect(DEFAULTS.maintenance.note).toBe(review);
    expect(DEFAULTS.wash.note).toBe(review);
    expect(DEFAULTS.fuel.note).toBe('');
    for (const paper of FLEET_CUSTODY_LETTERS) expect(DEFAULTS[paper].note).toBe('');
  });

  it('keeps each paper’s own spelling of the same people', () => {
    expect(DEFAULTS.tyres.blocks[1]!.name).toBe('عميد / ايهاب عبد السلام سليمان');
    expect(DEFAULTS.maintenance.blocks[1]!.name).toBe('عميد / إيهاب عبدالسلام سليمان');
    expect(DEFAULTS.fuel.blocks[1]!.name).toBe('عميد / ايهاب');
    expect(DEFAULTS.tyres.blocks[2]!.office).toBe('');
    expect(DEFAULTS.maintenance.blocks[2]!.office).toBe('');
    expect(DEFAULTS.fuel.blocks[2]!.office).toBe('السيد مدير عام الشركه');
  });
});
