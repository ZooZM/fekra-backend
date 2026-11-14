// Stubs the n8n chat workflows for e2e tests: requests to the origin of N8N_BASE_URL are recorded
// and answered by a handler. Everything else (supertest talking to the app, the Graph stub) goes
// through the fetch that was installed before, so this works together with stubGraph.
export interface N8nCall {
  url: string;
  body: any;
  headers: Record<string, string>;
}

export type N8nHandler = (
  url: URL,
  body: unknown,
) => { status?: number } | undefined;

let spy: jest.SpyInstance | undefined;
let calls: N8nCall[] = [];

/** Replaces `global.fetch`. The default answer is 200 `{}`. */
export function stubN8n(handler?: N8nHandler): void {
  restoreN8n();
  calls = [];
  const origin = new URL(process.env.N8N_BASE_URL ?? 'http://n8n.e2e.test/')
    .origin;
  const previousFetch = global.fetch.bind(globalThis);
  spy = jest
    .spyOn(global, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const raw =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(raw);
      if (url.origin !== origin) return previousFetch(input, init);

      const body: unknown =
        typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({
        url: url.toString(),
        body,
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
      });
      const reply = handler?.(url, body);
      return Promise.resolve(
        new Response('{}', {
          status: reply?.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
}

/** The calls made to the n8n base since the last `stubN8n`. */
export const n8nCalls = (): N8nCall[] => [...calls];

export function restoreN8n(): void {
  spy?.mockRestore();
  spy = undefined;
}
