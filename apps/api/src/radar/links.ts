/**
 * Signed links. The payload says what the link is for, so one kind of link never works as another:
 *
 * - invite: an operator who accepts a Radar lead gets a link for the owner. A submission that arrives with a valid
 *   link is published without a second approval: the operator already vouched for it by sending the invitation.
 * - owner: the keeper of one device manages its passport (expiry dates, "Potwierdzam sprawność"). The version
 *   kept with the passport is part of the payload; raising it revokes every link given out before.
 * - session: a keeper who logged in. The id is the account, and the number is when the session ends (Unix seconds).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config'

export type LinkPurpose = 'invite' | 'owner' | 'session'

const sign = (payload: string) => createHmac('sha256', config.linkSecret).update(payload).digest('base64url')

export function signLink(purpose: LinkPurpose, id: string, version = 0): string {
  const payload = Buffer.from(`${purpose}:${version}:${id}`, 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** `{id, version}` when the token is ours, intact and made for `purpose`; otherwise null. */
export function verifyLink(purpose: LinkPurpose, token: string): { id: string; version: number } | null {
  const [payload, signature, ...rest] = token.split('.')
  if (!payload || !signature || rest.length > 0) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const match = /^([a-z]+):(\d+):(.+)$/s.exec(Buffer.from(payload, 'base64url').toString('utf8'))
  if (!match || match[1] !== purpose) return null
  return { id: match[3]!, version: Number(match[2]) }
}

export const signInvitation = (candidateId: string): string => signLink('invite', candidateId)

/** The lead's id when the token is an intact invitation, otherwise null. */
export const verifyInvitation = (token: string): string | null => verifyLink('invite', token)?.id ?? null

export const invitationUrl = (candidateId: string) => `${config.publicWebUrl}/dostawca?zaproszenie=${signInvitation(candidateId)}`

export const ownerToken = (aedId: string, version: number): string => signLink('owner', aedId, version)

/** The page where the keeper manages the passport of one device. */
export const ownerUrl = (aedId: string, version: number) => `${config.publicWebUrl}/opiekun?t=${ownerToken(aedId, version)}`

/** The public page the sticker's QR code leads to. */
export const passportUrl = (aedId: string) => `${config.publicWebUrl}/aed/${aedId}`

/** The sticker with the QR code, ready to print. */
export const stickerUrl = (aedId: string) => `${config.publicWebUrl}/aed/${aedId}/naklejka`

/** Devices on one A4 sticker sheet link; the ids travel in the address, so it stays short enough for any client. */
export const STICKERS_PER_SHEET = 40

/** A4 sheets with the stickers of several devices, four to a page, at most 40 devices per link. */
export function stickerSheetUrls(aedIds: readonly string[]): string[] {
  const urls: string[] = []
  for (let start = 0; start < aedIds.length; start += STICKERS_PER_SHEET) urls.push(`${config.publicWebUrl}/naklejki?id=${aedIds.slice(start, start + STICKERS_PER_SHEET).join(',')}`)
  return urls
}
