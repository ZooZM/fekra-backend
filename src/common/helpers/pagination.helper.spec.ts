import { paginate } from './pagination.helper';

describe('paginate', () => {
  it.each([
    [0, 20, 0],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
  ])('calculates total pages for total=%i and limit=%i', (total, limit, pages) => {
    expect(paginate(['item'], total, 2, limit)).toEqual({
      data: ['item'],
      meta: { total, page: 2, limit, totalPages: pages },
    });
  });

  it('preserves the data reference and pagination inputs', () => {
    const data = [{ id: 1 }];
    const result = paginate(data, 1, 1, 1);
    expect(result.data).toBe(data);
    expect(result.meta.page).toBe(1);
  });
});
