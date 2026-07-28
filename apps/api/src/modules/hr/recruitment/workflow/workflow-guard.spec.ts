// I13 and I1 are enforced mechanically, so they have mechanical tests: a stage service that tries
// to write a status must fail, `applyTransition` must refuse anyone without the engine's token, and
// a retired attempt must refuse every write regardless of the field.
import { describe, expect, it } from 'vitest';
import {
  LIVE_ATTEMPT_ONLY,
  WORKFLOW_ENGINE_TOKEN,
  WORKFLOW_MANAGED_FIELDS,
  assertEngineToken,
  assertNotSuperseded,
  assertNotWorkflowManaged,
} from './workflow-guard';

describe('assertNotWorkflowManaged', () => {
  it('allows a stage service to update its own domain data', () => {
    expect(() =>
      assertNotWorkflowManaged({ panel: [], location: 'Room 3', notes: 'bring CV' }, 'interview'),
    ).not.toThrow();
  });

  it('refuses a direct status write and names the engine method to use instead', () => {
    expect(() => assertNotWorkflowManaged({ status: 'completed' }, 'interview')).toThrow(
      /recruitmentWorkflowEngine\.transition\(\)/,
    );
  });

  it('refuses every workflow-managed field', () => {
    for (const field of WORKFLOW_MANAGED_FIELDS) {
      expect(() => assertNotWorkflowManaged({ [field]: 'x' }, 'evaluation'), field).toThrow();
    }
  });

  it('refuses a patch that smuggles a status alongside legitimate fields', () => {
    expect(() =>
      assertNotWorkflowManaged({ notes: 'ok', status: 'approved', files: [] }, 'evaluation'),
    ).toThrow(/status/);
  });

  it('names the entity so the failure points at the offending repository', () => {
    expect(() => assertNotWorkflowManaged({ attempt: 2 }, 'screening')).toThrow(/^screening:/);
  });

  it('lists every offending field, not just the first', () => {
    expect(() => assertNotWorkflowManaged({ status: 'sent', attempt: 2 }, 'offer')).toThrow(
      /status, attempt are owned/,
    );
  });

  it('tolerates an empty patch', () => {
    expect(() => assertNotWorkflowManaged({}, 'offer')).not.toThrow();
  });
});

describe('assertEngineToken', () => {
  it('admits the engine', () => {
    expect(() => assertEngineToken(WORKFLOW_ENGINE_TOKEN, 'interview')).not.toThrow();
  });

  it('refuses callers with no token', () => {
    expect(() => assertEngineToken(undefined, 'interview')).toThrow(/workflow engine/);
  });

  it('cannot be fooled by a look-alike symbol or string', () => {
    expect(() => assertEngineToken(Symbol('recruitment.workflow.engine'), 'offer')).toThrow();
    expect(() => assertEngineToken('recruitment.workflow.engine', 'offer')).toThrow();
    expect(() => assertEngineToken({ token: WORKFLOW_ENGINE_TOKEN }, 'offer')).toThrow();
  });
});

describe('assertNotSuperseded (I1 — a retired attempt is read-only)', () => {
  it('admits a live attempt', () => {
    expect(() => assertNotSuperseded({ supersededAt: null }, 'interview')).not.toThrow();
  });

  it('refuses a retired one, and says why rather than blaming the version', () => {
    expect(() => assertNotSuperseded({ supersededAt: new Date() }, 'interview')).toThrow(
      /superseded by a return to an earlier stage/,
    );
  });

  it('is a business-rule refusal, not a 500 — a deep link into an old round is an honest mistake', () => {
    try {
      assertNotSuperseded({ supersededAt: new Date() }, 'evaluation');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { httpStatus?: number }).httpStatus).toBe(422);
      expect((error as { expected?: boolean }).expected).toBe(true);
    }
  });

  it('names the entity so the failure points at the offending record', () => {
    expect(() => assertNotSuperseded({ supersededAt: new Date() }, 'screening')).toThrow(
      /^screening:/,
    );
  });

  it('refuses on the marker alone — the epoch is a real timestamp, not a falsy sentinel', () => {
    expect(() => assertNotSuperseded({ supersededAt: new Date(0) }, 'jobOffer')).toThrow();
  });
});

describe('LIVE_ATTEMPT_ONLY', () => {
  it('is the condition the stage repositories add to every write', () => {
    // A filter, not a pre-check: it rides inside the same atomic update as the write, so a
    // return-to-stage landing mid-request cannot be overtaken.
    expect(LIVE_ATTEMPT_ONLY).toEqual({ supersededAt: null });
  });
});
