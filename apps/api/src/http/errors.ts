/** One error type for the whole API, rendered as RFC 9457 problem+json. */
import type { Context } from 'hono'

export type ErrorCode = 'validation_error' | 'not_found' | 'unauthorized' | 'file_unreadable' | 'conflict' | 'unavailable' | 'internal_error'
export type ProblemStatus = 400 | 401 | 404 | 409 | 422 | 500 | 503

export interface Issue {
  path: string
  message: string
}

/** Throw this anywhere below a handler; app.onError turns it into a problem response. */
export class ApiError extends Error {
  constructor(
    readonly status: ProblemStatus,
    readonly code: ErrorCode,
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const TITLES: Record<ErrorCode, string> = {
  validation_error: 'Request validation failed',
  not_found: 'Not found',
  unauthorized: 'Operator token required',
  file_unreadable: 'The file could not be read',
  conflict: 'Conflict with the current state',
  unavailable: 'Temporarily unavailable',
  internal_error: 'Internal error',
}

export function problemResponse(c: Context, status: ProblemStatus, code: ErrorCode, detail: string | null, issues: Issue[] = []) {
  return c.json({ type: `urn:aed-hub:problem:${code}`, title: TITLES[code], status, code, detail, issues }, status, {
    'Content-Type': 'application/problem+json',
  })
}
