// Layers stubs in front of `global.fetch` for e2e tests (the n8n, Graph and Gemini stubs).
//
// It does not use jest.spyOn: spyOn on a function that is already a spy returns that same spy, so a
// second stub would replace the first one instead of wrapping it, and the requests meant for the
// first stub would reach the network. Here every stub is a layer in a list over the one real fetch,
// so layers can be added and removed in any order.
export type FetchMatch = (
  url: URL,
  init?: RequestInit,
) => Promise<Response> | Response | undefined;

export const urlOf = (input: RequestInfo | URL): URL =>
  new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  );

let realFetch: typeof fetch | undefined;
const layers: FetchMatch[] = [];

const layeredFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = urlOf(input);
  // the most recently added layer answers first
  for (let i = layers.length - 1; i >= 0; i--) {
    const answer = layers[i](url, init);
    if (answer) return Promise.resolve(answer);
  }
  return (realFetch as typeof fetch).call(globalThis, input, init);
}) as typeof fetch;

/**
 * Puts `match` in front of `global.fetch`. When it returns a response that is the answer; when it
 * returns undefined the request goes on to the next layer and finally to the real fetch (supertest
 * talking to the app). Returns the function that removes the layer.
 */
export function layerFetch(match: FetchMatch): () => void {
  if (layers.length === 0) {
    realFetch = global.fetch;
    global.fetch = layeredFetch;
  }
  layers.push(match);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    layers.splice(layers.indexOf(match), 1);
    if (layers.length === 0 && realFetch) {
      global.fetch = realFetch;
      realFetch = undefined;
    }
  };
}
