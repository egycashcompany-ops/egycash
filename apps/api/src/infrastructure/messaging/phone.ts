// The one phone-number rule both text transports (whatsapp.ts, sms.ts) send to. Moved here from
// whatsapp.ts when SMS joined it — `whatsapp.ts` still re-exports it, so nothing that imported it
// from there had to change.

/** Normalize a local Egyptian mobile (01xxxxxxxxx) or an already-international number to E.164. */
export const toE164 = (phone: string): string | null => {
  const digits = phone.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^00\d{8,15}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^01\d{9}$/.test(digits)) return `+2${digits}`;
  if (/^\d{8,15}$/.test(digits)) return `+${digits}`;
  return null;
};
