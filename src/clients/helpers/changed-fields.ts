import { isDeepStrictEqual } from 'node:util';

/**
 * Top-level keys of `input` whose value differs from `current`. Compared by value, so JSON
 * columns and arrays that were re-sent unchanged don't count. `undefined` means "not sent".
 */
export function changedFields(
  current: Record<string, unknown>,
  input: Record<string, unknown>,
): string[] {
  return Object.keys(input).filter(
    (key) =>
      input[key] !== undefined && !isDeepStrictEqual(current[key], input[key]),
  );
}
