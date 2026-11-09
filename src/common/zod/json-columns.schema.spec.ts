import { ReplyRunActivityDetailsSchema } from './json-columns.schema';
import { readReplyRunDetails } from './json-readers';

const started = {
  runId: '3f0e1c2a-8a43-4c55-9b55-0d7b0c7b1e11',
  platform: 'facebook',
  accountId: '114022207011543',
  postId: '114022207011543_100068101366873',
  toAnswer: 8,
};

describe('ReplyRunActivityDetailsSchema', () => {
  it('accepts the shape of a started run', () => {
    expect(ReplyRunActivityDetailsSchema.parse(started)).toEqual(started);
  });

  it('accepts the shape of a stopped run, which also says how many were handled', () => {
    const stopped = { ...started, platform: 'instagram', handled: 3 };
    expect(ReplyRunActivityDetailsSchema.parse(stopped)).toEqual(stopped);
  });

  it.each([
    ['an unknown key', { ...started, token: 'secret' }],
    ['a negative count', { ...started, toAnswer: -1 }],
    ['a negative handled count', { ...started, handled: -1 }],
    ['an unknown platform', { ...started, platform: 'twitter' }],
    ['a run id that is not a UUID', { ...started, runId: 'abc' }],
    ['a post id that is not a Meta id', { ...started, postId: 'abc' }],
    ['an account id that is not a Meta id', { ...started, accountId: 'abc' }],
    ['a missing field', { ...started, postId: undefined }],
  ])('rejects %s', (_name, value) => {
    expect(ReplyRunActivityDetailsSchema.safeParse(value).success).toBe(false);
  });
});

describe('readReplyRunDetails', () => {
  it('returns valid stored details, and null for no details', () => {
    expect(readReplyRunDetails(started)).toEqual(started);
    expect(readReplyRunDetails(null)).toBeNull();
  });

  it('falls back to null instead of trusting stored JSON that does not match', () => {
    expect(readReplyRunDetails({ runId: 'x' })).toBeNull();
    expect(readReplyRunDetails('not an object')).toBeNull();
  });
});
