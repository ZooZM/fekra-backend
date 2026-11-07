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
      ['do you have it', 'do you'],
      ['can you help me', 'can you'],
      ['can i get one', 'can i'],
      ['يعني ايه', 'يعني ايه'],
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
    it.each(['see you tomorrow', 'random words here', 'asdkj qwe zxcm'])(
      'does not guess for "%s"',
      (text) => {
        const result = service.classify(text);
        expect(result.type).toBe('unsure');
        expect(result.reason).toBe('no clear signal');
      },
    );

    it('leaves a tag followed by a long sentence as unsure', () => {
      expect(typeOf('@sara we went there yesterday with mom')).toBe('unsure');
    });
  });

  // ─────────────────────────── tagging friends ───────────────────────────

  describe('tagging friends', () => {
    it.each(['@sara look', '@ahmed شوف ده', '@mona @ali تعالوا'])(
      'treats "%s" as engagement',
      (text) => {
        const result = service.classify(text);
        expect(result.type).toBe('engagement');
        expect(result.reason).toBe('tagged a friend');
      },
    );
  });

  // ─────────────────────────── insult ───────────────────────────

  describe('insult', () => {
    it.each([
      'fuck this page',
      'you are an idiot',
      'احا',
      'يا حمار',
      'ياكلب',
      'انت غبي',
      'ابن الكلب',
      'a7a eh da',
      'kosomak',
      '🖕',
    ])('classifies "%s" as insult', (text) => {
      expect(typeOf(text)).toBe('insult');
    });

    it('prefers insult over every other signal', () => {
      expect(typeOf('بكام يا حمار؟')).toBe('insult');
      expect(typeOf('الاكل وحش يا بهايم')).toBe('insult');
      expect(typeOf('nice shit')).toBe('insult');
    });

    // Real comment that got a "DMs closed" reply as an inquiry because of "التفاصيل"
    it('classifies "التفاصيل يجعر" as an insult, not an inquiry', () => {
      expect(service.classify('التفاصيل يجعر')).toEqual({
        type: 'insult',
        reason: 'insult "يجعر"',
      });
    });

    it.each([
      'يا جعر',
      'ياجعر',
      'ي جعر',
      'جعر',
      'بكام يجعر؟',
      'الجعر ده',
      'يجعرررر', // elongated
      'ga3r',
    ])('classifies the جعر form "%s" as an insult', (text) => {
      expect(typeOf(text)).toBe('insult');
    });

    it.each(['يحمار', 'يكلب', 'ي حمار', 'ي غبي', 'السعر كام ي بهيم'])(
      'understands "ي" as a short "يا" in "%s"',
      (text) => {
        expect(typeOf(text)).toBe('insult');
      },
    );

    it.each([
      ['يوسخ', 'a verb: it stains'],
      ['يتور', 'a verb'],
      ['يكون متاح امتى', 'normal words starting with ي'],
      ['يعني ايه', 'normal words starting with ي'],
    ])('does not flag "%s" (%s)', (text) => {
      expect(typeOf(text)).not.toBe('insult');
    });

    it('does not flag animal words that are not aimed at someone', () => {
      // pet shops, butchers, farms...
      expect(typeOf('عندكم اكل كلاب؟')).toBe('inquiry');
      expect(typeOf('سعر الحمار بكام')).toBe('inquiry');
      expect(typeOf('do you sell dog food')).toBe('inquiry');
    });

    it('does not match insults inside other words', () => {
      expect(typeOf('دخول الحفله بكام')).toBe('inquiry'); // contains "خول"
      expect(typeOf('class schedule please')).not.toBe('insult'); // contains "ass"
    });
  });

  // ─────────────────────────── spam ───────────────────────────

  describe('spam', () => {
    it.each([
      'check this https://example.com',
      'www.mypage.net',
      'contact wa.me/201000000000',
      'follow me please',
      'تابعوني',
      'زوروا صفحتي',
      'وظائف خالية للشباب',
      'اربح ١٠٠٠ دولار يوميا',
      'شغل من البيت',
    ])('classifies "%s" as spam', (text) => {
      expect(typeOf(text)).toBe('spam');
    });

    it('reports external links', () => {
      expect(service.classify('bit.ly/abc').reason).toBe('external link');
    });

    it('does not treat a customer asking for a link or code as spam', () => {
      expect(typeOf('ابعتلي اللينك')).toBe('inquiry');
      expect(typeOf('فيه كود خصم')).toBe('inquiry');
    });
  });

  // ─────────────────────────── complaint ───────────────────────────

  describe('complaint', () => {
    it.each([
      'I bought this last week and the box was damaged',
      'worst service ever',
      'منتج وحش ومش عاجبني',
      'الاكل وحش',
      'محدش بيرد',
      'ليه محدش بيرد؟',
      'الخدمة سيئة',
      'غالي أوي',
      'بقالي اسبوع مستني الاوردر',
      'نصابين',
      'مش حلو',
      'not good',
      '👎👎',
      'الاكل 😡',
    ])('classifies "%s" as complaint', (text) => {
      expect(typeOf(text)).toBe('complaint');
    });

    it('prefers complaint over inquiry', () => {
      expect(typeOf('السعر غالي ليه')).toBe('complaint');
    });

    it('treats negated complaints as praise', () => {
      expect(typeOf('مش وحش')).toBe('engagement');
      expect(typeOf('not bad')).toBe('engagement');
      expect(typeOf('مش غالي خالص')).toBe('engagement');
    });
  });

  // ─────────────────────────── "HM" (how much) ───────────────────────────

  describe('"HM" shorthand for "how much"', () => {
    it.each(['hm', 'HM', 'Hm', 'h.m', 'h m', 'hm ya basha', '@sara hm'])(
      'classifies "%s" as an inquiry',
      (text) => {
        expect(service.classify(text)).toEqual({
          type: 'inquiry',
          reason: 'keyword "hm"',
        });
      },
    );

    it.each(['hmm', 'hmmmm', 'ohm', 'hmo'])(
      'does not treat "%s" as "how much"',
      (text) => {
        expect(typeOf(text)).not.toBe('inquiry');
      },
    );
  });

  // ─────────────────────────── informal writing ───────────────────────────

  describe('informal writing', () => {
    it.each([
      ['elongated Arabic', 'حلووووو', 'engagement'],
      ['elongated English', 'niceeeee', 'engagement'],
      ['elongated double letter', 'gooood', 'engagement'],
      ['Arabic laughter', 'ههههههه', 'engagement'],
      ['English laughter', 'hahahaha', 'engagement'],
      ['Franco price', 'bkam', 'inquiry'],
      ['Franco praise', 'gamed gdn', 'engagement'],
      ['Franco wants', '3ayez wa7ed', 'inquiry'],
      ['glued conjunction', 'والسعر', 'inquiry'],
      ['glued preposition', 'بالتوفيق', 'engagement'],
      ['Arabic prayers', 'ربنا يوفقكم', 'engagement'],
      ['Arabic greeting', 'منورين', 'engagement'],
    ])('handles %s ("%s")', (_label, text, expected) => {
      expect(typeOf(text)).toBe(expected);
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
        'احا',
        'تابعوني',
        'الاكل وحش',
      ];
      for (const text of samples) {
        const result = service.classify(text);
        expect([
          'engagement',
          'inquiry',
          'complaint',
          'spam',
          'insult',
          'unsure',
        ]).toContain(result.type);
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
