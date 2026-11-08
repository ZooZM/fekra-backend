import { Module } from '@nestjs/common';
import { GraphApiService } from './graph-api.service';

@Module({
  providers: [GraphApiService],
  exports: [GraphApiService],
})
export class GraphApiModule {}
