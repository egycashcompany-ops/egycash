// Architecture guards for P-HR-REQ, read off the source.
//
// These pin the three promises the design makes that no runtime test can observe, because each is
// about what the code DOES NOT do: it does not resurrect the entity P-ORG-1 removed, it does not
// model a headcount nobody authorized, and it does not write back into the recruitment workflow.
//
// Widen them by NAMING a new file or a new word — never by loosening a pattern.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');

/** Prose explains what was removed; only CODE may not name it. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const FEATURE_FILES = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const FEATURE_CODE = FEATURE_FILES.map((f) => code(read(f))).join('\n');

const MODULE = code(readFileSync(resolve(HERE, '../../hr.module.ts'), 'utf8'));

describe('ADR-030 — no vacancy comes back', () => {
  it('names no seat, vacancy or position anywhere in the feature code', () => {
    for (const word of ['jobPosition', 'JobPosition', 'vacancy', 'Vacancy', 'seatId']) {
      expect(FEATURE_CODE).not.toContain(word);
    }
  });

  it('carries the placement itself — the four fields, on the requisition', () => {
    const model = code(read('./job-requisition.model.ts'));
    for (const field of ['jobTitleId', 'departmentId', 'branchId', 'sectionId']) {
      expect(model).toContain(field);
    }
  });
});

describe('D-REQ-8 — headcount and budget are not modelled', () => {
  it('no field, type or query mentions either', () => {
    for (const word of ['headcount', 'Headcount', 'budget', 'Budget', 'authorized', 'establishment']) {
      expect(FEATURE_CODE).not.toContain(word);
    }
  });
});

describe('I15 — the requisition listens, it does not write workflow state', () => {
  it('imports nothing from the workflow engine', () => {
    for (const forbidden of ['workflow-engine', 'workflowEngine', 'workflow-transitions', 'workflowService']) {
      expect(FEATURE_CODE).not.toContain(forbidden);
    }
  });

  it('subscribes to the hire event rather than causing one', () => {
    expect(MODULE).toContain("event: 'hr.applicant.hired'");
    expect(MODULE).toContain('recordHireAgainstRequisition');
    // …and publishes only its own facts.
    expect(FEATURE_CODE).not.toContain("emit('hr.applicant");
  });
});

describe('D-REQ-14 — both scope axes are declared', () => {
  it('the repository declares departmentField as well as branchField', () => {
    const repository = code(read('./job-requisition.repository.ts'));
    expect(repository).toContain("branchField: 'branchId'");
    expect(repository).toContain("departmentField: 'departmentId'");
  });
});

describe('D-REQ-13 — fulfilment is counted, never incremented', () => {
  it('the link collection carries the unique index that makes replay a no-op', () => {
    const fill = code(read('./job-requisition-fill.model.ts'));
    expect(fill).toContain('requisitionId: 1, applicantId: 1');
    expect(fill).toContain('unique: true');
  });

  it('the count is not a stored field, and nothing increments one', () => {
    // The model is where a counter would have to live to drift; the service passes the COUNTED
    // value around, which is exactly what it should do.
    expect(code(read('./job-requisition.model.ts'))).not.toContain('filledCount');
    const service = code(read('./job-requisition.service.ts'));
    expect(service).not.toContain('$inc: { filled');
    expect(service).toContain('countFills');
  });
});

describe('ADR-030 — closed is final', () => {
  it('the feature exposes no reopen verb', () => {
    for (const word of ['reopen', 'Reopen', 'unclose']) {
      expect(FEATURE_CODE).not.toContain(word);
    }
    const routes = code(read('./job-requisition.routes.ts'));
    expect(routes).not.toContain('reopen');
  });
});

describe('D-REQ-12 — closing needs no key of its own', () => {
  it('the module declares five keys and no `close` action', () => {
    expect(MODULE).toContain("'jobRequisition',");
    expect(MODULE).toContain("action: 'approve',");
    expect(MODULE).not.toContain("action: 'closeRequisition'");
    const routes = code(read('./job-requisition.routes.ts'));
    expect(routes).toContain("authorize('jobRequisition.approve')");
    expect(routes).not.toContain("authorize('jobRequisition.close')");
  });

  it('the decision route is NOT gated on approve — the manager step is a relationship', () => {
    const routes = code(read('./job-requisition.routes.ts'));
    const decision = routes.slice(routes.indexOf("'/:id/decision'"));
    const block = decision.slice(0, decision.indexOf('asyncHandler'));
    expect(block).toContain("authorize('jobRequisition.view')");
    expect(block).not.toContain("authorize('jobRequisition.approve')");
  });
});

describe('the collections are declared to the platform', () => {
  it('both of them, with the module prefix', () => {
    expect(MODULE).toContain("'hr_job_requisitions'");
    expect(MODULE).toContain("'hr_job_requisition_fills'");
  });
});

describe('the seam is wired, not bypassed', () => {
  it('the module registers the real validator', () => {
    expect(MODULE).toContain('setRequisitionValidator(jobRequisitionReferenceValidator)');
  });

  it('the applicants feature still does not import this one', () => {
    const applicants = join(HERE, '..', 'applicants');
    const sources = readdirSync(applicants)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .map((f) => readFileSync(join(applicants, f), 'utf8'));
    for (const source of sources) {
      expect(code(source)).not.toContain('job-requisitions');
    }
  });
});
