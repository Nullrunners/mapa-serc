/** Send a JSON body only after it passes the contract schema, so the API cannot emit a shape the frontend was not promised. */
import type { Context } from 'hono'
import type { z } from '@hono/zod-openapi'
import { ApiError } from './errors'

export function ok<S extends z.ZodType>(c: Context, schema: S, body: z.input<S>) {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    // A bug on our side (for example NaN from a division by zero). Log the detail, never leak a malformed body.
    console.error(`[contract] ${c.req.method} ${c.req.path} produced a response that violates its schema`, parsed.error.issues.slice(0, 5))
    throw new ApiError(500, 'internal_error', 'The server produced a response that does not match its contract.')
  }
  return c.json(parsed.data as z.output<S>, 200)
}
