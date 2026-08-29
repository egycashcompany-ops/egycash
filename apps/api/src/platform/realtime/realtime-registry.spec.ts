// The completeness guard (ADR-029): a mutation whose audit entity nobody classified must fail
// CI, not ship as a screen that silently never updates. It walks the real source tree, collects
// every (moduleId, entityType) the audit trail records, and holds the registry to it — both
// directions — then holds every named permission to the platform's assembled permission registry.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { platformPermissions } from '@ecms/contracts';
import { moduleManifests } from '../../modules';
// Imported directly because `moduleManifests` carries it only when AUTOMATION_ENABLED: its
// permission keys exist either way, and with the flag off nobody holds them — so the topics
// mapped to them simply have empty rooms, which is the correct off behaviour.
import { automationModule } from '../../modules/automation/automation.module';
import { REALTIME_EXCLUDED_ENTITIES, REALTIME_TOPICS } from './realtime-registry';

const SRC_ROOT = join(__dirname, '..', '..');

/**
 * Entity types recorded through a variable rather than a literal, so the scan below cannot see
 * them. Each is pinned here BY VALUE next to where the value comes from; the dynamic-site count
 * is asserted separately, so adding a sixth dynamic call site fails this spec until it is
 * classified too.
 */
const DYNAMIC_ENTITY_KEYS = [
  'hr.employeeLoanAttachment', // employee-loan.files.ts LOAN_ATTACHMENT_ENTITY_TYPE
  'hr.employeeActionAttachment', // contracts hr-employee-actions EMPLOYEE_ACTION_ATTACHMENT_ENTITY_TYPE
  'hr.payrollAdjustmentAttachment', // payroll-adjustment.files.ts ADJUSTMENT_ATTACHMENT_ENTITY_TYPE
  'platform.section', // org-unit.ts `this.entityType` — branch/department literals exist elsewhere
  'hr.applicantDocuments', // applicant-document.files.ts APPLICANT_DOCUMENT_ENTITY_TYPE
  'hr.trainingRecord', // training-record.files.ts TRAINING_RECORD_ENTITY_TYPE
  'hr.medicalEvent', // medical-event.files.ts MEDICAL_EVENT_ENTITY_TYPE
];
// P-HR-APP phase 3 adds TWO sites for one entity, both in `applicant-document.service.ts`: the
// audit ref and the file's owning ref, each reaching for the same shared constant rather than
// retyping the string. That is the trade this count exists to make visible — one more name here in
// exchange for one place to change the entity type.
// P-HR-TRN T4 adds ONE site: a training certificate is filed against the RECORD it certifies, and
// the service reaches for the shared constant rather than retyping the entity type beside it.
// P-HR-MED M3 adds ONE site: a medical certificate is filed against the EVENT it documents, and
// the service reaches for the shared constant rather than retyping the entity type beside it.
const EXPECTED_DYNAMIC_SITES = 9; // the seven above + workflow-consumers relaying hr event refs

const collectSources = (dir: string, files: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectSources(path, files);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(path);
  }
  return files;
};

const LITERAL_PAIR =
  /moduleId:\s*'([a-zA-Z]+)'\s*,\s*entityType:\s*'([a-zA-Z]+)'|entityType:\s*'([a-zA-Z]+)'\s*,\s*moduleId:\s*'([a-zA-Z]+)'/g;
const DYNAMIC_PAIR = /moduleId:\s*'[a-zA-Z]+'\s*,\s*entityType:\s*(?!')[a-zA-Z_.[\]]+/g;

const scan = (): { literals: Set<string>; dynamicSites: string[] } => {
  const literals = new Set<string>();
  const dynamicSites: string[] = [];
  for (const file of collectSources(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(LITERAL_PAIR)) {
      literals.add(`${match[1] ?? match[4]}.${match[2] ?? match[3]}`);
    }
    dynamicSites.push(...[...source.matchAll(DYNAMIC_PAIR)].map(() => file));
  }
  return { literals, dynamicSites };
};

const { literals, dynamicSites } = scan();
const classified = new Set([
  ...Object.keys(REALTIME_TOPICS),
  ...Object.keys(REALTIME_EXCLUDED_ENTITIES),
]);

describe('realtime registry completeness', () => {
  it('classifies every audited entity the source records', () => {
    const unclassified = [...literals].filter((key) => !classified.has(key)).sort();
    // A name here means: add it to REALTIME_TOPICS with its view permission, or to
    // REALTIME_EXCLUDED_ENTITIES with the reason it has no screen to refresh.
    expect(unclassified).toEqual([]);
  });

  it('carries no entry the source no longer records', () => {
    const known = new Set([...literals, ...DYNAMIC_ENTITY_KEYS]);
    const stale = [...classified].filter((key) => !known.has(key)).sort();
    expect(stale).toEqual([]);
  });

  it('pins the dynamic call sites so a new one must come here to be classified', () => {
    expect(dynamicSites).toHaveLength(EXPECTED_DYNAMIC_SITES);
  });

  it('names only permissions this platform declares', () => {
    const registry = new Set(
      [
        ...platformPermissions,
        ...moduleManifests.flatMap((m) => m.permissions),
        ...automationModule.permissions,
      ].map((p) => p.key),
    );
    const phantom = Object.entries(REALTIME_TOPICS)
      .filter(([, def]) => !registry.has(def.permission))
      .map(([key, def]) => `${key} → ${def.permission}`);
    expect(phantom).toEqual([]);
  });

  it('keeps every excluded entity excluded for a stated reason', () => {
    for (const reason of Object.values(REALTIME_EXCLUDED_ENTITIES)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
