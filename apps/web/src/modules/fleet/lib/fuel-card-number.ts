// «خلى ارقام الفيزا كل 4 جمب بعض»: a card number is read in groups of four — «5485 6400 0643 6766».
// Shown that way everywhere; stored, copied and exported as the bare digits.

/** The digits of a card number in groups of four, whatever spacing it came with. */
export const groupCardNumber = (number: string): string =>
  number.replace(/\s+/gu, '').replace(/(\d{4})(?=\d)/gu, '$1 ');

/** The bare digits a grouped number stands for. */
export const ungroupCardNumber = (shown: string): string => shown.replace(/\s+/gu, '');
