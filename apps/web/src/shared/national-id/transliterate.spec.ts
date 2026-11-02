import { describe, expect, it } from 'vitest';
import { transliterateArabicName } from './transliterate';

describe('transliterateArabicName', () => {
  it('spells common Egyptian names the way Egyptian records do', () => {
    expect(transliterateArabicName('كريم محمد رضوان الحديدى عبده')).toBe(
      'Karim Mohamed Radwan Elhadidy Abdo',
    );
    expect(transliterateArabicName('سلمى محمد رضوان الحديدى عبده')).toBe(
      'Salma Mohamed Radwan Elhadidy Abdo',
    );
    expect(transliterateArabicName('أحمد علي حسن إبراهيم')).toBe('Ahmed Ali Hassan Ibrahim');
  });

  it('writes the فاعل-shaped names with an e, as records do', () => {
    expect(transliterateArabicName('حسن علي محمد فارس')).toBe('Hassan Ali Mohamed Fares');
    expect(transliterateArabicName('ماهر عامر هاشم طاهر')).toBe('Maher Amer Hashem Taher');
    expect(transliterateArabicName('جاسر فاضل ناجح حاكم')).toBe('Gasser Fadel Nageh Hakem');
  });

  it('handles short given names', () => {
    expect(transliterateArabicName('مي سامح بدوى محمد')).toBe('Mai Sameh Badawy Mohamed');
    expect(transliterateArabicName('علي فؤاد سمير عطية')).toBe('Ali Fouad Samir Attia');
    expect(transliterateArabicName('نور عمر عز هند')).toBe('Nour Omar Ezz Hend');
  });

  it('treats ة/ه and ى/ي endings alike', () => {
    expect(transliterateArabicName('هبه')).toBe('Heba');
    expect(transliterateArabicName('هبة')).toBe('Heba');
    expect(transliterateArabicName('مصطفي')).toBe('Mostafa');
    expect(transliterateArabicName('يحيي')).toBe('Yehia');
  });

  it("joins 'عبد' with what it governs, written apart or fused", () => {
    expect(transliterateArabicName('عبد الرحمن محمد')).toBe('Abdelrahman Mohamed');
    expect(transliterateArabicName('عبدالرحمن محمد')).toBe('Abdelrahman Mohamed');
    expect(transliterateArabicName('محمد عبد الله')).toBe('Mohamed Abdallah');
    expect(transliterateArabicName('عبد ربه')).toBe('Abdrabo');
    expect(transliterateArabicName('عبد الفتاح السيسي')).toBe('Abdelfattah Elsisy');
  });

  it("joins 'أبو' with the following name", () => {
    expect(transliterateArabicName('أبو بكر')).toBe('Abobakr');
    expect(transliterateArabicName('محمد أبو زيد')).toBe('Mohamed Abouzeid');
  });

  it("writes the article as 'El' on unknown family names", () => {
    expect(transliterateArabicName('محمد الشناوي')).toMatch(/^Mohamed Elsh/);
  });

  it('infers short vowels for names outside the dictionary', () => {
    // Not perfect, but readable — never vowel-less like the old 'Hsn'.
    const out = transliterateArabicName('جمعة');
    expect(out).toMatch(/[aeiou]/i);
    expect(out.charAt(0)).toBe('G');
  });

  it('strips diacritics and stray characters', () => {
    expect(transliterateArabicName('مُحَمَّد  أحْمَد')).toBe('Mohamed Ahmed');
    expect(transliterateArabicName('محمد - أحمد.')).toBe('Mohamed Ahmed');
  });

  it("returns '' when there is nothing Arabic to transliterate", () => {
    expect(transliterateArabicName('')).toBe('');
    expect(transliterateArabicName('Mohamed')).toBe('');
  });
});
