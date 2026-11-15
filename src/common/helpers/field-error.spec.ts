import { UnprocessableEntityException } from '@nestjs/common';
import { fieldError } from './field-error';

describe('fieldError', () => {
  it('builds a 422 with the validation error code and the field errors', () => {
    const error = fieldError('offerId', 'Choose an offer of this client');

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual({
      message: 'Validation failed',
      errorCode: 'INPUT_VALIDATION_ERROR',
      details: {
        formErrors: [],
        fieldErrors: { offerId: ['Choose an offer of this client'] },
      },
    });
  });
});
