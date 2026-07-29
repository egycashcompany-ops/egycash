// The event catalogue (A-2).
//
// The catalogue's only real failure mode is DRIFT — describing a payload that is not the payload
// that gets emitted. So the tests here are almost entirely about the catalogue agreeing with the
// Zod schemas rather than about any particular field: every event is registered, every generated
// sample actually parses against its own schema, and every name resolves to real vocabulary.
// Those three, held together, are what make it safe to build a trigger picker on top of this.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EVENT_CATALOG,
  HR_EVENT_PAYLOAD_SCHEMAS,
  PLATFORM_EVENT_PAYLOAD_SCHEMAS,
  buildEventCatalog,
  eventCatalogEntry,
  eventCatalogNames,
  isCatalogedEventName,
  isFullyLocalized,
} from './catalog.js';
import { EVENT_SCHEMA_VERSIONS, PlatformEvents } from './index.js';
import { HrEvents } from '../modules/hr-recruitment.js';
import { HrEmployeeEvents } from '../modules/hr-employee.js';
import { HrLeaveEvents } from '../modules/hr-leave.js';
import { HrContractEvents } from '../modules/hr-contract.js';
import { HrOfferEvents } from '../modules/hr-job-offer.js';
import { HrInterviewEvents } from '../modules/hr-interview.js';
import { HrScreeningEvents } from '../modules/hr-screening.js';
import { HrEvaluationEvents } from '../modules/hr-evaluation.js';
import { HrEvaluationBatchEvents } from '../modules/hr-evaluation-batch.js';
import { HrEmployeeFileEvents } from '../modules/hr-employee-file.js';
import { HrHiringDocumentsEvents } from '../modules/hr-hiring-documents.js';
import { HrRecruitmentWorkflowEvents } from '../modules/hr-recruitment-workflow.js';

const HR_EVENT_CONSTANTS = [
  HrEvents,
  HrRecruitmentWorkflowEvents,
  HrScreeningEvents,
  HrInterviewEvents,
  HrEvaluationEvents,
  HrEvaluationBatchEvents,
  HrOfferEvents,
  HrEmployeeEvents,
  HrEmployeeFileEvents,
  HrHiringDocumentsEvents,
  HrLeaveEvents,
  HrContractEvents,
].flatMap((group) => Object.values(group));

const ALL_SCHEMAS: Record<string, z.ZodTypeAny | null> = {
  ...PLATFORM_EVENT_PAYLOAD_SCHEMAS,
  ...HR_EVENT_PAYLOAD_SCHEMAS,
};

// ── Coverage: nothing emitted is missing, nothing catalogued is invented ─────

describe('coverage', () => {
  it('catalogues every platform event', () => {
    // The compiler already enforces this (`Record<PlatformEventName, …>`); the runtime check
    // catches the case where somebody widens the type to make an omission compile.
    for (const name of Object.values(PlatformEvents)) {
      expect(isCatalogedEventName(name), `${name} is not catalogued`).toBe(true);
    }
  });

  it('catalogues every HR event', () => {
    for (const name of HR_EVENT_CONSTANTS) {
      expect(isCatalogedEventName(name), `${name} is not catalogued`).toBe(true);
    }
  });

  it('invents nothing — every catalogued name is a declared event constant', () => {
    // An automation may only subscribe to what a publisher emits. A name in the catalogue that
    // no module declares would be a trigger that can never fire, and the workflow built on it
    // would sit enabled and silent forever.
    const declared = new Set<string>([...Object.values(PlatformEvents), ...HR_EVENT_CONSTANTS]);
    for (const name of eventCatalogNames()) {
      expect(declared.has(name), `${name} is catalogued but declared nowhere`).toBe(true);
    }
  });

  it('has no duplicate names', () => {
    const names = eventCatalogNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('is sorted by name, so the API response is stable across deploys', () => {
    const names = eventCatalogNames();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

// ── The anti-drift guarantee ────────────────────────────────────────────────

describe('generated content matches the schemas', () => {
  it('produces a sample that parses against the event′s own payload schema', () => {
    // This is the load-bearing test. The sample is built by walking the schema, so if the walker
    // ever gets a type wrong — or a publisher adds a constraint the walker cannot satisfy — the
    // sample stops parsing and this fails, instead of the UI quietly showing a bad example.
    for (const entry of EVENT_CATALOG) {
      const schema = ALL_SCHEMAS[entry.name];
      if (schema === null || schema === undefined) continue;
      const parsed = schema.safeParse(entry.sample);
      expect(parsed.success, `${entry.name}: ${JSON.stringify(entry.sample)}`).toBe(true);
    }
  });

  it('describes at least one field for every event that declares a payload', () => {
    for (const entry of EVENT_CATALOG) {
      if (!entry.payloadDeclared) continue;
      expect(entry.fields.length, `${entry.name} has no fields`).toBeGreaterThan(0);
    }
  });

  it('reports optional, nullable and enum exactly as the schema declares them', () => {
    const file = eventCatalogEntry('platform.file.uploaded');
    expect(file?.fields.find((f) => f.path === 'fileId')).toMatchObject({
      type: 'string',
      optional: false,
      nullable: false,
    });
    // `categoryId` is `.optional()` — a filter on it has to tolerate absence.
    expect(file?.fields.find((f) => f.path === 'categoryId')?.optional).toBe(true);

    const employee = eventCatalogEntry('hr.employee.created');
    // `.nullable()` is NOT the same as optional, and conflating them makes a filter wrong.
    expect(employee?.fields.find((f) => f.path === 'applicantId')).toMatchObject({
      optional: false,
      nullable: true,
    });

    const decided = eventCatalogEntry('hr.leave.decided');
    const decision = decided?.fields.find((f) => f.path === 'decision');
    expect(decision?.type).toBe('enum');
    expect(decision?.values).toEqual(['approved', 'rejected']);
  });

  it('flattens nested objects into dot paths a filter can address', () => {
    const paths = eventCatalogEntry('platform.file.uploaded')?.fields.map((f) => f.path) ?? [];
    expect(paths).toContain('entityRef');
    expect(paths).toContain('entityRef.moduleId');
  });

  it('renders dates as ISO strings, because that is what arrives over the wire', () => {
    const sample = eventCatalogEntry('hr.leave.requested')?.sample as { startDate: unknown };
    expect(typeof sample.startDate).toBe('string');
  });

  it('carries the declared schema version', () => {
    expect(eventCatalogEntry('platform.user.created')?.schemaVersion).toBe(
      EVENT_SCHEMA_VERSIONS[PlatformEvents.UserCreated],
    );
    // Module sources default to 1 — every declared payload today is a `…V1`.
    expect(eventCatalogEntry('hr.employee.created')?.schemaVersion).toBe(1);
  });
});

// ── Labels ──────────────────────────────────────────────────────────────────

describe('localization', () => {
  it('resolves every event to real vocabulary in both languages', () => {
    // The lexicon is what makes labels generated rather than hand-written. When a new event
    // introduces a word nobody has translated, THIS is what says so — otherwise the Arabic UI
    // silently starts showing English identifiers.
    const unresolved = EVENT_CATALOG.filter((entry) => !isFullyLocalized(entry.name));
    expect(unresolved.map((e) => e.name)).toEqual([]);
  });

  it('gives both languages a non-empty label and module name', () => {
    for (const entry of EVENT_CATALOG) {
      expect(entry.label.en.length, entry.name).toBeGreaterThan(0);
      expect(entry.label.ar.length, entry.name).toBeGreaterThan(0);
      expect(entry.moduleName.ar.length, entry.name).toBeGreaterThan(0);
    }
  });

  it('composes English as <entity> <action> and Arabic as <action> <entity>', () => {
    expect(eventCatalogEntry('hr.employee.created')?.label).toEqual({
      en: 'Employee created',
      ar: 'إنشاء موظف',
    });
  });

  it('uses the written-out label where the name does not decompose into prose', () => {
    // `platform.auth.loggedIn` would compose to "Authentication logged in".
    expect(eventCatalogEntry('platform.auth.loggedIn')?.label.en).toBe('Sign-in succeeded');
  });

  it('splits the name into module, entity and action', () => {
    expect(eventCatalogEntry('hr.leave.balanceAdjusted')).toMatchObject({
      moduleId: 'hr',
      entity: 'leave',
      action: 'balanceAdjusted',
    });
  });
});

// ── The builder itself ──────────────────────────────────────────────────────

describe('buildEventCatalog', () => {
  it('degrades instead of throwing when a module declares no payload schema', () => {
    // A module can ship an event before it ships a payload contract. Saying "no fields declared"
    // is honest; inventing a field list would not be, and refusing to build would take the whole
    // trigger picker down over one module's omission.
    const [entry] = buildEventCatalog({ moduleId: 'fleet', schemas: { 'fleet.vehicle.assigned': null } });
    expect(entry?.payloadDeclared).toBe(false);
    expect(entry?.fields).toEqual([]);
    expect(entry?.sample).toBeNull();
  });

  it('falls back to a humanised label for vocabulary it does not know', () => {
    const [entry] = buildEventCatalog({
      moduleId: 'fleet',
      schemas: { 'fleet.vehicle.returnedToDepot': null },
    });
    expect(entry?.label.en).toBe('Vehicle returned to depot');
    expect(isFullyLocalized('fleet.vehicle.returnedToDepot')).toBe(false);
  });

  it('honours a per-event schema version', () => {
    const [entry] = buildEventCatalog({
      moduleId: 'fleet',
      schemas: { 'fleet.vehicle.assigned': z.object({ vehicleId: z.string() }) },
      versions: { 'fleet.vehicle.assigned': 3 },
    });
    expect(entry?.schemaVersion).toBe(3);
  });

  it('merges sources and keeps the result sorted', () => {
    const merged = buildEventCatalog(
      { moduleId: 'z', schemas: { 'z.a.created': null } },
      { moduleId: 'a', schemas: { 'a.a.created': null } },
    );
    expect(merged.map((e) => e.name)).toEqual(['a.a.created', 'z.a.created']);
  });

  it('walks arrays of objects into `field[].child` paths', () => {
    const [entry] = buildEventCatalog({
      moduleId: 'x',
      schemas: {
        'x.y.created': z.object({ lines: z.array(z.object({ sku: z.string(), qty: z.number() })) }),
      },
    });
    expect(entry?.fields.map((f) => f.path)).toEqual(['lines', 'lines[].sku', 'lines[].qty']);
  });
});

// ── Provider independence ───────────────────────────────────────────────────

describe('the catalogue is a platform surface', () => {
  it('mentions no automation provider anywhere in its output', () => {
    // The catalogue predates the automation engine conceptually and must outlive any provider
    // choice: it describes what ECMS emits, not what any runtime consumes.
    expect(JSON.stringify(EVENT_CATALOG)).not.toMatch(/n8n|temporal|camunda|zapier/i);
  });
});
