/** Passport endpoints: the public page behind the sticker, reports of passers-by, and the keeper's panel. */
import type { RouteHandler } from '@hono/zod-openapi'
import { reachableNow } from '@aed/schema'
import type { Context } from 'hono'
import { config, now, today } from '../config'
import { getContext } from '../context'
import type {
  adminOwnerLinkRoute,
  outboxRoute,
  ownerConfirmRoute,
  ownerLinkRequestRoute,
  ownerPassportRoute,
  ownerUpdateRoute,
  passportRoute,
  reportRoute,
} from '../contract'
import type { Store } from '../db/store'
import { requireOperator } from '../handlers'
import { ApiError } from '../http/errors'
import type { MergedAed } from '../pipeline/merge'
import { ownerUrl, passportUrl, stickerUrl, verifyLink } from '../radar/links'
import { fieldReport, publicPassport, sendOwnerLink, updatePassport } from './service'

/** Devices that may carry a sticker: anything shown on the public map or waiting for approval. */
async function device(id: string): Promise<{ store: Store; aed: MergedAed }> {
  const { store } = await getContext()
  const aed = store.get(id)
  if (!aed || aed.publication === 'incomplete') throw new ApiError(404, 'not_found', 'Nie znamy defibrylatora o tym numerze. Sprawdź, czy adres z naklejki przepisał się w całości.')
  return { store, aed }
}

/**
 * Who is asking, for the report limits. Our proxy appends the address it saw to X-Forwarded-For, so the entry
 * TRUSTED_PROXY_HOPS from the end is the client; earlier entries come from the client itself and prove nothing.
 */
export function client(c: Context): string {
  const socket = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress
  const forwarded = (c.req.header('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (config.trustedProxyHops > 0 && forwarded.length > 0) return forwarded[Math.max(0, forwarded.length - config.trustedProxyHops)]!
  return socket || 'unknown'
}

export const passportHandler: RouteHandler<typeof passportRoute> = async (c) => {
  const { store, aed } = await device(c.req.valid('param').id)
  return c.json(publicPassport(store, aed, now(), today()), 200)
}

export const reportHandler: RouteHandler<typeof reportRoute> = async (c) => {
  const { store, aed } = await device(c.req.valid('param').id)
  const { kind, note } = c.req.valid('json')
  const outcome = await fieldReport(store, aed, kind, note?.trim() || null, client(c), now(), today())
  return c.json({ outcome, passport: publicPassport(store, aed, now(), today()) }, 200)
}

export const ownerLinkRequestHandler: RouteHandler<typeof ownerLinkRequestRoute> = async (c) => {
  const { store, aed } = await device(c.req.valid('param').id)
  const result = await sendOwnerLink(store, aed, now())
  if (result === 'no_email') throw new ApiError(409, 'conflict', 'W danych tego defibrylatora nie ma adresu e-mail opiekuna. Napisz do operatora serwisu, a przygotuje link.')
  if (result === 'too_soon') throw new ApiError(409, 'conflict', 'Link wysłaliśmy kilka minut temu. Sprawdź skrzynkę, także folder z niechcianą pocztą.')
  return c.json(result, 200)
}

// ---------------------------------------------------------------------- owner

async function owner(token: string): Promise<{ store: Store; aed: MergedAed }> {
  const link = verifyLink('owner', token)
  const { store } = await getContext()
  const aed = link ? store.get(link.id) : undefined
  if (!link || !aed || link.version !== (store.passports.get(link.id)?.linkVersion ?? 0)) {
    throw new ApiError(401, 'unauthorized', 'Ten link jest nieprawidłowy albo został unieważniony. Poproś o nowy na stronie urządzenia.')
  }
  return { store, aed }
}

function ownerView(store: Store, aed: MergedAed) {
  const passport = store.passports.getOrEmpty(aed.id)
  return {
    aed: { id: aed.id, publication: aed.publication, quality: aed.quality, distanceM: null, availableNow: reachableNow(aed.record, new Date(now())), record: aed.record },
    passport: {
      electrodesExp: passport.electrodesExp,
      electrodesChildExp: passport.electrodesChildExp,
      batteryExp: passport.batteryExp,
      status: passport.status,
      confirmedAt: passport.confirmedAt,
      notifyEmail: passport.notifyEmail,
      notifyPhone: passport.notifyPhone,
    },
    public: publicPassport(store, aed, now(), today()),
    reports: [...store.passports.reportsOf(aed.id)]
      .reverse()
      .slice(0, 20)
      .map((report) => ({ kind: report.kind, note: report.note, at: report.at })),
    messages: store.passports
      .messagesOf(aed.id)
      .slice(-20)
      .reverse()
      .map((message) => ({ channel: message.channel, recipient: message.recipient, subject: message.subject, reason: message.reason, at: message.at, status: message.status })),
    stickerUrl: stickerUrl(aed.id),
  }
}

/** "+48 600-100-200", "600100200", "0048600100200" → "+48600100200". */
export function normalisePhone(value: string): string | null {
  let phone = value.replace(/[\s\-().]/g, '')
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`
  if (/^\d{9}$/.test(phone)) phone = `+48${phone}`
  return /^\+\d{9,15}$/.test(phone) ? phone : null
}

export const ownerPassportHandler: RouteHandler<typeof ownerPassportRoute> = async (c) => {
  const { store, aed } = await owner(c.req.valid('header')['x-owner-token'])
  return c.json(ownerView(store, aed), 200)
}

export const ownerUpdateHandler: RouteHandler<typeof ownerUpdateRoute> = async (c) => {
  const { store, aed } = await owner(c.req.valid('header')['x-owner-token'])
  const body = c.req.valid('json')
  const change: Parameters<typeof updatePassport>[2] = {}
  for (const key of ['electrodesExp', 'electrodesChildExp', 'batteryExp', 'status'] as const) {
    if (body[key] !== undefined) (change as Record<string, unknown>)[key] = body[key]
  }
  if (body.notifyEmail !== undefined) {
    const email = body.notifyEmail?.trim() || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, 'validation_error', 'Adres e-mail wygląda na niepełny.', [{ path: 'notifyEmail', message: 'Wpisz adres w postaci nazwa@domena.pl.' }])
    change.notifyEmail = email
  }
  if (body.notifyPhone !== undefined) {
    const raw = body.notifyPhone?.trim() || null
    const phone = raw ? normalisePhone(raw) : null
    if (raw && !phone) throw new ApiError(422, 'validation_error', 'Numer telefonu wygląda na niepełny.', [{ path: 'notifyPhone', message: 'Wpisz 9 cyfr numeru komórkowego, np. 600 100 200.' }])
    change.notifyPhone = phone
  }
  await updatePassport(store, aed.id, change, today(), 'keeper', 'passport_updated')
  return c.json(ownerView(store, aed), 200)
}

export const ownerConfirmHandler: RouteHandler<typeof ownerConfirmRoute> = async (c) => {
  const { store, aed } = await owner(c.req.valid('header')['x-owner-token'])
  await updatePassport(store, aed.id, { confirmedAt: today(), status: 'czynny' }, today(), 'keeper', 'passport_confirmed')
  return c.json(ownerView(store, aed), 200)
}

// ---------------------------------------------------------------------- admin

export const adminOwnerLinkHandler: RouteHandler<typeof adminOwnerLinkRoute> = async (c) => {
  requireOperator(c)
  const { store, aed } = await device(c.req.valid('param').id)
  const rotate = c.req.header('Content-Type')?.includes('application/json') ? c.req.valid('json').rotate : false
  let version = store.passports.get(aed.id)?.linkVersion ?? 0
  if (rotate) {
    version++
    await store.passports.save({ ...store.passports.getOrEmpty(aed.id), linkVersion: version })
    await store.log({ actor: 'operator', entity: 'aed', entityId: aed.id, action: 'owner_links_revoked', detail: { version } })
  }
  return c.json({ ownerUrl: ownerUrl(aed.id, version), passportUrl: passportUrl(aed.id), stickerUrl: stickerUrl(aed.id) }, 200)
}

export const outboxHandler: RouteHandler<typeof outboxRoute> = async (c) => {
  requireOperator(c)
  const { store } = await getContext()
  const { limit } = c.req.valid('query')
  return c.json({ items: store.passports.outbox.slice(-limit).reverse() }, 200)
}
