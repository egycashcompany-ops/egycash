// The catalogs' "search" box, as a Mongo condition that matches the TEXT the operator typed.
//
// Every catalog list used to hand `search` straight to `$regex`, so the typed text was read as a
// pattern: "(" made Mongo reject the query and the request failed with a 500, and "." or "+"
// matched things the operator never typed. That was tolerable while only an admin typed into the
// catalogs screen; the shipment form now filters branches as the operator types a name, so any
// branch name with a bracket or a dot would break the picker at the moment it is needed.
//
// Escaping turns the text back into a literal. Case-insensitivity stays, as before.

/** Every character `RegExp` treats as syntax, so it can be matched as itself. */
const REGEX_SYNTAX = /[.*+?^${}()|[\]\\]/g;

export const escapeRegExp = (text: string): string => text.replace(REGEX_SYNTAX, '\\$&');

/** `{ $regex, $options: 'i' }` matching `text` literally, anywhere in the field. */
export const containsText = (text: string): { $regex: string; $options: 'i' } => ({
  $regex: escapeRegExp(text),
  $options: 'i',
});
