/**
 * Whether the server is answering somebody right now. Long work in the background (counting the gaps of the whole
 * country) looks here and steps aside, so the people using the site do not wait for it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

let answering = 0

/** True from the moment a request comes in until its answer has gone out, a large file being sent included. */
export const isAnswering = (): boolean => answering > 0

/** Counts the requests of a Node HTTP server; hook it up once, next to the handler that answers them. */
export function watchRequests(server: { on(event: 'request', listener: (request: IncomingMessage, response: ServerResponse) => void): unknown }): void {
  server.on('request', (_request, response) => {
    answering++
    // "close" comes once for every response: after it was sent, or when the client went away before that.
    response.once('close', () => {
      answering--
    })
  })
}
