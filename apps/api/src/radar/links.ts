/**
 * Invitation links. An operator who accepts a Radar lead gets a link for the owner; the link carries the lead's id
 * signed with the deployment's secret. A submission that arrives with a valid link is published without a second
 * approval: the operator already vouched for it by sending the invitation.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config'

const sign = (payload: string) => createHmac('sha256', config.linkSecret).update(payload).digest('base64url')

export function signInvitation(candidateId: string): string {
  const payload = Buffer.from(candidateId, 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** The lead's id when the token is ours and intact, otherwise null. */
export function verifyInvitation(token: string): string | null {
  const [payload, signature, ...rest] = token.split('.')
  if (!payload || !signature || rest.length > 0) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return Buffer.from(payload, 'base64url').toString('utf8')
}

export const invitationUrl = (candidateId: string) => `${config.publicWebUrl}/dostawca?zaproszenie=${signInvitation(candidateId)}`
