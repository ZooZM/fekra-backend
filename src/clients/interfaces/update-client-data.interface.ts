import { UpdateClientInput } from '../schemas/client.schema';

/** What the repository stores on an edit: no token (own endpoint) and no version (checked apart). */
export type UpdateClientData = Omit<UpdateClientInput, 'version'>;
