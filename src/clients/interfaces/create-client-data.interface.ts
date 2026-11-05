// clients/interfaces/create-client-data.interface.ts  (replaces the file with `any`)
import { CreateClientInput } from '../schemas/client.schema';

/** What the repository stores. id is generated first, accessToken is already encrypted. */
export type CreateClientData = Omit<CreateClientInput, 'accessToken'> & {
  id: string;
  accessToken: string;
};
