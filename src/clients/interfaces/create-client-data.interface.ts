// clients/interfaces/create-client-data.interface.ts  (replaces the file with `any`)
import { CreateClientInput } from '../schemas/client.schema';

/** What the repository stores. id is generated first, the tokens are already encrypted. */
export type CreateClientData = Omit<
  CreateClientInput,
  'accessToken' | 'instaAccessToken'
> & {
  id: string;
  accessToken: string | null;
  instaAccessToken: string | null;
};
