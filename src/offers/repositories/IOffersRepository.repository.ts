import { IBaseRepository } from '@common/repositories/base.repository.interface';
import { Offer } from '@app/generated/prisma/client';
import { CreateOfferData } from '../interfaces/create-offer-data.interface';
import { UpdateOfferData } from '../interfaces/update-offer-data.interface';

export const OFFERS_REPOSITORY = 'OFFERS_REPOSITORY';

export interface IOffersRepository extends IBaseRepository<
  Offer,
  CreateOfferData,
  UpdateOfferData
> {}
