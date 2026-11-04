export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const fail = (status, code, message) => { throw new ApiError(status, code, message) }

// Only application-owned messages cross the HTTP boundary, never raw provider errors.
export function publicError(error) {
  return error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.')
}
