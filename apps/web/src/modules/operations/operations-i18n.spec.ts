// Every Operations translation key the shipped screens ask for exists in BOTH catalogs.
//
// This is the catalog half of the pair the IT module established: this file proves the keys are
// there, and the component specs prove the components ask for the keys that are there. A missing
// key does not throw — `translate` falls back to the key itself — so without this test an Arabic
// operator would simply read `operations.catalogs.bank.opsName` on screen.
//
// The list is written out rather than derived from the catalog, deliberately: deriving it would
// only prove the catalog agrees with itself.
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_SHIPMENT_STATUSES,
  OPERATIONS_SHIPMENT_TYPES,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../platform/localization/i18n';
import { OPERATIONS_CATALOG_KINDS } from './pages/CatalogsPage';
import { CREW_SLOTS } from './lib/crew-board';
import { REQUIREMENT_FLAGS } from './lib/requirements';

const LOCALES: Locale[] = ['en', 'ar'];

const SHELL_KEYS = [
  'operations.module.title',
  'operations.overview.title',
  'operations.overview.subtitle',
  'operations.overview.noAccessTitle',
  'operations.overview.noAccessBody',
  'operations.nav.catalogs',
  'operations.cards.catalogs',
  'operations.common.status',
  'operations.common.active',
  'operations.common.inactive',
];

const CATALOG_KEYS = [
  'operations.catalogs.title',
  'operations.catalogs.subtitle',
  'operations.catalogs.saved',
  'operations.catalogs.saveFailed',
  ...(['bank', 'branch', 'currency'] as const).flatMap((kind) => [
    `operations.catalogs.${kind}.add`,
    `operations.catalogs.${kind}.edit`,
    `operations.catalogs.${kind}.empty`,
  ]),
  'operations.catalogs.bank.code',
  'operations.catalogs.bank.nameAr',
  'operations.catalogs.bank.nameEn',
  'operations.catalogs.bank.opsName',
  'operations.catalogs.bank.opsNameHint',
  'operations.catalogs.bank.sortOrder',
  'operations.catalogs.bank.sortOrderHint',
  'operations.catalogs.branch.bank',
  'operations.catalogs.branch.name',
  'operations.catalogs.branch.code',
  'operations.catalogs.branch.opsArea',
  'operations.catalogs.branch.opsAreaHint',
  'operations.catalogs.branch.financeArea',
  'operations.catalogs.branch.financeAreaHint',
  'operations.catalogs.currency.code',
  'operations.catalogs.currency.name',
  'operations.catalogs.currency.aliases',
  'operations.catalogs.currency.aliasesHint',
];

/** B2 — the daily board and the shipment form. */
const BOARD_KEYS = [
  'operations.nav.dailyOps',
  'operations.cards.dailyOps',
  'operations.dailyOps.title',
  'operations.dailyOps.subtitle',
  'operations.dailyOps.date',
  'operations.dailyOps.all',
  'operations.dailyOps.received',
  'operations.dailyOps.receivedYes',
  'operations.dailyOps.receivedNo',
  'operations.dailyOps.count',
  'operations.dailyOps.empty',
  'operations.shipment.add',
  'operations.shipment.edit',
  'operations.shipment.saved',
  'operations.shipment.saveFailed',
  'operations.shipment.deleted',
  'operations.shipment.deleteFailed',
  'operations.shipment.confirmDelete',
  'operations.shipment.receive',
  'operations.shipment.unreceive',
  'operations.shipment.receiveFailed',
  'operations.shipment.needLine',
  'operations.shipment.type',
  'operations.shipment.mainBank',
  'operations.shipment.secondaryBank',
  'operations.shipment.secondaryBankHint',
  'operations.shipment.sameBank',
  'operations.shipment.origin',
  'operations.shipment.destination',
  'operations.shipment.area',
  'operations.shipment.amount',
  'operations.shipment.currency',
  'operations.shipment.lines',
  'operations.shipment.addLine',
  'operations.shipment.collectionDate',
  'operations.shipment.deliveryDate',
  'operations.shipment.deliveryDateHint',
  'operations.shipment.notes',
  'operations.shipment.serialTracked',
];

/** B3 — the crew board and the roster. */
const CREW_KEYS = [
  'operations.nav.crewBoard',
  'operations.cards.crewBoard',
  'operations.nav.requirements',
  'operations.cards.requirements',
  'operations.crew.title',
  'operations.crew.subtitle',
  'operations.crew.date',
  'operations.crew.pool',
  'operations.crew.poolEmpty',
  'operations.crew.searchPool',
  'operations.crew.dropHere',
  'operations.crew.noVehicles',
  'operations.crew.noVehiclesHint',
  'operations.crew.saved',
  'operations.crew.saveCount',
  'operations.crew.saveFailed',
  'operations.crew.unsaved',
  'operations.crew.direction',
  'operations.crew.plannedTime',
  'operations.crew.role.captain',
  'operations.crew.requirements.title',
  'operations.crew.requirements.subtitle',
  'operations.crew.requirements.notAGate',
  'operations.crew.requirements.employee',
  'operations.crew.requirements.add',
  'operations.crew.requirements.added',
  'operations.crew.requirements.addFailed',
  'operations.crew.requirements.searchEmployee',
  'operations.crew.requirements.searchHint',
  'operations.crew.requirements.saveFailed',
  'operations.crew.requirements.confirmRemove',
  'operations.crew.requirements.removed',
  'operations.crew.requirements.removeFailed',
  'operations.crew.requirements.empty',
];

/** B4 — the four secured screens. */
const SECURED_KEYS = [
  'operations.nav.secured',
  'operations.cards.secured',
  'operations.nav.vaultReceive',
  'operations.cards.vaultReceive',
  'operations.nav.vaultDispatch',
  'operations.cards.vaultDispatch',
  'operations.nav.vault',
  'operations.cards.vault',
  'operations.secured.backlog.title',
  'operations.secured.backlog.subtitle',
  'operations.secured.backlog.add',
  'operations.secured.backlog.empty',
  'operations.secured.receive.title',
  'operations.secured.receive.subtitle',
  'operations.secured.receive.action',
  'operations.secured.receive.empty',
  'operations.secured.receive.receiptNumber',
  'operations.secured.receive.bags',
  'operations.secured.receive.cartons',
  'operations.secured.receive.boxes',
  'operations.secured.receive.bagSeals',
  'operations.secured.receive.boxSeals',
  'operations.secured.receive.sealsHint',
  'operations.secured.receive.primary',
  'operations.secured.receive.secondary',
  'operations.secured.receive.dualControl',
  'operations.secured.receive.sameTreasurer',
  'operations.secured.receive.done',
  'operations.secured.receive.failed',
  'operations.secured.dispatch.title',
  'operations.secured.dispatch.subtitle',
  'operations.secured.dispatch.vehicle',
  'operations.secured.dispatch.noCrew',
  'operations.secured.dispatch.pickCrew',
  'operations.secured.dispatch.assign',
  'operations.secured.dispatch.assigned',
  'operations.secured.dispatch.assignFailed',
  'operations.secured.dispatch.select',
  'operations.secured.dispatch.release',
  'operations.secured.dispatch.confirm',
  'operations.secured.dispatch.done',
  'operations.secured.dispatch.failed',
  'operations.secured.dispatch.empty',
  'operations.vault.title',
  'operations.vault.subtitle',
  'operations.vault.packages',
  'operations.vault.packageCounts',
  'operations.vault.receivedBy',
  'operations.vault.receivedAt',
  'operations.vault.empty',
];

const ALL_KEYS = [
  ...SHELL_KEYS,
  ...CATALOG_KEYS,
  ...BOARD_KEYS,
  ...CREW_KEYS,
  ...SECURED_KEYS,
];

describe('operations i18n catalogs (B1–B4)', () => {
  for (const locale of LOCALES) {
    for (const key of ALL_KEYS) {
      it(`${locale}: ${key}`, () => {
        const value = translate(locale, key);
        expect(value).not.toBe(key); // a missing key falls back to itself
        expect(value.trim()).not.toBe('');
      });
    }
  }

  it('has a tab label for every catalog kind the page can show', () => {
    for (const locale of LOCALES) {
      for (const kind of OPERATIONS_CATALOG_KINDS) {
        const key = `operations.catalogs.tab.${kind}`;
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });

  it('has a label for every shipment status and type the domain can produce', () => {
    for (const locale of LOCALES) {
      for (const status of OPERATIONS_SHIPMENT_STATUSES) {
        const key = `operations.shipment.status.${status}`;
        expect(translate(locale, key)).not.toBe(key);
      }
      for (const shipmentType of OPERATIONS_SHIPMENT_TYPES) {
        const key = `operations.shipment.type.${shipmentType}`;
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });

  it('labels every crew slot the board can render', () => {
    for (const locale of LOCALES) {
      for (const slot of CREW_SLOTS) {
        const key = `operations.crew.slot.${slot}`;
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });

  it('labels every requirement flag — an unlabelled checkbox column is unusable', () => {
    for (const locale of LOCALES) {
      for (const flag of REQUIREMENT_FLAGS) {
        const key = `operations.crew.flag.${flag}`;
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });

  it('keeps Arabic and English catalogs in step — no key exists in only one', () => {
    for (const key of ALL_KEYS) {
      expect(translate('en', key)).not.toBe(translate('ar', key));
    }
  });
});
