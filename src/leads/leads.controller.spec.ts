import { GUARDS_METADATA } from '@nestjs/common/constants';
import { N8nSecretGuard } from '@common/guards/n8n-secret.guard';
import { LeadsController } from './leads.controller';

describe('LeadsController', () => {
  let leads: { context: jest.Mock; upsert: jest.Mock };
  let controller: LeadsController;

  beforeEach(() => {
    leads = { context: jest.fn(), upsert: jest.fn() };
    controller = new LeadsController(leads as never);
  });

  it('takes no JWT: every route is guarded by the n8n shared secret', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, LeadsController)).toEqual([
      N8nSecretGuard,
    ]);
  });

  it('hands the context query to the service', async () => {
    const query = { clientId: 'c1', historyLimit: 10 } as never;
    const context = { lead: null, history: [] };
    leads.context.mockResolvedValue(context);

    await expect(controller.context(query)).resolves.toBe(context);
    expect(leads.context).toHaveBeenCalledWith(query);
  });

  it('hands the save to the service', async () => {
    const body = { clientId: 'c1', stage: 'new' } as never;
    const result = { lead: { id: 'l1' }, notifiedNow: false };
    leads.upsert.mockResolvedValue(result);

    await expect(controller.upsert(body)).resolves.toBe(result);
    expect(leads.upsert).toHaveBeenCalledWith(body);
  });
});
