import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ApiError } from '../lib/errors.js';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
}

/** Single exit point: the client never sees a stack trace or a raw model error. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  let apiError: ApiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else if (err instanceof MulterError) {
    apiError =
      err.code === 'LIMIT_FILE_SIZE' ? new ApiError('FILE_TOO_LARGE') : new ApiError('NO_IMAGE', err.message);
  } else {
    apiError = new ApiError('INTERNAL', err instanceof Error ? err.message : String(err));
  }

  if (apiError.status >= 500) console.error(`[${apiError.code}]`, apiError.message);
  res.status(apiError.status).json(apiError.toJSON());
}
