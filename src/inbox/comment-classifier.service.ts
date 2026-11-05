// comments/comment-classifier.service.ts
import { Injectable } from '@nestjs/common';

export type CommentKind = 'engagement' | 'inquiry' | 'unsure';
export interface Classification {
  type: CommentKind;
  reason: string;
}

/** Lowercase, strip Arabic diacritics and tatweel, unify letter variants. */
const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)); // Arabic-Indic digits

const list = (words: string[]) => words.map(normalize);

// Phrases that signal a question or a request, matched as whole words/phrases
const INQUIRY_WORDS = list([
  // English
  'price',
  'how much',
  'cost',
  'available',
  'availability',
  'how',
  'where',
  'when',
  'what',
  'which',
  'who',
  'do you',
  'can i',
  'can you',
  'is it',
  'are there',
  'location',
  'address',
  'delivery',
  'deliver',
  'shipping',
  'order',
  'book',
  'booking',
  'reserve',
  'details',
  'info',
  'dm',
  'inbox',
  'number',
  'phone',
  'whatsapp',
  'size',
  'colors',
  'open',
  'hours',
  // Arabic (Egyptian dialect included)
  'بكام',
  'كام',
  'سعر',
  'السعر',
  'اسعار',
  'الاسعار',
  'تكلفه',
  'ازاي',
  'كيف',
  'فين',
  'وين',
  'عنوان',
  'العنوان',
  'لوكيشن',
  'متاح',
  'متوفر',
  'موجود',
  'توصيل',
  'بتوصلوا',
  'شحن',
  'تفاصيل',
  'معلومات',
  'رقم',
  'تليفون',
  'واتساب',
  'خاص',
  'ع الخاص',
  'ممكن',
  'عايز',
  'عاوز',
  'عاوزه',
  'عايزه',
  'محتاج',
  'حجز',
  'احجز',
  'اطلب',
  'طلب',
  'مواعيد',
  'ميعاد',
  'بتفتحوا',
  'مقاس',
  'مقاسات',
  'الوان',
  'هل',
  'ليه',
  'امتي',
  'مين',
]);

// Phrases that signal praise, matched only when no inquiry signal exists
const PRAISE_WORDS = list([
  'nice',
  'great',
  'good',
  'love',
  'amazing',
  'awesome',
  'beautiful',
  'wow',
  'perfect',
  'congrats',
  'congratulations',
  'best',
  'cool',
  'thanks',
  'thank you',
  'excellent',
  'جميل',
  'جميله',
  'حلو',
  'حلوه',
  'رائع',
  'روعه',
  'تحفه',
  'ممتاز',
  'برافو',
  'مبروك',
  'ما شاء الله',
  'ماشاء الله',
  'تبارك الله',
  'بالتوفيق',
  'شكرا',
  'يجنن',
  'عظيم',
  'جامد',
  'خيال',
  'هايل',
  'كمل',
  'الله ينور',
  'الله يبارك',
]);

const MAX_ENGAGEMENT_WORDS = 6;

@Injectable()
export class CommentClassifierService {
  private readonly inquiryPhrases = INQUIRY_WORDS.filter((w) =>
    w.includes(' '),
  );
  private readonly inquiryTokens = new Set(
    INQUIRY_WORDS.filter((w) => !w.includes(' ')),
  );
  private readonly praisePhrases = PRAISE_WORDS.filter((w) => w.includes(' '));
  private readonly praiseTokens = new Set(
    PRAISE_WORDS.filter((w) => !w.includes(' ')),
  );

  classify(raw: string | undefined | null): Classification {
    const text = normalize((raw ?? '').trim());
    if (!text)
      return {
        type: 'engagement',
        reason: 'empty (probably a sticker or GIF)',
      };

    // 1) question marks (Latin and Arabic)
    if (/[?؟]/.test(text)) return { type: 'inquiry', reason: 'question mark' };

    // 2) comments that are only tags, emoji, punctuation or digits
    const letters = text
      .replace(/@\S+/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (!/\p{L}/u.test(letters)) {
      // a bare number is usually someone asking for the price or the phone number
      return /\p{N}/u.test(letters)
        ? { type: 'unsure', reason: 'only digits' }
        : { type: 'engagement', reason: 'only tags/emoji' };
    }

    const tokens = letters.split(/\s+/);
    const padded = ` ${tokens.join(' ')} `;

    // 3) inquiry words and phrases
    const hitToken = tokens.find((t) => this.inquiryTokens.has(t));
    if (hitToken) return { type: 'inquiry', reason: `keyword "${hitToken}"` };
    const hitPhrase = this.inquiryPhrases.find((p) =>
      padded.includes(` ${p} `),
    );
    if (hitPhrase) return { type: 'inquiry', reason: `phrase "${hitPhrase}"` };

    // 4) short praise
    const praise =
      tokens.some((t) => this.praiseTokens.has(t)) ||
      this.praisePhrases.some((p) => padded.includes(` ${p} `));
    if (praise && tokens.length <= MAX_ENGAGEMENT_WORDS) {
      return { type: 'engagement', reason: 'short praise' };
    }

    // 5) everything else: don't guess
    return { type: 'unsure', reason: 'no clear signal' };
  }
}
