import {
  ClientPostParamsSchema,
  ClientPostsQuerySchema,
  UnrepliedCountQuerySchema,
} from './client-posts-query.schema';

const ID = '8ed9f96d-c790-4279-ba5f-88feec1c68e3';

describe('ClientPostsQuerySchema', () => {
  it('requires a platform and accepts only facebook or instagram', () => {
    expect(ClientPostsQuerySchema.safeParse({}).success).toBe(false);
    expect(
      ClientPostsQuerySchema.safeParse({ platform: 'twitter' }).success,
    ).toBe(false);
    expect(
      ClientPostsQuerySchema.safeParse({ platform: 'facebook' }).success,
    ).toBe(true);
    expect(
      ClientPostsQuerySchema.safeParse({ platform: 'instagram' }).success,
    ).toBe(true);
  });

  it('defaults the limit to 25 and coerces it from the query string', () => {
    expect(ClientPostsQuerySchema.parse({ platform: 'facebook' }).limit).toBe(
      25,
    );
    expect(
      ClientPostsQuerySchema.parse({ platform: 'facebook', limit: '10' }).limit,
    ).toBe(10);
  });

  it.each(['0', '26', '-1', '1.5', 'abc'])('rejects limit=%s', (limit) => {
    expect(
      ClientPostsQuerySchema.safeParse({ platform: 'facebook', limit }).success,
    ).toBe(false);
  });

  it('accepts a paging cursor and rejects one that could alter the Graph URL', () => {
    expect(
      ClientPostsQuerySchema.safeParse({
        platform: 'facebook',
        after: 'QVFIUjRtc2Y0d0Rk=',
      }).success,
    ).toBe(true);
    for (const after of ['', 'a/b', 'a&limit=100', 'a b', 'x'.repeat(513)]) {
      expect(
        ClientPostsQuerySchema.safeParse({ platform: 'facebook', after })
          .success,
      ).toBe(false);
    }
  });

  it('rejects unknown keys', () => {
    expect(
      ClientPostsQuerySchema.safeParse({ platform: 'facebook', fields: 'id' })
        .success,
    ).toBe(false);
  });
});

describe('UnrepliedCountQuerySchema', () => {
  it('takes the platform only', () => {
    expect(
      UnrepliedCountQuerySchema.safeParse({ platform: 'instagram' }).success,
    ).toBe(true);
    expect(UnrepliedCountQuerySchema.safeParse({}).success).toBe(false);
    expect(
      UnrepliedCountQuerySchema.safeParse({ platform: 'facebook', limit: 5 })
        .success,
    ).toBe(false);
  });
});

describe('ClientPostParamsSchema', () => {
  it('needs a client UUID and a Meta post id', () => {
    expect(
      ClientPostParamsSchema.safeParse({ id: ID, postId: '12345_67890' })
        .success,
    ).toBe(true);
    // a Facebook page id is not a client id
    expect(
      ClientPostParamsSchema.safeParse({
        id: '114022207011543',
        postId: '12345_67890',
      }).success,
    ).toBe(false);
    expect(
      ClientPostParamsSchema.safeParse({ id: ID, postId: 'abc' }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      ClientPostParamsSchema.safeParse({ id: ID, postId: '12345', x: 1 })
        .success,
    ).toBe(false);
  });
});
