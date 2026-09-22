/**
 * WHICH LICENCE CLASSES PUT A CAR ON THE LICENSING BOARD — the whole membership rule, in one
 * pure function so it can be read and tested without a database behind it.
 *
 * «العربيات اللى بتيجى من خانه الترخيص ويكون اخرها ت مثلا برقاش ت ... لكن اللى برقاش م متبقاش
 * موجوده». The licence classes are an ADMIN-OWNED vocabulary («برقاش ت», «برقاش م», «العجوزة ت»,
 * «العجوزة م»), so the rule has to be about the name rather than about a flag no admin knows to
 * set — and it has to keep working the day somebody adds a fifth office.
 *
 * THE LAST WORD, not the last letter. «اخرها ت» is a word: a class named «بيت» ends with the
 * letter ت and is not a licensing class, and matching the letter alone would put it on the board
 * with nothing to explain why.
 */
export type FleetLicensingSuffix = 'ت' | 'م';

const lastWord = (name: string): string => {
  const words = name.trim().split(/\s+/u);
  return words[words.length - 1] ?? '';
};

/** `'ت'`, `'م'`, or null for a class that is neither — which is not on this board either. */
export const licensingSuffix = (name: string | null | undefined): FleetLicensingSuffix | null => {
  if (typeof name !== 'string') return null;
  const word = lastWord(name);
  return word === 'ت' || word === 'م' ? word : null;
};

/** On the board. The ONE question the service asks of a class, asked in one place. */
export const isLicensingClass = (name: string | null | undefined): boolean =>
  licensingSuffix(name) === 'ت';
