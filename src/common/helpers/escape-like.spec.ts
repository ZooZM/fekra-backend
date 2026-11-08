import { escapeLike } from './escape-like';

describe('escapeLike', () => {
  it.each([
    ['plain', 'plain'],
    ['100%', '100\\%'],
    ['a_b', 'a\\_b'],
    ['back\\slash', 'back\\\\slash'],
    ['%_\\', '\\%\\_\\\\'],
    ['مطعم', 'مطعم'],
    ['', ''],
  ])('escapes %p', (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });
});
