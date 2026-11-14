/**
 * The address of one client's chat workflow: the fixed base address (N8N_BASE_URL) followed by the
 * client's endpoint, one path segment (research R3).
 *
 * The endpoint is already restricted by a Zod format when it is saved. This is the second guard:
 * whatever reaches here, the request can only go to the base's own host and below its own path.
 */

/** Parses and normalizes N8N_BASE_URL. Throws when it is not a plain http(s) address. */
export function parseBaseUrl(value: string): URL {
  let base: URL;
  try {
    base = new URL(value.trim());
  } catch {
    throw new Error('N8N_BASE_URL is not a valid URL');
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('N8N_BASE_URL must use http or https');
  }
  if (base.search || base.hash) {
    throw new Error('N8N_BASE_URL must not have a query or a fragment');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return base;
}

export function buildWorkflowUrl(base: string | URL, endpoint: string): string {
  const parsed = typeof base === 'string' ? parseBaseUrl(base) : base;
  const segment = encodeURIComponent(endpoint);
  const url = new URL(`${parsed.origin}${parsed.pathname}${segment}`);

  // "." and ".." are not changed by encoding, but the URL parser resolves them, which would
  // leave the base path. Comparing against the path we asked for catches that.
  if (
    url.origin !== parsed.origin ||
    url.pathname !== `${parsed.pathname}${segment}` ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'The chat workflow endpoint does not stay below the base address',
    );
  }
  return url.toString();
}
