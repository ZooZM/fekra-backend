import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  IBusinessInfoRepository,
  BUSINESS_INFO_REPOSITORY,
} from './repositories/IBusinessInfoRepository.repository';
import {
  CreateBusinessInfoBodyInput,
  UpdateBusinessInfoBodyInput,
} from './schemas/business-info.schema';
import { BusinessInfoRecord } from './interfaces/business-info.interface';
import { fieldError } from '@app/common/helpers/field-error';

@Injectable()
export class BusinessInfoService {
  constructor(
    @Inject(BUSINESS_INFO_REPOSITORY)
    private readonly repo: IBusinessInfoRepository,
  ) {}

  create(
    clientId: string,
    input: CreateBusinessInfoBodyInput,
  ): Promise<BusinessInfoRecord> {
    this.assertSameClient(clientId, input.clientId);
    return this.repo.create({ ...input, clientId });
  }

  /** 404 when the client has none yet: the dashboard then shows an empty form. */
  async findByClientId(clientId: string): Promise<BusinessInfoRecord> {
    const record = await this.repo.findByClientId(clientId);
    if (!record) throw new NotFoundException('Business information not found');
    return record;
  }

  update(
    clientId: string,
    input: UpdateBusinessInfoBodyInput,
  ): Promise<BusinessInfoRecord> {
    this.assertSameClient(clientId, input.clientId);
    // only the fields that were sent reach the repository, so the others stay unchanged
    const { clientId: _fromBody, ...fields } = input;
    void _fromBody;
    return this.repo.update(clientId, fields);
  }

  remove(clientId: string): Promise<void> {
    return this.repo.delete(clientId);
  }

  /** The path decides the client; a different one in the body is a mistake, not a second target. */
  private assertSameClient(fromPath: string, fromBody?: string): void {
    if (fromBody !== undefined && fromBody !== fromPath) {
      throw fieldError('clientId', 'clientId must match the client in the URL');
    }
  }
}
