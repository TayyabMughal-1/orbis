/**
 * One error type for the whole API.
 *
 * `code` is what the storefront switches on and what shows up in logs;
 * `status` is what the HTTP layer sends. Anything thrown that is not an
 * ApiError becomes a 500 with a generic message — internal details never
 * reach a customer.
 */
export class ApiError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details)

export const notFound = (code: string, message: string) => new ApiError(404, code, message)

export const conflict = (code: string, message: string) => new ApiError(409, code, message)

export const tooMany = (message: string) => new ApiError(429, 'rate_limited', message)
