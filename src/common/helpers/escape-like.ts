/**
 * Escapes the wildcard characters of SQL LIKE (`%`, `_`) and the escape character itself, so
 * user text is matched literally. Prisma's `contains` passes the value through unescaped.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
