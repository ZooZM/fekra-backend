// Stubs the Meta Graph API for e2e tests: requests to graph.facebook.com go to a handler,
// everything else (supertest talking to the app, another stub) goes through the fetch that was
// installed before.
import { layerFetch } from './fetch-layer';

export interface GraphReply {
  status?: number;
  body: unknown;
}

export type GraphHandler = (
  url: URL,
  init?: RequestInit,
) => GraphReply | undefined;

const GRAPH_HOSTS = new Set(['graph.facebook.com', 'graph.instagram.com']);

let undo: (() => void) | undefined;
let calls: URL[] = [];

/** Replaces `global.fetch`. A handler that returns undefined answers "object not found" (code 803). */
export function stubGraph(handler: GraphHandler): void {
  restoreGraph();
  calls = [];
  undo = layerFetch((url, init) => {
    if (!GRAPH_HOSTS.has(url.hostname)) return undefined;

    calls.push(url);
    const reply = handler(url, init) ?? graphError(803, undefined, 404);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

/** A Graph error body with the status Meta would use. */
export function graphError(
  code: number,
  subcode?: number,
  status = 400,
): GraphReply {
  return {
    status,
    body: {
      error: {
        code,
        error_subcode: subcode,
        message: `stubbed graph error ${code}`,
      },
    },
  };
}

/** The Graph URLs requested since the last `stubGraph`. */
export const graphCalls = (): URL[] => [...calls];

export function restoreGraph(): void {
  undo?.();
  undo = undefined;
}
