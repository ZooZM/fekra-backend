import { forwardRef, Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { CLIENTS_REPOSITORY } from './repositories/IClientsRepository.repository';
import { ClientsRepository } from './repositories/clients.repository.impl';
import { CryptoModule } from '@app/crypto/crypto.module';
import { GraphApiModule } from '@app/inbox/graph-api.module';
import { InboxModule } from '@app/inbox/inbox.module';

@Module({
  imports: [CryptoModule, GraphApiModule, forwardRef(() => InboxModule)],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    { provide: CLIENTS_REPOSITORY, useClass: ClientsRepository },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
