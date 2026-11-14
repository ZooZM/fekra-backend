import { ExportFiltersSchema } from './json-columns.schema';
import { readExportFilters } from './json-readers';

describe('readExportFilters', () => {
  const valid = {
    clientId: '00000000-0000-4000-8000-000000000000',
    platform: 'FACEBOOK',
    classification: 'COMPLAINT',
    decisionBasis: 'AI_MODEL',
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z',
    snapshotAt: '2026-11-14T10:00:00.000Z',
  };

  it('returns a stored value that matches the schema', () => {
    expect(readExportFilters(valid)).toEqual(valid);
  });

  it('accepts a minimal value with only the snapshot instant', () => {
    expect(readExportFilters({ snapshotAt: valid.snapshotAt })).toEqual({
      snapshotAt: valid.snapshotAt,
    });
  });

  it('falls back instead of throwing when the stored value is invalid', () => {
    expect(readExportFilters({ platform: 'TWITTER' })).toEqual({
      snapshotAt: '1970-01-01T00:00:00.000Z',
    });
    expect(readExportFilters(null)).toEqual({
      snapshotAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('rejects unknown keys, so comment text can never be stored by mistake', () => {
    expect(
      ExportFiltersSchema.safeParse({ ...valid, comment: 'hello' }).success,
    ).toBe(false);
  });
});
