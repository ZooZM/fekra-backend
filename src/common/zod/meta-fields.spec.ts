import {
  classificationField,
  decisionBasisField,
  platformField,
} from './meta-fields';

describe('meta fields', () => {
  it('decisionBasisField accepts any case and outputs the database value', () => {
    expect(decisionBasisField.parse('rules')).toBe('RULES');
    expect(decisionBasisField.parse('AI_MODEL')).toBe('AI_MODEL');
    expect(decisionBasisField.parse(' safe_fallback ')).toBe('SAFE_FALLBACK');
    expect(decisionBasisField.parse('Unknown')).toBe('UNKNOWN');
  });

  it('decisionBasisField rejects values that are not a basis', () => {
    expect(decisionBasisField.safeParse('ai-model').success).toBe(false);
    expect(decisionBasisField.safeParse('model').success).toBe(false);
    expect(decisionBasisField.safeParse('').success).toBe(false);
  });

  it('classificationField and platformField map to the database enums', () => {
    expect(classificationField.parse(' Inquiry ')).toBe('INQUIRY');
    expect(classificationField.parse('UNSURE')).toBe('UNSURE');
    expect(classificationField.safeParse('praise').success).toBe(false);
    expect(platformField.parse('Facebook')).toBe('FACEBOOK');
    expect(platformField.safeParse('twitter').success).toBe(false);
  });
});
