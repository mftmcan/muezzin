import { toTurkishUpperCase, toTurkishLowerCase } from './dateUtils';

/**
 * Metindeki kelimelerin ilk harflerini büyük, diğerlerini küçük yapar (Türkçe uyumlu).
 */
export const formatName = (text: string) => {
  if (!text) return '';
  return text
    .split(' ')
    .map((word) => {
      if (word.length === 0) return '';
      return toTurkishUpperCase(word.charAt(0)) + toTurkishLowerCase(word.slice(1));
    })
    .join(' ');
};
