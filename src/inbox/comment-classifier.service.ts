// comments/comment-classifier.service.ts
import { Injectable } from '@nestjs/common';

/**
 * Rule-based first pass over a public comment.
 *
 * The categories mirror the LLM system prompt (inquiry, engagement, complaint,
 * spam, insult). Anything the rules can't decide with confidence comes back as
 * `unsure` so the caller can hand it to the LLM.
 *
 * The vocabulary is deliberately business-agnostic (shops, restaurants, clinics,
 * real estate, courses, services...) and covers English, Egyptian Arabic and
 * Franco-Arabic (Arabizi).
 *
 * Priority (first match wins): insult > spam > complaint > inquiry > engagement.
 */
export const COMMENT_CATEGORIES = [
  'inquiry',
  'engagement',
  'complaint',
  'spam',
  'insult',
] as const;
export type CommentCategory = (typeof COMMENT_CATEGORIES)[number];
export type CommentKind = CommentCategory | 'unsure';

export interface Classification {
  type: CommentKind;
  reason: string;
  /** Only on `unsure` from the LLM: true if the same call may succeed later (network, quota, outage). */
  retryable?: boolean;
  /** Only on a label from the LLM: the model that gave it (stored as the comment's decision model). */
  model?: string;
}

// ─────────────────────────── normalization ───────────────────────────

/**
 * Lowercase, strip Arabic diacritics and tatweel, unify letter variants,
 * convert Arabic-Indic digits, and squeeze elongated letters
 * ("حلوووو" -> "حلو", "niceeee" -> "nicee", "gooood" -> "good").
 */
const normalize = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // diacritics + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/[ةۀ]/g, 'ه')
    .replace(/ک/g, 'ك')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/([ء-ي])\1+/g, '$1') // Arabic letters are never doubled in spelling
    .replace(/([a-z])\1{2,}/g, '$1$1'); // Latin: keep real doubles like "good"

/** Arabic clitics that get glued to the front of a word ("والسعر", "بالتوفيق"). */
const PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ب', 'ف', 'ل'];

/** The token itself plus its prefix-stripped and fully de-duplicated forms. */
const forms = (t: string): string[] => {
  const out = [t];
  for (const p of PREFIXES) {
    if (t.startsWith(p) && t.length - p.length >= 2)
      out.push(t.slice(p.length));
  }
  const single = t.replace(/(.)\1+/g, '$1'); // "nicee" -> "nice", "woow" -> "wow"
  if (single !== t) out.push(single);
  return out;
};

/** A word list split into single tokens (matched via `forms`) and multi-word phrases. */
class Lexicon {
  private readonly tokens: Set<string>;
  private readonly phrases: string[];

  constructor(words: string[]) {
    const normalized = words.map(normalize);
    this.tokens = new Set(normalized.filter((w) => !w.includes(' ')));
    this.phrases = normalized.filter((w) => w.includes(' '));
  }

  hasToken(token: string): boolean {
    return forms(token).some((f) => this.tokens.has(f));
  }

  /** Returns the first matched word or phrase, if any. */
  find(tokens: string[], padded: string): string | undefined {
    return (
      tokens.find((t) => this.hasToken(t)) ??
      this.phrases.find((p) => padded.includes(` ${p} `))
    );
  }
}

// ─────────────────────────── vocabularies ───────────────────────────

/** Always offensive, whatever the business. */
// prettier-ignore
const INSULT = new Lexicon([
  // English
  'fuck', 'fucking', 'fucker', 'fck', 'shit', 'bullshit', 'bitch',
  'asshole', 'ass', 'bastard', 'dick', 'cunt', 'whore', 'slut', 'motherfucker',
  'wtf', 'stfu', 'idiot', 'idiots', 'moron', 'retard', 'pussy',
  // Egyptian Arabic
  'احا', 'خول', 'خولات', 'عرص', 'معرص', 'عرصات', 'معرصين', 'شرموط', 'شرموطه',
  'شراميط', 'متناك', 'متناكه', 'متناكين', 'منيك', 'منيوك', 'نيك', 'انيك',
  'كس', 'كسم', 'كسمك', 'كسختك', 'طيز', 'زب', 'زبي', 'قحبه', 'ديوث', 'حقير',
  'حقيرين', 'متخلف', 'متخلفه', 'متخلفين', 'يلعن', 'تفو',
  'ابن الكلب', 'ابن الوسخه', 'ولاد الكلب', 'ولاد الوسخه', 'ابن المتناكه',
  'يلعن ابوك', 'يلعن دينك', 'دين امك',
  // جعر and its forms; "يجعر" is usually "يا جعر" with the vocative glued on
  'جعر', 'جعار', 'جعره', 'جعرت', 'يجعر', 'ياجعر', 'بيجعر', 'اجعر', 'تجعر', 'مجعر',
  // Franco-Arabic
  'a7a', 'kos', 'kosom', 'kosomak', 'kosomk', 'ksomk', '5wl', 'khawal', '3rs',
  '3ars', 'm3ars', 'm3rs', 'sharmota', 'sharmoota', 'metnak', 'mtnak',
  'weskha', 'ebn el kalb', 'ibn el kalb', 'ga3r', 'ge3r',
]);

/**
 * Words that are only an insult when aimed at someone ("يا حمار", "انت كلب",
 * "you stupid"). On their own they are normal vocabulary for some businesses
 * (pet shops, butchers, cleaning services...).
 */
// prettier-ignore
const VOCATIVE_INSULT = new Lexicon([
  'كلب', 'كلاب', 'حمار', 'حمير', 'حيوان', 'حيوانات', 'بهيم', 'بهايم', 'جزمه',
  'غبي', 'غبيه', 'اغبيا', 'خنزير', 'خنازير', 'قرد', 'تور', 'وسخ', 'وسخه',
  'واطي', 'زباله', 'زبالة',
  'stupid', 'pig', 'donkey', 'trash', 'loser',
  '7mar', 'kalb', 'ghabi', 'wes5',
]);
/** Words where "ي" + a vocative insult is a real verb ("يوسخ" = it stains), not "يا وسخ". */
const NOT_VOCATIVE_WITH_YA = new Set(['وسخ', 'وسخه', 'تور'].map(normalize));
const VOCATIVE_MARKERS = new Set(
  [
    'يا',
    'ي', // "ي حمار": a common short form of "يا"
    'انت',
    'انتي',
    'انتو',
    'انتم',
    'you',
    'ya',
    'enta',
    'enti',
    'ento',
  ].map(normalize),
);

// Only self-promotion / off-topic patterns. Words a real customer could use
// ("link", "promo code", "investment", "subscribe"...) are left out on purpose.
// prettier-ignore
const SPAM = new Lexicon([
  // English
  'follow me', 'follow back', 'follow my', 'check my', 'visit my', 'my page',
  'my channel', 'subscribe to my', 'earn money', 'make money',
  'work from home', 'forex', 'crypto', 'bitcoin', 'click here', 'link in bio',
  'we are hiring', 'job offer',
  // Egyptian Arabic
  'تابعوني', 'تابعني', 'زوروا صفحتي', 'صفحتي', 'قناتي', 'اشتركوا في قناتي',
  'سبسكرايب', 'لايك للصفحه', 'لايك لصفحتي', 'وظايف خاليه', 'وظائف خاليه',
  'وظيفه خاليه', 'فرص عمل', 'فرصه عمل', 'مطلوب موظفين', 'مطلوب للعمل',
  'شغل من البيت', 'العمل من المنزل', 'اربح', 'ربح يومي', 'دخل اضافي',
  'فوركس', 'بيتكوين', 'كريبتو', 'اعلان ممول', 'للاعلان', 'دوس هنا', 'اضغط هنا',
  // Franco-Arabic
  'taba3ony', 'tab3ony',
]);

// prettier-ignore
const COMPLAINT = new Lexicon([
  // English
  'bad', 'worst', 'terrible', 'awful', 'horrible', 'disgusting', 'disappointed',
  'disappointing', 'scam', 'scammers', 'fraud', 'refund', 'broken', 'damaged',
  'delayed', 'delay', 'rude', 'overpriced', 'expensive', 'waste', 'poor',
  'complaint', 'unprofessional', 'cheated', 'fake', 'never again',
  'no response', 'no reply', 'nobody answers', 'not worth', 'still waiting',
  'not received', 'never arrived', 'wrong order',
  // Egyptian Arabic
  'وحش', 'وحشه', 'وحشين', 'سيء', 'سيئه', 'سئ', 'اسوا', 'اوحش', 'زفت', 'معفن',
  'معفنه', 'بايظ', 'بايظه', 'مضروب', 'مضروبه', 'مكسور', 'مكسوره', 'ناقص',
  'متاخر', 'متاخرين', 'اتاخر', 'اتاخرت', 'تاخير', 'غالي', 'غاليه', 'غاليين',
  'نصب', 'نصابين', 'نصاب', 'اتنصب', 'حراميه', 'حرامي', 'سرقه', 'خساره',
  'ندمان', 'مقلب', 'استرجاع', 'ارجاع', 'استرداد', 'فلوسي', 'شكوي', 'تقليد',
  'مغشوش', 'بقالي', 'مبيردوش', 'مبتردوش', 'موصلش', 'ماوصلش', 'موصلتش',
  'محدش بيرد', 'محدش رد', 'محدش بيرود', 'مفيش رد', 'مش بترد', 'مش بيردوا',
  'مش راضي', 'مش مطابق', 'مش زي الصوره', 'غير مطابق', 'ضحكوا علينا',
  'حرام عليكم', 'لسه مستني', 'لسه موصلش', 'الخدمه سيئه', 'معامله سيئه',
  // Franco-Arabic
  'w7esh', 'wa7esh', 'zeft', 'nasb', 'ghaly', 'ghali',
]);

// prettier-ignore
const INQUIRY = new Lexicon([
  // English
  'price', 'prices', 'pricing', 'how much', 'cost', 'available', 'availability',
  'how', 'where', 'when', 'what', 'which', 'who', 'do you', 'can i', 'can you',
  'is it', 'are there', 'is there', 'location', 'address', 'branch',
  'branches', 'delivery', 'deliver', 'shipping', 'ship', 'order', 'book',
  'booking', 'reserve', 'reservation', 'appointment', 'details', 'info',
  'information', 'dm', 'inbox', 'pm', 'number', 'phone', 'whatsapp', 'size',
  'sizes', 'color', 'colors', 'colour', 'colours', 'open', 'hours', 'menu',
  'discount', 'offer', 'offers', 'installment', 'installments', 'stock',
  'interested', 'need', 'want',
  // Egyptian Arabic
  'بكام', 'كام', 'سعر', 'السعر', 'اسعار', 'الاسعار', 'تكلفه', 'ازاي', 'كيف',
  'فين', 'وين', 'عنوان', 'العنوان', 'لوكيشن', 'مكانكم', 'فرع', 'فروع',
  'متاح', 'متاحه', 'متوفر', 'متوفره', 'موجود', 'موجوده', 'توصيل', 'بتوصلوا',
  'شحن', 'تفاصيل', 'معلومات', 'رقم', 'تليفون', 'موبايل', 'واتساب', 'واتس',
  'خاص', 'ع الخاص', 'علي الخاص', 'ممكن', 'عايز', 'عاوز', 'عاوزه', 'عايزه',
  'عايزين', 'عاوزين', 'محتاج', 'محتاجه', 'حجز', 'احجز', 'نحجز', 'اطلب',
  'نطلب', 'طلب', 'اوردر', 'مواعيد', 'ميعاد', 'بتفتحوا', 'بتقفلوا', 'مقاس',
  'مقاسات', 'لون', 'الوان', 'منيو', 'خصم', 'عروض', 'تقسيط', 'اقساط', 'قسط',
  // note: bare "ايه" is left out, "ايه الحلاوه دي" is praise, not a question
  'مقدم', 'مساحه', 'كشف', 'هل', 'ليه', 'امتي', 'مين', 'انهي', 'يعني ايه',
  'لسه في', 'فيه منه', 'السعر ايه', 'لينك', 'اللينك', 'رابط', 'كود خصم',
  // Franco-Arabic
  'bkam', 'b kam', 'kam', 'se3r', 'el se3r', 'as3ar', 'fen', 'fein', 'feen',
  'ezay', 'ezai', '3ayez', '3awez', '3ayza', '3awza', 'mo7tag', 'mota7',
  'mawgod', 'tawsil', 'tawseel', 'ra2am', 'emta', 'leh',
]);

// prettier-ignore
const ENGAGEMENT = new Lexicon([
  // English
  'nice', 'great', 'good', 'love', 'loved', 'lovely', 'amazing', 'awesome',
  'beautiful', 'wow', 'perfect', 'congrats', 'congratulations', 'best', 'cool',
  'thanks', 'thank you', 'thx', 'excellent', 'fantastic', 'wonderful', 'gorgeous',
  'brilliant', 'superb', 'top', 'yummy', 'delicious', 'goals', 'bravo',
  'good luck', 'well done', 'keep going', 'keep it up', 'god bless',
  'lol', 'lmao', 'haha', 'hahaha', 'hehe',
  // Egyptian Arabic
  'جميل', 'جميله', 'حلو', 'حلوه', 'رائع', 'رائعه', 'روعه', 'تحفه', 'ممتاز',
  'برافو', 'مبروك', 'الف مبروك', 'ما شاء الله', 'ماشاء الله', 'ماشالله',
  'تبارك الله', 'اللهم بارك', 'بارك الله', 'بالتوفيق', 'موفقين', 'شكرا',
  'متشكر', 'متشكرين', 'يجنن', 'تجنن', 'عظيم', 'جامد', 'جامده', 'خيال',
  'هايل', 'كمل', 'كملوا', 'منور', 'منورين', 'منوره', 'نورت', 'نورتوا',
  'الله ينور', 'الله يبارك', 'ربنا يوفقكم', 'ربنا يوفقك', 'ربنا يبارك',
  'ربنا يباركلكم', 'ربنا يكرمكم', 'يارب', 'تسلم', 'تسلم ايدك', 'تسلم ايديكم',
  'عاش', 'عاشت الايادي', 'فخم', 'فخامه', 'شغل عالي', 'عجبني', 'عاجبني',
  'حبيت', 'بحبكم', 'ه', 'خ',
  // Franco-Arabic
  'gamed', 'gameel', 'gamel', 'helw', '7elw', '7elwa', 'tohfa', 'to7fa',
  'mabrouk', 'mabrok', 'mabrook', 'mashallah', 'mashaallah', 'tslm', 'mnwr',
  'menawar', 'rabena ywfa2', '3ash',
]);

/** Words that flip the meaning of the word right after them ("مش حلو", "not good"). */
const NEGATORS = new Set(
  ['مش', 'مو', 'ما', 'مكنش', 'not', 'no', 'never', 'isnt', 'msh', 'mesh'].map(
    normalize,
  ),
);

const URL_RE =
  /(https?:\/\/|www\.|\b(?:wa\.me|t\.me|bit\.ly|tinyurl\.com|linktr\.ee)\b|\b[a-z0-9-]+\.(?:com|net|org|io|me|ly|co|info|xyz|site|online|store|shop|link|app)\b)/i;
const OFFENSIVE_EMOJI_RE = /🖕/u;
const NEGATIVE_EMOJI_RE = /[👎😡🤬😠🤮💩😤]/u;
const LAUGH_RE = /^(?:ha|he|hi|ah|xa|5a){2,}h?$/;
/**
 * "HM" / "h.m" / "h m" is Egyptian shorthand for "how much". Matched as exact tokens,
 * not through the keyword list, so "hmm" (someone thinking) doesn't count.
 */
const HOW_MUCH_RE = / h ?m /;

/** Praise can't be trusted on long comments: they are often stories or mixed feedback. */
const MAX_ENGAGEMENT_WORDS = 6;
/** "@friend شوف ده" style comments: a tag plus a few words is just tagging a friend. */
const MAX_TAG_ONLY_WORDS = 3;

@Injectable()
export class CommentClassifierService {
  classify(raw: string | undefined | null): Classification {
    const original = (raw ?? '').trim();
    const text = normalize(original);
    if (!text)
      return {
        type: 'engagement',
        reason: 'empty (probably a sticker or GIF)',
      };

    // 1) links are spam regardless of the rest (ads for other pages, scams)
    if (URL_RE.test(text)) return { type: 'spam', reason: 'external link' };

    // 2) comments that are only tags, emoji, punctuation or digits
    const hasTags = /@\S+/.test(text);
    const words = text
      .replace(/@\S+/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();

    if (OFFENSIVE_EMOJI_RE.test(text))
      return { type: 'insult', reason: 'offensive emoji' };

    if (!/\p{L}/u.test(words)) {
      if (/[?؟]/.test(text))
        return { type: 'inquiry', reason: 'question mark' };
      if (NEGATIVE_EMOJI_RE.test(text))
        return { type: 'complaint', reason: 'negative emoji' };
      // a bare number is usually someone asking for the price or the phone number
      return /\p{N}/u.test(words)
        ? { type: 'unsure', reason: 'only digits' }
        : { type: 'engagement', reason: 'only tags/emoji' };
    }

    const tokens = words.split(/\s+/);
    const padded = ` ${tokens.join(' ')} `;

    // 3) insults: any dirty word wins over everything else
    const insult =
      INSULT.find(tokens, padded) ?? this.findVocativeInsult(tokens);
    if (insult) return { type: 'insult', reason: `insult "${insult}"` };

    // 4) spam: self-promotion, jobs, money-making schemes
    const spam = SPAM.find(tokens, padded);
    if (spam) return { type: 'spam', reason: `spam "${spam}"` };

    // 5) complaints, with negation handled both ways:
    //    "مش حلو" is a complaint, "مش وحش" / "not bad" is praise
    const { complaint, negatedComplaint } = this.findComplaint(tokens, padded);
    if (complaint) return { type: 'complaint', reason: complaint };
    if (NEGATIVE_EMOJI_RE.test(text))
      return { type: 'complaint', reason: 'negative emoji' };

    // 6) inquiries
    if (/[?؟]/.test(text)) return { type: 'inquiry', reason: 'question mark' };
    if (HOW_MUCH_RE.test(padded))
      return { type: 'inquiry', reason: 'keyword "hm"' };
    const inquiry = INQUIRY.find(tokens, padded);
    if (inquiry) {
      return {
        type: 'inquiry',
        reason: inquiry.includes(' ')
          ? `phrase "${inquiry}"`
          : `keyword "${inquiry}"`,
      };
    }

    // 7) short praise, prayers, greetings, laughter
    const praise =
      negatedComplaint ||
      tokens.some((t) => LAUGH_RE.test(t)) ||
      ENGAGEMENT.find(tokens, padded) !== undefined;
    if (praise && tokens.length <= MAX_ENGAGEMENT_WORDS) {
      return { type: 'engagement', reason: 'short praise' };
    }

    // 8) tagging a friend with a couple of words ("@sara شوفي ده")
    if (hasTags && tokens.length <= MAX_TAG_ONLY_WORDS) {
      return { type: 'engagement', reason: 'tagged a friend' };
    }

    // 9) everything else: don't guess, let the LLM decide
    return { type: 'unsure', reason: 'no clear signal' };
  }

  /** "يا حمار", "ياكلب", "انت غبي", "you stupid". */
  private findVocativeInsult(tokens: string[]): string | undefined {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith('يا') && VOCATIVE_INSULT.hasToken(t.slice(2))) return t;
      // the same with "يا" shortened to "ي" and glued on: "يحمار", "يكلب"
      if (
        t.startsWith('ي') &&
        !NOT_VOCATIVE_WITH_YA.has(t.slice(1)) &&
        VOCATIVE_INSULT.hasToken(t.slice(1))
      )
        return t;
      if (
        i > 0 &&
        VOCATIVE_MARKERS.has(tokens[i - 1]) &&
        VOCATIVE_INSULT.hasToken(t)
      ) {
        return `${tokens[i - 1]} ${t}`;
      }
    }
    return undefined;
  }

  private findComplaint(
    tokens: string[],
    padded: string,
  ): { complaint?: string; negatedComplaint: boolean } {
    let negatedComplaint = false;

    for (let i = 0; i < tokens.length; i++) {
      const negated = i > 0 && NEGATORS.has(tokens[i - 1]);
      if (COMPLAINT.hasToken(tokens[i])) {
        if (negated)
          negatedComplaint = true; // "مش وحش", "not bad"
        else return { complaint: `keyword "${tokens[i]}"`, negatedComplaint };
      } else if (negated && ENGAGEMENT.hasToken(tokens[i])) {
        return {
          complaint: `negated praise "${tokens[i - 1]} ${tokens[i]}"`,
          negatedComplaint,
        };
      }
    }

    const phrase = COMPLAINT.find([], padded);
    if (phrase) return { complaint: `phrase "${phrase}"`, negatedComplaint };
    return { negatedComplaint };
  }
}
