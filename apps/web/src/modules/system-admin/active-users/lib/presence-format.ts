// How the active users page writes a length of time: «3 س 25 د» / "3h 25m".
//
// Compact on purpose — it sits in a table column beside other figures — and never «0 س»: under an
// hour reads as minutes alone.

/** The two figures a duration is written with. */
export const hoursAndMinutes = (minutes: number): { h: number; m: number } => {
  const whole = Math.max(0, Math.floor(minutes));
  return { h: Math.floor(whole / 60), m: whole % 60 };
};

/** Minutes between two instants, never negative. */
export const minutesBetween = (from: string, now: number): number =>
  Math.max(0, Math.floor((now - Date.parse(from)) / 60_000));
