import { changedFields } from './changed-fields';

describe('changedFields', () => {
  const current = {
    name: 'Cafe',
    fbPageId: null,
    aiConfig: { language: 'ARABIC', tags: ['a', 'b'] },
    replies: ['x', 'y'],
  };

  it('lists only the keys whose values differ', () => {
    expect(changedFields(current, { name: 'Cafe', fbPageId: '12345' })).toEqual(
      ['fbPageId'],
    );
  });

  it('compares objects and arrays by value', () => {
    expect(
      changedFields(current, {
        aiConfig: { language: 'ARABIC', tags: ['a', 'b'] },
        replies: ['x', 'y'],
      }),
    ).toEqual([]);
    expect(changedFields(current, { replies: ['y', 'x'] })).toEqual([
      'replies',
    ]);
    expect(
      changedFields(current, {
        aiConfig: { language: 'ENGLISH', tags: ['a', 'b'] },
      }),
    ).toEqual(['aiConfig']);
  });

  it('ignores keys that were not sent', () => {
    expect(changedFields(current, { name: undefined })).toEqual([]);
    expect(changedFields(current, {})).toEqual([]);
  });

  it('treats clearing a value as a change', () => {
    expect(changedFields({ fbPageId: '12345' }, { fbPageId: null })).toEqual([
      'fbPageId',
    ]);
  });
});
