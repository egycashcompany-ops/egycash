// Which screen a crew-plan piece is drawn on — «لوحة التشغيلة» (a DAY's plan) or «الطاقم الثابت» (the
// dateless list each day is seeded from, Round 27: «عاوزك تخلى شاشة الطاقم الثابت نفس شكل لوحة التشغيل»).
//
// The two screens share every piece — the chips, the pools, a slot's list, the person's card, the
// van's card — and differ in two things only, both facts about a DAY:
//   · the WORDS that name the screen: a chip on the board is «في التشغيلة», on the standing crew «في
//     الطاقم الثابت»; dropping it on a pool takes it off the one or the other (`scopedKey`);
//   · the DAY'S FACTS: his attendance on the day (HR's absent / on leave) and the van's drivers (the
//     Fleet roster of the day). A dateless list has neither, so its cards leave both lines out
//     rather than say «no absence on record» or «—» about a day nobody chose.
// The board needs no provider: the default is the board, so nothing it draws changes.
import { createContext, useContext } from 'react';

export type CrewPlanScope = 'board' | 'standing';

const ScopeContext = createContext<CrewPlanScope>('board');

/** Wrap a screen's crew-plan pieces: «الطاقم الثابت» passes `standing`. */
export const CrewPlanScopeProvider = ScopeContext.Provider;

export const useCrewPlanScope = (): CrewPlanScope => useContext(ScopeContext);

/** Does this screen show the facts of a day — attendance, the van's drivers? Only the board. */
export const showsDayFacts = (scope: CrewPlanScope): boolean => scope === 'board';

/**
 * The words that name the board («التشغيلة»), said of the standing crew on its own screen. Every
 * other key is the board's own, shared as it is.
 */
const STANDING_WORDS: Readonly<Record<string, string>> = {
  'operations.crewPlan.card.seat': 'operations.standingCrew.plan.card.seat',
  'operations.crewPlan.card.unseated': 'operations.standingCrew.plan.card.unseated',
  'operations.crewPlan.pools.dropBack': 'operations.standingCrew.plan.pools.dropBack',
  'operations.crewPlan.pools.returnPicked': 'operations.standingCrew.plan.pools.returnPicked',
  'operations.crewPlan.picker.section.seated': 'operations.standingCrew.plan.picker.seated',
};

/** The key a shared piece asks for on this screen. */
export const scopedKey = (scope: CrewPlanScope, key: string): string =>
  scope === 'standing' ? (STANDING_WORDS[key] ?? key) : key;

/** Every key the standing crew says in the board's place — for the i18n spec. */
export const STANDING_WORD_KEYS: readonly string[] = Object.values(STANDING_WORDS);
