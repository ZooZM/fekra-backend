import { PaginatedResult } from '../helpers/pagination.helper';
import { BaseListQuery } from '../zod/list-query.schema';

export interface IBaseRepository<
  T,
  CreateDto,
  UpdateDto,
  Query extends BaseListQuery,
> {
  findAll(query?: Query): Promise<PaginatedResult<T>>;
  findById(id: string): Promise<T | null>;
  create(data: CreateDto): Promise<T>;
  update(id: string, data: UpdateDto): Promise<T>;
  delete(id: string): Promise<void>;
}
