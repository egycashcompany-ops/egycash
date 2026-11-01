// An uploaded file's name as the person named it.
//
// Multer reads a multipart `filename` as latin1 by default, so an Arabic name («صفحة 1.png»)
// arrives as its UTF-8 bytes spelled one latin1 character each («ØµÙØ­Ø© 1.png»). This turns it
// back — the ATM register import's rule (`register-import.controller.ts`), shared by the fleet
// uploads. It never makes a name worse: a name that does not decode cleanly is kept as it came.

/** The original file name, decoded from latin1 to UTF-8 when that is what it is; '' when none. */
export const uploadFileName = (raw: string | undefined): string => {
  if (raw === undefined || raw === '') return '';
  // A character past latin1 means the name already arrived decoded — nothing to undo.
  for (const char of raw) {
    if ((char.codePointAt(0) ?? 0) > 0xff) return raw;
  }
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? raw : decoded;
};
