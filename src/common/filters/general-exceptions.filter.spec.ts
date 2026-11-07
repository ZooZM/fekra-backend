import { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { GeneralExceptionsFilter } from './general-exceptions.filter';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('db error', {
    code,
    clientVersion: 'test',
  });

describe('GeneralExceptionsFilter', () => {
  const filter = new GeneralExceptionsFilter();

  const respond = (exception: unknown) => {
    const res = {
      headersSent: false,
      status: jest.fn<unknown, [number]>().mockReturnThis(),
      json: jest.fn<void, [Record<string, unknown>]>(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ method: 'PUT', url: '/clients/x/access-token' }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return {
      status: res.status.mock.calls[0][0],
      body: res.json.mock.calls[0][0],
    };
  };

  it.each([
    [
      'P2007',
      'pg adapter: invalid input syntax (e.g. a page id where a UUID is expected)',
    ],
    ['P2020', 'pg adapter: value out of range'],
    ['P2023', 'classic engine: inconsistent column data'],
  ])('maps %s (%s) to a 400 instead of a 500', (code) => {
    expect(respond(prismaError(code))).toEqual({
      status: 400,
      body: {
        statusCode: 400,
        message: 'Invalid value',
        errorCode: 'CAST_ERROR',
      },
    });
  });

  it('still answers 500 for unknown errors, without leaking the message', () => {
    const { status, body } = respond(new Error('secret internals'));
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
  });
});
