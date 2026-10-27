// dtos/QueryRestaurantStaff.dto.ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class BaseQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsString()
  orderBy: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  orderDir: 'asc' | 'desc' = 'desc';
}
