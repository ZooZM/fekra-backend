import { UnprocessableEntityException } from '@nestjs/common';

/**
 * A 422 for one field, in the same shape as a Zod validation failure, so a form can show it on
 * that field. For rules that need stored data and cannot live in a schema (for example "this offer
 * belongs to another client").
 */
export function fieldError(
  field: string,
  message: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    message: 'Validation failed',
    errorCode: 'INPUT_VALIDATION_ERROR',
    details: { formErrors: [], fieldErrors: { [field]: [message] } },
  });
}
