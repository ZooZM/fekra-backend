import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { COMMENTS_REPOSITORY } from './repositories/ICommentsRepository.repository';
import { CommentsRepository } from './repositories/comments.repository.impl';

@Module({
  controllers: [CommentsController],
  providers: [
    CommentsService,
    { provide: COMMENTS_REPOSITORY, useClass: CommentsRepository },
  ],
  exports: [CommentsService],
})
export class CommentsModule {}
