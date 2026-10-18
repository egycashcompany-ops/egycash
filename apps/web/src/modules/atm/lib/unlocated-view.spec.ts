// «ماكينات بدون موقع» as data (spec §9.4): chip counts hide zeros, every parse result maps to an
// existing i18n key in both locales, and the resolve loop follows §8.10.
import { describe, expect, it } from 'vitest';
import {
  ATM_MAP_LINK_FAILURES,
  ATM_MAP_LOCATION_WARNINGS,
  ATM_MAP_UNLOCATED_REASONS_DTO,
  type AtmMapLinkResolveResultDto,
  type AtmMapParseResultDto,
  type AtmMapPointDto,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  UNLOCATED_CHIP_ORDER,
  chipLabelKey,
  linkFailureKey,
  parseFeedback,
  reasonChipCounts,
  resolveLoopEndMessage,
  resolveLoopShouldContinue,
} from './unlocated-view';

const exists = (key: string): boolean =>
  translate('ar', key) !== key && translate('en', key) !== key;

const point = (overrides: Partial<AtmMapPointDto>): AtmMapPointDto => ({
  machineId: 'm',
  code: 'M',
  name: 'm',
  branchId: 'b1',
  area: '',
  bankName: '',
  bankCode: null,
  active: true,
  lat: null,
  lng: null,
  state: 'unlocated',
  source: null,
  reason: 'none',
  warnings: [],
  lastSet: null,
  ...overrides,
});

const result = (overrides: Partial<AtmMapLinkResolveResultDto>): AtmMapLinkResolveResultDto => ({
  attempted: 20,
  resolved: 18,
  failed: 2,
  remaining: 40,
  conflicts: 0,
  busy: false,
  stopReason: null,
  ...overrides,
});

describe('reasonChipCounts', () => {
  it('counts per chip in screen order and hides the empty ones', () => {
    const counts = reasonChipCounts([
      point({ reason: 'notSynced' }),
      point({ reason: 'shortLink' }),
      point({ reason: 'shortLink' }),
      point({ state: 'review', reason: null, lat: 30, lng: 31 }),
      point({ state: 'located', reason: null, lat: 30, lng: 31 }),
    ]);
    expect(counts).toEqual([
      { chip: 'review', count: 1 },
      { chip: 'shortLink', count: 2 },
      { chip: 'notSynced', count: 1 },
    ]);
  });

  it('has a chip, with a label in both locales, for every reason and for review', () => {
    expect([...UNLOCATED_CHIP_ORDER].sort()).toEqual(
      ['review', ...ATM_MAP_UNLOCATED_REASONS_DTO].sort(),
    );
    for (const chip of UNLOCATED_CHIP_ORDER) expect(exists(chipLabelKey(chip))).toBe(true);
  });
});

describe('parseFeedback', () => {
  const ok = (
    overrides: Partial<Extract<AtmMapParseResultDto, { ok: true }>>,
  ): AtmMapParseResultDto => ({
    ok: true,
    lat: 30,
    lng: 31,
    kind: 'url',
    needsReview: false,
    warnings: [],
    ...overrides,
  });

  it('maps every parse result to an existing i18n key', () => {
    const results: AtmMapParseResultDto[] = [
      ok({}),
      ok({ kind: 'coordinates' }),
      ok({ kind: 'plusCode' }),
      ok({ kind: 'shortPlusCode', needsReview: true }),
      ok({ kind: 'viewport', needsReview: true, warnings: ['viewportOnly'] }),
      ...ATM_MAP_LOCATION_WARNINGS.map((warning) => ok({ warnings: [warning] })),
      ...(
        [
          'shortLink',
          'noCoordinates',
          'invalidCoordinates',
          'unreadable',
          'shortPlusCodeNoReference',
        ] as const
      ).map((reason): AtmMapParseResultDto => ({ ok: false, reason })),
    ];
    for (const r of results) expect(exists(parseFeedback(r).key)).toBe(true);
  });

  it('says what is rough before it says ok, and a failure is an error', () => {
    expect(parseFeedback(ok({}))).toEqual({ key: 'atm.map.parse.ok', tone: 'success' });
    expect(parseFeedback(ok({ kind: 'viewport', warnings: ['viewportOnly'] })).key).toBe(
      'atm.map.parse.viewportReview',
    );
    expect(parseFeedback(ok({ kind: 'shortPlusCode', warnings: ['weakReference'] })).key).toBe(
      'atm.map.parse.shortPlusCodeReview',
    );
    expect(parseFeedback(ok({ warnings: ['outsideEgypt'] }))).toEqual({
      key: 'atm.map.parse.outsideEgypt',
      tone: 'warning',
    });
    expect(parseFeedback({ ok: false, reason: 'shortLink' })).toEqual({
      key: 'atm.map.parse.shortLink',
      tone: 'error',
    });
  });

  it('every link failure has words, consentPage included', () => {
    for (const failure of ATM_MAP_LINK_FAILURES) expect(exists(linkFailureKey(failure))).toBe(true);
    expect(linkFailureKey('consentPage')).toBe('atm.map.linkFailure.consentPage');
  });
});

describe('the resolve loop (§8.10)', () => {
  it('continues while links remain, the call attempted some, and only the budget stopped it', () => {
    expect(resolveLoopShouldContinue(result({}))).toBe(true);
    expect(resolveLoopShouldContinue(result({ stopReason: 'budget' }))).toBe(true);
  });

  it('stops on attempted 0, busy, rateLimited, unreachable, and nothing remaining', () => {
    expect(resolveLoopShouldContinue(result({ attempted: 0 }))).toBe(false);
    expect(resolveLoopShouldContinue(result({ busy: true, attempted: 0 }))).toBe(false);
    expect(resolveLoopShouldContinue(result({ stopReason: 'rateLimited' }))).toBe(false);
    expect(resolveLoopShouldContinue(result({ stopReason: 'unreachable' }))).toBe(false);
    expect(resolveLoopShouldContinue(result({ remaining: 0 }))).toBe(false);
  });

  it('ends with the mockup’s words, or why it stopped', () => {
    const totals = { resolved: 30, failed: 3, total: 33 };
    expect(resolveLoopEndMessage(result({ remaining: 0 }), totals)).toEqual({
      key: 'atm.map.links.done',
      params: totals,
      tone: 'warning',
    });
    expect(resolveLoopEndMessage(result({ remaining: 0 }), { ...totals, failed: 0 })?.key).toBe(
      'atm.map.links.doneAll',
    );
    expect(resolveLoopEndMessage(result({ busy: true }), totals)?.key).toBe('atm.map.links.busy');
    expect(resolveLoopEndMessage(result({ stopReason: 'rateLimited' }), totals)?.key).toBe(
      'atm.map.links.rateLimited',
    );
    expect(resolveLoopEndMessage(result({ stopReason: 'unreachable' }), totals)?.key).toBe(
      'atm.map.links.unreachable',
    );
    expect(resolveLoopEndMessage(result({ attempted: 0 }), totals)).toBeNull();
  });
});
