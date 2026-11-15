import {
  BOM,
  CSV_COLUMNS,
  csvHeader,
  csvRow,
  neutralise,
} from './comment-export.csv';
import { CommentRecord } from './types/comment.types';

const record = (over: Partial<CommentRecord> = {}): CommentRecord => ({
  id: 'id-1',
  clientId: 'client-1',
  clientName: 'Acme',
  platform: 'FACEBOOK',
  commentId: '100_1',
  comment: 'how much?',
  classification: 'INQUIRY',
  reason: 'question mark',
  decisionBasis: 'RULES',
  decisionModel: null,
  createdAt: new Date('2026-11-14T10:00:00.000Z'),
  ...over,
});

describe('comments CSV', () => {
  it('has the columns of the contract in order', () => {
    expect(CSV_COLUMNS.join(',')).toBe(
      'id,clientId,clientName,platform,commentId,comment,classification,decisionBasis,decisionModel,reason,createdAt',
    );
    expect(csvHeader()).toBe(`${CSV_COLUMNS.join(',')}\r\n`);
  });

  it('exports a byte order mark for Excel', () => {
    expect(BOM).toBe('﻿');
  });

  it('writes one CRLF-terminated line with ISO dates and empty cells for null', () => {
    expect(csvRow(record())).toBe(
      'id-1,client-1,Acme,FACEBOOK,100_1,how much?,INQUIRY,RULES,,question mark,2026-11-14T10:00:00.000Z\r\n',
    );
  });

  it('quotes cells with commas, quotes and line breaks, and doubles the quotes', () => {
    const line = csvRow(
      record({ comment: 'a, "b"\nline two\r\nthree', reason: 'x,y' }),
    );
    expect(line).toContain('"a, ""b""\nline two\r\nthree"');
    expect(line).toContain(',"x,y",');
  });

  it('keeps Arabic text and emoji unchanged', () => {
    const line = csvRow(
      record({ comment: 'بكام السعر؟ 😍', clientName: 'متجر' }),
    );
    expect(line).toContain('متجر');
    expect(line).toContain('بكام السعر؟ 😍');
  });

  it('writes an empty comment (a sticker or GIF) as an empty cell', () => {
    expect(csvRow(record({ comment: '' }))).toContain(',100_1,,INQUIRY,');
  });

  it('keeps the model name of an AI decision', () => {
    const line = csvRow(
      record({
        decisionBasis: 'AI_MODEL',
        decisionModel: 'gemini-3.5-flash-lite',
      }),
    );
    expect(line).toContain(',AI_MODEL,gemini-3.5-flash-lite,');
  });

  describe('spreadsheet formula injection', () => {
    it.each([
      ['=HYPERLINK("http://evil")', "'=HYPERLINK("],
      ['+1+1', "'+1+1"],
      ['-2+3', "'-2+3"],
      ['@SUM(A1)', "'@SUM(A1)"],
      ['\tcmd', "'\tcmd"],
      ['\rcmd', "'\rcmd"],
    ])('prefixes %j with an apostrophe', (value, expected) => {
      expect(neutralise(value).startsWith(expected.slice(0, 4))).toBe(true);
      expect(neutralise(value)[0]).toBe("'");
    });

    it('does not touch text that only contains those characters later', () => {
      expect(neutralise('price = 5')).toBe('price = 5');
      expect(neutralise('a-b')).toBe('a-b');
      expect(neutralise('hello@example.com')).toBe('hello@example.com');
    });

    it('neutralises a formula in the comment, the reason and the client name', () => {
      const line = csvRow(
        record({
          comment: '=1+1',
          reason: '@evil',
          clientName: '+cmd',
        }),
      );
      expect(line).toContain(",'+cmd,");
      expect(line).toContain(",'=1+1,");
      expect(line).toContain(",'@evil,");
    });

    it('neutralises first, then quotes, so a quoted formula stays safe', () => {
      expect(csvRow(record({ comment: '=A1,B1' }))).toContain(`,"'=A1,B1",`);
      expect(csvRow(record({ comment: '=HYPERLINK("x")' }))).toContain(
        `,"'=HYPERLINK(""x"")",`,
      );
    });
  });
});
