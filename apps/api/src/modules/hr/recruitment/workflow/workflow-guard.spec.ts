// I13 is enforced mechanically, so it has mechanical tests: a stage service that tries to write a
// status must fail, and `applyTransition` must refuse anyone without the engine's token.
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_ENGINE_TOKEN,
  WORKFLOW_MANAGED_FIELDS,
  assertEngineToken,
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
