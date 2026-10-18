// Every translation key the machine map asks for exists in BOTH catalogs (spec §8.12, §9.4). A
// missing key does not throw — `translate` falls back to the key — so without this an Arabic reader
// would see `atm.map.reason.notSynced` on screen.
//
// The vocabularies come from the contracts' own enums — every palette colour, unlocated reason,
// location source, status, warning and link failure (consentPage included) — so a value added there
// without words here is a failing test, in both locales. The page-level strings are listed
// literally, because nothing else enumerates them. The Arabic of every one of them must also pass
// the formal-Arabic guard (`scripts/check-formal-arabic.mjs`, DM-43), which has a spec of its own.
import { describe, expect, it } from 'vitest';
import {
  ATM_MAP_LINK_FAILURES,
  ATM_MAP_LOCATION_SOURCES,
  ATM_MAP_STATUS_FILTERS,
  ATM_MAP_UNLOCATED_REASONS_DTO,
  ATM_MAP_ZONE_PALETTE,
  AUDIT_ACTIONS,
  type AtmMapLocationWarning,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../platform/localization/i18n';
import { ZONE_PALETTE } from './lib/map-colors';
import { UNLOCATED_CHIP_ORDER, chipLabelKey, linkFailureKey } from './lib/unlocated-view';

const LOCALES: Locale[] = ['en', 'ar'];

const missingIn = (locale: Locale, keys: readonly string[]): string[] =>
  keys.filter((key) => translate(locale, key) === key);

/** The note an unlocated row shows for each warning a pin can carry (§8.8 `UnlocatedRow`). */
const WARNING_NOTES: Record<AtmMapLocationWarning, string> = {
  outsideEgypt: 'atm.map.location.outsideEgypt',
  weakReference: 'atm.map.unlocated.weakNote',
  viewportOnly: 'atm.map.unlocated.viewportNote',
  ambiguousUrl: 'atm.map.unlocated.ambiguousNote',
  sourcesDisagree: 'atm.map.unlocated.disagreeNote',
};

/** §8.12, literally — every key not derived from an enum below. */
const PAGE_KEYS = [
  'atm.nav.map',
  'atm.cards.map',
  'systemAdmin.users.audit.atmMapLocationSync',
  'systemAdmin.users.audit.atmMapLinkResolve',
  'atm.map.title',
  'atm.map.sync.title',
  'atm.map.move.doneTitle',
  'atm.map.draw.addedTitle',
  'atm.map.edit.notApplied',
  'atm.map.location.outsideEgypt',
  'atm.map.unlocated.notUnderReview',
  'atm.map.aria',
  'atm.map.ariaEdit',
  'atm.map.cluster.label',
  'atm.map.figures.label',
  'atm.map.figures.onMap',
  'atm.map.figures.inZones',
  'atm.map.figures.outZones',
  'atm.map.figures.unlocated',
  'atm.map.actions.unlocated',
  'atm.map.actions.editZones',
  'atm.map.filters.bank',
  'atm.map.filters.area',
  'atm.map.filters.zone',
  'atm.map.filters.status',
  'atm.map.filters.location',
  'atm.map.filters.all',
  'atm.map.filters.search',
  'atm.map.filters.bankNone',
  'atm.map.filters.zoneNone',
  'atm.map.filters.zoneMulti',
  'atm.map.location.located',
  'atm.map.location.review',
  'atm.map.panel.branch',
  'atm.map.panel.branchAll',
  'atm.map.panel.zones',
  'atm.map.panel.zonesSearch',
  'atm.map.panel.summaryIn',
  'atm.map.panel.summaryOut',
  'atm.map.panel.summaryUnlocated',
  'atm.map.panel.toggle',
  'atm.map.panel.narrowNote',
  'atm.map.layers.title',
  'atm.map.layers.pins',
  'atm.map.layers.zones',
  'atm.map.layers.names',
  'atm.map.layers.faded',
  'atm.map.layers.colorBy',
  'atm.map.layers.byZone',
  'atm.map.layers.byBank',
  'atm.map.legend.bank',
  'atm.map.detail.back',
  'atm.map.detail.edit',
  'atm.map.detail.byBank',
  'atm.map.detail.byArea',
  'atm.map.detail.machines',
  'atm.map.detail.overlapsOthers',
  'atm.map.popup.close',
  'atm.map.popup.branch',
  'atm.map.popup.zone',
  'atm.map.popup.zoneMulti',
  'atm.map.popup.source',
  'atm.map.popup.lastSet',
  'atm.map.popup.approved',
  'atm.map.popup.openRegister',
  'atm.map.popup.openGoogle',
  'atm.map.popup.move',
  'atm.map.empty.noZones',
  'atm.map.empty.drawFirst',
  'atm.map.empty.noMatch',
  'atm.map.empty.noBranches',
  'atm.map.tilesFailed',
  'atm.map.controls.fitAll',
  'atm.map.controls.zoomIn',
  'atm.map.controls.zoomOut',
  'atm.map.scale.m',
  'atm.map.scale.km',
  'atm.map.search.unlocated',
  'atm.map.search.notFound',
  'atm.map.edit.banner',
  'atm.map.edit.unsaved',
  'atm.map.edit.undo',
  'atm.map.edit.redo',
  'atm.map.edit.discard',
  'atm.map.edit.save',
  'atm.map.edit.exit',
  'atm.map.edit.branchLocked',
  'atm.map.edit.locked',
  'atm.map.edit.newZone',
  'atm.map.edit.selected',
  'atm.map.edit.name',
  'atm.map.edit.color',
  'atm.map.edit.colorGroup',
  'atm.map.edit.custom',
  'atm.map.edit.suggested',
  'atm.map.edit.inside',
  'atm.map.edit.insideWas',
  'atm.map.edit.points',
  'atm.map.edit.deleteVertex',
  'atm.map.edit.dragHint',
  'atm.map.edit.deleteZone',
  'atm.map.edit.pickHint',
  'atm.map.edit.snap',
  'atm.map.edit.snapToggle',
  'atm.map.edit.snapDistance',
  'atm.map.edit.snapHelp',
  'atm.map.edit.list',
  'atm.map.edit.sortAz',
  'atm.map.edit.moveUp',
  'atm.map.edit.moveDown',
  'atm.map.edit.priorityHelp',
  'atm.map.edit.overlap',
  'atm.map.edit.defaultName',
  'atm.map.edit.chooseBranch',
  'atm.map.edit.branchNotEditable',
  'atm.map.draw.title',
  'atm.map.draw.step1',
  'atm.map.draw.step2',
  'atm.map.draw.step3',
  'atm.map.draw.points',
  'atm.map.draw.inside',
  'atm.map.draw.insideChip',
  'atm.map.draw.hint',
  'atm.map.draw.finish',
  'atm.map.draw.undoPoint',
  'atm.map.draw.cancel',
  'atm.map.draw.needThree',
  'atm.map.draw.closeShape',
  'atm.map.draw.cancelled',
  'atm.map.draw.crossing',
  'atm.map.draw.added',
  'atm.map.draw.tooSmall',
  'atm.map.vertex.label',
  'atm.map.vertex.shared',
  'atm.map.vertex.delete',
  'atm.map.vertex.minThree',
  'atm.map.vertex.midpoint',
  'atm.map.save.title',
  'atm.map.save.counts',
  'atm.map.save.colZone',
  'atm.map.save.colBefore',
  'atm.map.save.colAfter',
  'atm.map.save.deleted',
  'atm.map.save.orphaned',
  'atm.map.save.back',
  'atm.map.save.confirm',
  'atm.map.save.saved',
  'atm.map.save.error.duplicateName',
  'atm.map.save.error.tooManyZones',
  'atm.map.save.error.tooManyPoints',
  'atm.map.save.error.geometry',
  'atm.map.save.error.branchChanged',
  'atm.map.conflict.title',
  'atm.map.conflict.body',
  'atm.map.conflict.bodyNoDraft',
  'atm.map.conflict.reload',
  'atm.map.conflict.close',
  'atm.map.deleteZone.title',
  'atm.map.deleteZone.body',
  'atm.map.deleteZone.back',
  'atm.map.deleteZone.confirm',
  'atm.map.discard.body',
  'atm.map.leave.body',
  'atm.map.draft.found',
  'atm.map.draft.restore',
  'atm.map.draft.ignore',
  'atm.map.draft.outdated',
  'atm.map.move.hint',
  'atm.map.move.zone',
  'atm.map.move.confirm',
  'atm.map.move.cancel',
  'atm.map.move.clickHint',
  'atm.map.move.markerAria',
  'atm.map.move.dialogTitle',
  'atm.map.move.distance',
  'atm.map.move.zoneChange',
  'atm.map.move.reason',
  'atm.map.move.reasonRequired',
  'atm.map.move.back',
  'atm.map.move.ok',
  'atm.map.move.done',
  'atm.map.unlocated.title',
  'atm.map.unlocated.progress',
  'atm.map.unlocated.back',
  'atm.map.unlocated.search',
  'atm.map.unlocated.empty',
  'atm.map.unlocated.sourceLabel',
  'atm.map.unlocated.reviewNote',
  'atm.map.unlocated.weakNote',
  'atm.map.unlocated.approve',
  'atm.map.unlocated.correct',
  'atm.map.unlocated.viewportNote',
  'atm.map.unlocated.ambiguousNote',
  'atm.map.unlocated.disagreeNote',
  'atm.map.unlocated.sourceChanged',
  'atm.map.unlocated.paste',
  'atm.map.unlocated.read',
  'atm.map.unlocated.place',
  'atm.map.unlocated.openOriginal',
  'atm.map.parse.ok',
  'atm.map.parse.shortLink',
  'atm.map.parse.noCoordinates',
  'atm.map.parse.unreadable',
  'atm.map.parse.invalidCoordinates',
  'atm.map.parse.changed',
  'atm.map.parse.viewportReview',
  'atm.map.parse.outsideEgypt',
  'atm.map.parse.shortPlusCodeReview',
  'atm.map.parse.shortPlusCodeNoReference',
  'atm.map.links.title',
  'atm.map.links.body',
  'atm.map.links.start',
  'atm.map.links.progress',
  'atm.map.links.done',
  'atm.map.links.doneAll',
  'atm.map.links.busy',
  'atm.map.links.rateLimited',
  'atm.map.links.unreachable',
  'atm.map.sync.title',
  'atm.map.sync.body',
  'atm.map.sync.start',
  'atm.map.sync.pending',
  'atm.map.sync.last',
  'atm.map.sync.done',
  // Reused, saying the same thing (§8.12).
  'atm.common.bank',
  'atm.common.machineId',
  'atm.common.machineName',
  'atm.common.area',
];

const VOCABULARY_KEYS = [
  ...ATM_MAP_ZONE_PALETTE.map((c) => `atm.map.palette.${c.key}`),
  ...ATM_MAP_UNLOCATED_REASONS_DTO.map((r) => `atm.map.reason.${r}`),
  'atm.map.reason.review',
  ...ATM_MAP_LOCATION_SOURCES.map((s) => `atm.map.source.${s}`),
  ...ATM_MAP_STATUS_FILTERS.map((s) => `atm.map.status.${s}`),
  ...['zero', 'one', 'two', 'few', 'many'].map((form) => `atm.map.count.${form}`),
  ...Object.values(WARNING_NOTES),
  ...ATM_MAP_LINK_FAILURES.map(linkFailureKey),
];

describe('machine map i18n', () => {
  it.each(LOCALES)('every §8.12 key resolves in %s', (locale) => {
    expect(missingIn(locale, PAGE_KEYS)).toEqual([]);
  });

  it.each(LOCALES)(
    'every palette name, reason, source, status, warning note and link failure resolves in %s',
    (locale) => {
      expect(missingIn(locale, VOCABULARY_KEYS)).toEqual([]);
      expect(
        missingIn(
          locale,
          ZONE_PALETTE.map((c) => c.nameKey),
        ),
      ).toEqual([]);
      expect(missingIn(locale, UNLOCATED_CHIP_ORDER.map(chipLabelKey))).toEqual([]);
    },
  );

  it('the consent-page failure has its own words', () => {
    expect(ATM_MAP_LINK_FAILURES).toContain('consentPage');
    expect(translate('ar', 'atm.map.linkFailure.consentPage')).toBe(
      'أعاد Google صفحة موافقة بدل الموقع.',
    );
  });

  it.each(LOCALES)('the two audit verbs are labelled in %s', (locale) => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining(['atmMapLocationSync', 'atmMapLinkResolve']),
    );
    expect(
      missingIn(locale, [
        'systemAdmin.users.audit.atmMapLocationSync',
        'systemAdmin.users.audit.atmMapLinkResolve',
      ]),
    ).toEqual([]);
  });

  it('placeholders agree between the two catalogs', () => {
    const names = (text: string): string[] =>
      [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? '').sort();
    for (const key of [...PAGE_KEYS, ...VOCABULARY_KEYS]) {
      expect(names(translate('ar', key)), key).toEqual(names(translate('en', key)));
    }
  });

  it('the zone name stays «قطاع» and the Area stays «المنطقة» (D-M1)', () => {
    expect(translate('ar', 'atm.map.filters.zone')).toBe('القطاع');
    expect(translate('ar', 'atm.map.filters.area')).toBe('المنطقة');
    expect(translate('en', 'atm.map.filters.zone')).toBe('Zone');
  });
});
