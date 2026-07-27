// I15 — every transition publishes exactly one durable event. The load-bearing test here is the
// exhaustiveness one: a transition added to the rulebook without naming its event fails, so the
// engine can never perform a state change that consumers never hear about.
import { describe, expect, it } from 'vitest';
import {
  WorkflowEvents,
  eventForLifecycle,
  eventForMaterialization,
  eventForSupersede,
  eventForTransition,
  eventPrefixFor,
  unmappedTransitions,
  type WorkflowEventName,
} from './workflow-events';
import { timelineTypeForEvent, unmappedWorkflowEvents } from './workflow-timeline-map';
import { LIFECYCLE_EVENTS } from './workflow-lifecycle';
import { STAGE_OBJECTS, WORKFLOW_TRANSITIONS, type WorkflowObject } from './workflow-transitions';

describe('the mapping is total', () => {
  it('names an event for every transition the rulebook declares', () => {
    expect(unmappedTransitions()).toEqual([]);
  });

  it('names an event for every lifecycle event', () => {
    for (const event of LIFECYCLE_EVENTS) {
      expect(eventForLifecycle(event), event).toBeTruthy();
    }
  });

  it('publishes exactly one event per transition — never a pair', () => {
    for (const object of Object.keys(WORKFLOW_TRANSITIONS) as WorkflowObject[]) {
      for (const t of WORKFLOW_TRANSITIONS[object]) {
        const event = eventForTransition(object, t.from, t.to);
        expect(typeof event, `${object}: ${t.from}→${t.to}`).toBe('string');
      }
    }
  });

  it('returns null for a move the rulebook does not declare', () => {
    expect(eventForTransition('interview', 'completed', 'scheduled')).toBeNull();
    expect(eventForTransition('offer', 'accepted', 'draft')).toBeNull();
  });
});

describe('event names', () => {
  it('follows the ADR-008 <module>.<entity>.<event> convention', () => {
    for (const name of Object.values(WorkflowEvents)) {
      expect(name).toMatch(/^hr\.[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
    }
  });

  it('is unique per constant', () => {
    const names = Object.values(WorkflowEvents);
    expect(new Set(names).size).toBe(names.length);
  });

  it('lets a consumer subscribe to one stage by prefix', () => {
    for (const object of STAGE_OBJECTS) {
      const prefix = eventPrefixFor(object);
      const stageEvents = Object.values(WorkflowEvents).filter((n: WorkflowEventName) =>
        n.startsWith(prefix),
      );
      expect(stageEvents.length, object).toBeGreaterThan(0);
    }
  });
});

describe('the two generic facts', () => {
  it('materializing a record is stageEntered', () => {
    expect(eventForMaterialization()).toBe(WorkflowEvents.StageEntered);
  });

  it('retiring a record by a return is stageLeft', () => {
    expect(eventForSupersede()).toBe(WorkflowEvents.StageLeft);
  });

  it('keeps them out of the per-object namespaces so prefix subscriptions stay clean', () => {
    expect(WorkflowEvents.StageEntered).toMatch(/^hr\.recruitment\./);
    expect(WorkflowEvents.StageLeft).toMatch(/^hr\.recruitment\./);
  });
});

describe('shared names are the same fact, not a collision', () => {
  it('treats both reactivation paths as one event', () => {
    expect(eventForTransition('applicant', 'rejected', 'new')).toBe(
      WorkflowEvents.ApplicantReactivated,
    );
    expect(eventForTransition('applicant', 'withdrawn', 'new')).toBe(
      WorkflowEvents.ApplicantReactivated,
    );
  });

  it('treats a decision flipped either way as one redecided event', () => {
    expect(eventForTransition('evaluation', 'approved', 'rejected')).toBe(
      WorkflowEvents.EvaluationRedecided,
    );
    expect(eventForTransition('evaluation', 'rejected', 'approved')).toBe(
      WorkflowEvents.EvaluationRedecided,
    );
  });

  it('publishes the same started event whether the round was queued or scheduled', () => {
    expect(eventForTransition('interview', 'waiting', 'inProgress')).toBe(
      WorkflowEvents.InterviewStarted,
    );
    expect(eventForTransition('interview', 'scheduled', 'inProgress')).toBe(
      WorkflowEvents.InterviewStarted,
    );
  });
});

describe('offer events', () => {
  it('maps each terminal state to its own fact', () => {
    expect(eventForTransition('offer', 'sent', 'accepted')).toBe(WorkflowEvents.OfferAccepted);
    expect(eventForTransition('offer', 'sent', 'rejected')).toBe(WorkflowEvents.OfferRejected);
    expect(eventForTransition('offer', 'sent', 'expired')).toBe(WorkflowEvents.OfferExpired);
    expect(eventForTransition('offer', 'sent', 'withdrawn')).toBe(WorkflowEvents.OfferWithdrawn);
    expect(eventForTransition('offer', 'sent', 'superseded')).toBe(WorkflowEvents.OfferSuperseded);
  });

  it('calls drafting the offer OfferCreated — the first real offer fact', () => {
    expect(eventForTransition('offer', 'waiting', 'draft')).toBe(WorkflowEvents.OfferCreated);
  });
});

describe('timeline projection coverage (I5)', () => {
  it('names a timeline entry type for every published event', () => {
    // An unmapped event still lands on the timeline — as a generic `note`. That is worse than a
    // crash: the candidate's history shows a blank line where a real fact happened, and nothing
    // fails. Adding an event without naming its entry must fail here instead.
    expect(unmappedWorkflowEvents()).toEqual([]);
  });

  it('distinguishes a lifecycle closure from a decision', () => {
    expect(timelineTypeForEvent(WorkflowEvents.ScreeningCancelled)).toBe('screeningCancelled');
    expect(timelineTypeForEvent(WorkflowEvents.ScreeningRejected)).toBe('screeningDecided');
    expect(timelineTypeForEvent(WorkflowEvents.EvaluationCancelled)).toBe('evaluationCancelled');
    expect(timelineTypeForEvent(WorkflowEvents.EvaluationRejected)).toBe('evaluationDecided');
  });
});
