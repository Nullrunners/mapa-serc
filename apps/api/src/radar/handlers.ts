/** Radar endpoints: the queue of leads and the operator's decision on each. */
import type { RouteHandler } from '@hono/zod-openapi'
import { getContext } from '../context'
import type { candidateDecisionRoute, candidatesRoute } from '../contract'
import { requireOperator } from '../handlers'
import { ApiError } from '../http/errors'
import { rank } from './build'
import { invitationUrl } from './links'

export const candidatesHandler: RouteHandler<typeof candidatesRoute> = async (c) => {
  const { store } = await getContext()
  const { status, kind, limit } = c.req.valid('query')
  const matching = rank(store.candidates.filter((candidate) => (!status || candidate.status === status) && (!kind || candidate.kind === kind)))
  return c.json({ stub: false, total: matching.length, items: matching.slice(0, limit) }, 200)
}

export const candidateDecisionHandler: RouteHandler<typeof candidateDecisionRoute> = async (c) => {
  requireOperator(c)
  const { store } = await getContext()
  const { id } = c.req.valid('param')
  const { decision } = c.req.valid('json')
  const candidate = await store.setCandidateStatus(id, decision === 'reject' ? 'rejected' : 'invited')
  if (!candidate) throw new ApiError(404, 'not_found', `No lead with id ${id}.`)
  await store.log({ actor: 'operator', entity: 'candidate', entityId: id, action: decision === 'reject' ? 'lead_rejected' : 'lead_invited', detail: { title: candidate.title } })
  return c.json({ stub: false, candidate, confirmationUrl: decision === 'invite' ? invitationUrl(id) : null }, 200)
}
