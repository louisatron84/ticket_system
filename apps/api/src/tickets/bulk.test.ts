import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { failureOf } from './bulk';

describe('how a refusal reads in a bulk result', () => {
  it('uses the first issue for a validation failure, which names the real problem', () => {
    const error = new AppError('validation_failed', 'Some of the values are not available.', 422, [
      { path: 'statusId', message: "That move isn't allowed from Quenched." },
      { path: 'priorityId', message: 'Unknown priority.' },
    ]);
    expect(failureOf(error)).toEqual({
      code: 'validation_failed',
      message: "That move isn't allowed from Quenched.",
    });
  });

  it('keeps the error’s own message for anything else, even when it carries issues', () => {
    const conflict = new AppError(
      'conflict',
      'This ticket was changed by someone else. Reload it to see the latest version.',
      409,
      [{ path: 'version', message: 'The ticket is now at version 3.' }],
    );
    expect(failureOf(conflict)).toEqual({ code: 'conflict', message: conflict.message });
    const archived = new AppError('conflict', 'This ticket is archived.', 409);
    expect(failureOf(archived).message).toBe('This ticket is archived.');
  });

  it('keeps the error’s own message for a validation failure without issues', () => {
    expect(failureOf(new AppError('validation_failed', 'Bad.', 422))).toEqual({
      code: 'validation_failed',
      message: 'Bad.',
    });
  });
});
