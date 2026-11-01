// Saving what the review shows, like the company's Readers page: each side of the card as read, the
// holder's photo, and the reviewed values. Everything is built in the browser from what is already
// on screen — nothing is sent anywhere or stored by ECMS.

/** The file-name stem: the national ID when it is a full 14-digit number, else a generic name. */
export const fileStem = (nationalId: string): string =>
  /^\d{14}$/.test(nationalId) ? `national-id-${nationalId}` : 'national-id';

/** Starts a download of `href` (a data or object URL) as `name`. */
export const saveUrl = (href: string, name: string): void => {
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
};

const cell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * Two columns, one row per field. A UTF-8 byte-order mark leads the file so Excel shows Arabic
 * correctly; a leading `=`, `+`, `-` or `@` is quoted away so no value runs as a formula.
 */
export const toCsv = (rows: readonly (readonly [string, string])[]): string =>
  String.fromCharCode(0xfeff) +
  rows.map((row) => row.map((v) => cell(/^[=+\-@]/.test(v) ? `'${v}` : v)).join(',')).join('\r\n');

/** Saves `rows` as a CSV file named `name`. */
export const saveCsv = (rows: readonly (readonly [string, string])[], name: string): void => {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  saveUrl(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
