import { BaseQueryDto } from '../dto/query-base.dto';
import { PaginatedResult } from '../helpers/pagination.helper';

export interface IBaseRepository<T, CreateDto, UpdateDto> {
  findAll(query?: BaseQueryDto): Promise<PaginatedResult<T>>;
  findById(id: string): Promise<T | null>;
  create(data: CreateDto): Promise<T>;
  update(id: string, data: UpdateDto): Promise<T>;
  delete(id: string): Promise<void>;
}
