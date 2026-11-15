import { buildWorkflowUrl, parseBaseUrl } from './chat-workflow-url';

describe('parseBaseUrl', () => {
  it('accepts http and https and adds the trailing slash', () => {
    expect(parseBaseUrl('http://n8n.local/webhook').toString()).toBe(
      'http://n8n.local/webhook/',
    );
    expect(parseBaseUrl(' https://n8n.example.com/webhook/ ').toString()).toBe(
      'https://n8n.example.com/webhook/',
    );
  });

  it.each([
    'not a url',
    '',
    'ftp://n8n.local/webhook/',
    'javascript:alert(1)',
    'https://n8n.local/webhook/?token=1',
    'https://n8n.local/webhook/#x',
  ])('rejects %j', (value) => {
    expect(() => parseBaseUrl(value)).toThrow();
  });
});

describe('buildWorkflowUrl', () => {
  it('appends the endpoint to the base', () => {
    expect(buildWorkflowUrl('http://h.test/webhook/', 'chat-acme')).toBe(
      'http://h.test/webhook/chat-acme',
    );
  });

  it('adds the missing slash of a base without one', () => {
    expect(buildWorkflowUrl('http://h.test/webhook', 'chat-acme')).toBe(
      'http://h.test/webhook/chat-acme',
    );
  });

  it('works with a base that has no path', () => {
    expect(buildWorkflowUrl('https://h.test', 'x')).toBe('https://h.test/x');
  });

  it('accepts an already parsed base', () => {
    expect(
      buildWorkflowUrl(parseBaseUrl('http://h.test/webhook/'), 'A_1'),
    ).toBe('http://h.test/webhook/A_1');
  });

  it('encodes the endpoint instead of trusting it', () => {
    expect(buildWorkflowUrl('http://h.test/webhook/', 'a b')).toBe(
      'http://h.test/webhook/a%20b',
    );
    expect(buildWorkflowUrl('http://h.test/webhook/', 'a/b')).toBe(
      'http://h.test/webhook/a%2Fb',
    );
  });

  it.each([
    '@evil.test',
    '//evil.test/x',
    'https://evil.test/x',
    'a?x=1',
    'a#b',
  ])('keeps %j on the base host and below its path', (endpoint) => {
    const url = new URL(buildWorkflowUrl('http://h.test/webhook/', endpoint));
    expect(url.origin).toBe('http://h.test');
    expect(url.pathname.startsWith('/webhook/')).toBe(true);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });

  it.each(['.', '..'])(
    'refuses %j, which would leave the base path',
    (endpoint) => {
      expect(() =>
        buildWorkflowUrl('http://h.test/webhook/', endpoint),
      ).toThrow(/below the base/);
    },
  );

  it('throws on a base with a query or a fragment', () => {
    expect(() => buildWorkflowUrl('http://h.test/w/?a=1', 'x')).toThrow();
    expect(() => buildWorkflowUrl('ftp://h.test/w/', 'x')).toThrow();
  });
});
