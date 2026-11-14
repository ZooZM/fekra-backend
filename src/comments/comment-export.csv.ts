import { CommentRecord } from './types/comment.types';

/**
 * CSV for the comments download (research R9). Written by hand: 11 columns, but the escaping and
 * the spreadsheet-formula rule need their own tests anyway.
 *
 * - UTF-8 with a byte order mark, so Excel shows Arabic correctly.
 * - RFC 4180: CRLF line ends, fields with a comma, quote or line break are quoted, quotes doubled.
 * - Comment text and reasons are customer controlled and the file is opened in a spreadsheet, so
 *   a cell that would be read as a formula gets a leading apostrophe.
 */
export const BOM = '﻿';
const EOL = '\r\n';

export const CSV_COLUMNS = [
  'id',
  'clientId',
  'clientName',
  'platform',
  'commentId',
  'comment',
  'classification',
  'decisionBasis',
  'decisionModel',
  'reason',
  'createdAt',
] as const;

/** A leading = + - @, tab or carriage return makes a spreadsheet read the cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralise(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function cell(value: string | null): string {
  if (value === null || value === '') return '';
  const safe = neutralise(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvHeader = (): string => CSV_COLUMNS.join(',') + EOL;

export function csvRow(record: CommentRecord): string {
  const values: Record<(typeof CSV_COLUMNS)[number], string | null> = {
    id: record.id,
    clientId: record.clientId,
    clientName: record.clientName,
    platform: record.platform,
    commentId: record.commentId,
    comment: record.comment,
    classification: record.classification,
    decisionBasis: record.decisionBasis,
    decisionModel: record.decisionModel,
    reason: record.reason,
    createdAt: record.createdAt.toISOString(),
  };
  return CSV_COLUMNS.map((column) => cell(values[column])).join(',') + EOL;
}
