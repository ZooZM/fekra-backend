import { ChatRowWithClient } from '../types/chat.types';
import { isEffectivelyPaused, toChatRecord } from './chat.mapper';

const NOW = new Date('2026-11-14T12:00:00.000Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const row = (over: Partial<ChatRowWithClient> = {}): ChatRowWithClient => ({
  id: 'chat-1',
  clientId: 'client-1',
  platform: 'FACEBOOK',
  senderId: 'customer-1',
  receiverId: 'page-1',
  pausedAt: null,
  pausedUntil: null,
  pausedById: null,
  pausedByName: null,
  createdAt: minutes(-100),
  updatedAt: minutes(-5),
  client: { id: 'client-1', name: 'Acme' },
  ...over,
});

const pausedRow = (until: Date | null) =>
  row({
    pausedAt: minutes(-10),
    pausedUntil: until,
    pausedById: 'admin-1',
    pausedByName: 'Admin One',
  });

describe('isEffectivelyPaused', () => {
  it('is false when there is no pause', () => {
    expect(isEffectivelyPaused(row(), NOW)).toBe(false);
  });

  it('is true for a pause until resumed', () => {
    expect(isEffectivelyPaused(pausedRow(null), NOW)).toBe(true);
  });

  it('is true while a timed pause has not ended', () => {
    expect(isEffectivelyPaused(pausedRow(minutes(30)), NOW)).toBe(true);
  });

  it('is false once a timed pause has ended, and exactly at its end', () => {
    expect(isEffectivelyPaused(pausedRow(minutes(-1)), NOW)).toBe(false);
    expect(isEffectivelyPaused(pausedRow(NOW), NOW)).toBe(false);
  });
});

describe('toChatRecord', () => {
  const last = {
    message: 'hello',
    reply: 'hi',
    answered: true,
    createdAt: minutes(-5),
  };

  it('copies the chat, takes the client name and attaches the last exchange', () => {
    const record = toChatRecord(row(), last, { isAdmin: true, now: NOW });
    expect(record).toMatchObject({
      id: 'chat-1',
      clientId: 'client-1',
      clientName: 'Acme',
      platform: 'FACEBOOK',
      senderId: 'customer-1',
      receiverId: 'page-1',
      paused: false,
      lastExchange: last,
    });
  });

  it('returns null for a chat with no exchange', () => {
    expect(
      toChatRecord(row(), null, { isAdmin: true, now: NOW }).lastExchange,
    ).toBeNull();
  });

  it('shows the pause details to an ADMIN', () => {
    const until = minutes(30);
    const record = toChatRecord(pausedRow(until), null, {
      isAdmin: true,
      now: NOW,
    });
    expect(record.paused).toBe(true);
    expect(record.pausedAt).toEqual(minutes(-10));
    expect(record.pausedUntil).toEqual(until);
    expect(record.pausedBy).toEqual({ id: 'admin-1', name: 'Admin One' });
  });

  it('never shows who paused it to a CLIENT-role reader', () => {
    const record = toChatRecord(pausedRow(null), null, {
      isAdmin: false,
      now: NOW,
    });
    expect(record.paused).toBe(true);
    expect(record.pausedBy).toBeNull();
  });

  it('hides every pause field once a timed pause has ended', () => {
    const record = toChatRecord(pausedRow(minutes(-1)), null, {
      isAdmin: true,
      now: NOW,
    });
    expect(record).toMatchObject({
      paused: false,
      pausedAt: null,
      pausedUntil: null,
      pausedBy: null,
    });
  });
});
