import { UpdateClientInput } from '../schemas/client.schema';

export type UpdateClientData = Omit<UpdateClientInput, 'accessToken'> & {
  accessToken?: string;
};
