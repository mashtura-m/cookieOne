export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'not_found');
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg, 'forbidden');
export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request');
export const conflict = (msg: string) => new HttpError(409, msg, 'conflict');
