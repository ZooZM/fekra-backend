import {
  CommentClassifierService,
  CommentKind,
} from './comment-classifier.service';

describe('CommentClassifierService', () => {
  let service: CommentClassifierService;

  beforeEach(() => {
    service = new CommentClassifierService();
  });

  const typeOf = (text: string | null | undefined): CommentKind =>
    service.classify(text).type;

  // ─────────────────────────── empty input ───────────────────────────

  describe('empty input', () => {
    it.each<[string, string | null | undefined]>([
      ['an empty string', ''],
      ['whitespace only', '   \n\t  '],
      ['null', null],
      ['undefined', undefined],
    ])(
      'treats %s as engagement (probably a sticker or GIF)',
      (_label, input) => {
        const result = service.classify(input);
        expect(result.type).toBe('engagement');
        expect(result.reason).toContain('empty');
      },
    );
  });

  // ─────────────────────────── question marks ───────────────────────────

  describe('question marks', () => {
    it.each([
      ['a Latin question mark', 'is this real?'],
      ['an Arabic question mark', 'بكام ده؟'],
      ['a question mark after emoji', '😍😍?'],
      ['a lone question mark', '?'],
      ['a question mark with praise', 'amazing, is it available?'],
      ['an Arabic question mark with praise', 'تحفه؟'],
    ])('classifies %s as an inquiry', (_label, text) => {
      expect(typeOf(text)).toBe('inquiry');
    });

    it('reports "question mark" as the reason', () => {
      expect(service.classify('where?').reason).toBe('question mark');
    });
  });

  // ─────────────────────────── tags, emoji, digits ───────────────────────────

  describe('comments with no words', () => {
    it.each([
      '🔥🔥',
      '❤️',
      '👍👍👍',
      '😂',
      '!!!',
      '...',
      '@sara @ahmed',
      '@sara 😍',
    ])('treats "%s" as engagement', (text) => {
      const result = service.classify(text);
      expect(result.type).toBe('engagement');
      expect(result.reason).toBe('only tags/emoji');
    });

    it.each([
      ['Latin digits', '150'],
      ['Arabic-Indic digits', '١٥٠'],
      ['digits with spaces', '0100 123 4567'],
    ])(
      'leaves %s as unsure (usually a price or phone request)',
      (_label, text) => {
        const result = service.classify(text);
        expect(result.type).toBe('unsure');
        expect(result.reason).toBe('only digits');
      },
    );

    it('does not treat digits plus a word as digits-only', () => {
      const result = service.classify('150 egp');
      expect(result.type).toBe('unsure');
      expect(result.reason).toBe('no clear signal');
    });
  });

  // ─────────────────────────── inquiry keywords ───────────────────────────

  describe('inquiry keywords', () => {
    it.each([
      'how much is this',
      'price please',
      'is it available',
      'where are you located',
      'what time do you open',
      'dm me please',
      'delivery to Giza',
      'do you ship abroad, i want to order',
      'size M',
      'whatsapp number',
    ])('classifies English "%s" as an inquiry', (text) => {
      expect(typeOf(text)).toBe('inquiry');
    });

    it.each([
      'بكام ده',
      'السعر ايه',
      'فين المكان',
      'متاح مقاس ٤٢',
      'بتوصلوا اسكندريه',
      'عايز احجز',
      'ممكن تفاصيل',
      'رقم التليفون',
      'الاسعار',
      'هل المنتج موجود',
    ])('classifies Arabic "%s" as an inquiry', (text) => {
      expect(typeOf(text)).toBe('inquiry');
    });

    it('names the matched keyword in the reason', () => {
      expect(service.classify('dm me please').reason).toBe('keyword "dm"');
      expect(service.classify('how much is this').reason).toBe('keyword "how"');
    });

    it('matches a tag followed by a question', () => {
      expect(typeOf('@sara how much')).toBe('inquiry');
    });
  });

  // ─────────────────────────── multi-word phrases ───────────────────────────

  describe('inquiry phrases', () => {
    it.each([
      ['do you have this in stock', 'do you'],
      ['can you help me', 'can you'],
      ['can i get one', 'can i'],
      ['ابعتلي ع الخاص', 'ع الخاص'],
    ])('matches the phrase in "%s"', (text, phrase) => {
      const result = service.classify(text);
      expect(result.type).toBe('inquiry');
      expect(result.reason).toBe(`phrase "${phrase}"`);
    });
  });

  // ─────────────────────────── Arabic normalization ───────────────────────────

  describe('Arabic normalization', () => {
    it.each([
      ['diacritics', 'بِكَام'],
      ['a shadda', 'السِّعر'],
      ['tatweel (elongation)', 'سـعر'],
      ['alef with hamza', 'أسعار'],
      ['alef with hamza below', 'إزاي'],
      ['taa marbuta', 'تكلفة المنتج'],
      ['alef maqsura', 'امتى'],
      ['Arabic-Indic digits in a sentence', 'متاح مقاس ٤٢'],
    ])('ignores %s when matching', (_label, text) => {
      expect(typeOf(text)).toBe('inquiry');
    });

    it('treats Arabic-Indic digits the same as ASCII digits', () => {
      expect(service.classify('١٥٠')).toEqual(service.classify('150'));
    });
  });

  // ─────────────────────────── case ───────────────────────────

  describe('case insensitivity', () => {
    it('matches inquiry words in any case', () => {
      expect(typeOf('HOW MUCH')).toBe('inquiry');
      expect(typeOf('Price')).toBe('inquiry');
    });

    it('matches praise words in any case', () => {
      expect(typeOf('LOVE IT')).toBe('engagement');
      expect(typeOf('Amazing!')).toBe('engagement');
    });
  });

  // ─────────────────────────── whole-word matching ───────────────────────────

  describe('whole-word matching', () => {
    it('does not match "how" inside "show"', () => {
      expect(typeOf('nice show')).toBe('engagement');
    });

    it('does not match "order" inside "border"', () => {
      expect(typeOf('nice border')).toBe('engagement');
    });

    it('does not match "who" inside "whoever"', () => {
      expect(typeOf('whoever made this is great')).toBe('engagement');
    });

    it('does not match "dm" inside another word', () => {
      expect(typeOf('admin is great')).toBe('engagement');
    });
  });

  // ─────────────────────────── praise ───────────────────────────

  describe('short praise', () => {
    it.each([
      'nice',
      'so beautiful',
      'wow',
      'congrats',
      'thank you',
      'love it 😍',
      'this is really nice and cool',
    ])('classifies English "%s" as engagement', (text) => {
      const result = service.classify(text);
      expect(result.type).toBe('engagement');
      expect(result.reason).toBe('short praise');
    });

    it.each([
      'تحفه ❤️❤️',
      'ما شاء الله',
      'مبروك',
      'جميل جدا',
      'شكرا',
      'تبارك الله',
      'الله يبارك فيكم',
      'برافو',
    ])('classifies Arabic "%s" as engagement', (text) => {
      expect(typeOf(text)).toBe('engagement');
    });

    it('accepts praise of exactly six words', () => {
      // this is really nice and cool = 6 words
      expect(typeOf('this is really nice and cool')).toBe('engagement');
    });

    it('does not treat praise of seven or more words as engagement', () => {
      // 7 words: long comments are often stories or complaints, so they are not guessed
      expect(typeOf('this is really nice and cool man')).toBe('unsure');
      expect(typeOf('nice nice nice nice nice nice nice')).toBe('unsure');
    });
  });

  // ─────────────────────────── priority between signals ───────────────────────────

  describe('priority between signals', () => {
    it.each(['best price', 'love it, how much', 'تحفه بكام', 'nice, dm me'])(
      'prefers inquiry over praise in "%s"',
      (text) => {
        expect(typeOf(text)).toBe('inquiry');
      },
    );
  });

  // ─────────────────────────── unsure ───────────────────────────

  describe('unsure', () => {
    it.each([
      'I bought this last week and the box was damaged',
      'see you tomorrow',
      'منتج وحش ومش عاجبني',
    ])('does not guess for "%s"', (text) => {
      const result = service.classify(text);
      expect(result.type).toBe('unsure');
      expect(result.reason).toBe('no clear signal');
    });

    // Documents current behavior: a tag followed by a word is left to the LLM,
    // even though "@friend look" is usually plain engagement.
    it('leaves a tag followed by an unknown word as unsure', () => {
      expect(typeOf('@sara look')).toBe('unsure');
    });
  });

  // ─────────────────────────── contract ───────────────────────────

  describe('contract', () => {
    it('always returns a type and a non-empty reason', () => {
      const samples = [
        '',
        '?',
        'nice',
        'how much',
        '150',
        'random words here',
        '🔥',
        '@a',
      ];
      for (const text of samples) {
        const result = service.classify(text);
        expect(['engagement', 'inquiry', 'unsure']).toContain(result.type);
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });

    it('gives the same answer for the same input', () => {
      expect(service.classify('how much')).toEqual(
        service.classify('how much'),
      );
    });

    it('does not mutate the input', () => {
      const input = 'How Much?';
      service.classify(input);
      expect(input).toBe('How Much?');
    });
  });
});
