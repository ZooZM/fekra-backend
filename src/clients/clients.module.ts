import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { CLIENTS_REPOSITORY } from './repositories/IClientsRepository.repository';
import { ClientsRepository } from './repositories/clients.repository.impl';

@Module({
  controllers: [ClientsController],
  providers: [
    ClientsService,
    { provide: CLIENTS_REPOSITORY, useClass: ClientsRepository },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
