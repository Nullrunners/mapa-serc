/** Keeper account endpoints: how to log in, the stand-in login, the account with its devices, adding and removing a device. */
import type { RouteHandler } from '@hono/zod-openapi'
import { config, now, today } from '../config'
import { getContext } from '../context'
import type { accountLinkRoute, accountRoute, accountUnlinkRoute, demoLoginRoute, loginOptionsRoute } from '../contract'
import type { KeeperAccount } from '../db/keepers'
import type { Store } from '../db/store'
import { ApiError } from '../http/errors'
import { deviceOfOwnerLink } from '../passport/handlers'
import { publicPassport } from '../passport/service'
import { DEMO_PEOPLE, demoIdentity, sessionAccount, signIn } from './identity'

function accountView(store: Store, account: KeeperAccount) {
  return {
    name: account.name,
    provider: account.provider,
    // A device that left the dataset since it was added stays on the account, in case it comes back, but is not shown.
    devices: store.keepers.devicesOf(account.id).flatMap((device) => {
      const aed = store.get(device.aedId)
      return aed && aed.publication !== 'incomplete' ? [publicPassport(store, aed, now(), today())] : []
    }),
  }
}

function loggedIn(store: Store, session: string): KeeperAccount {
  const account = sessionAccount(store, session)
  if (!account) throw new ApiError(401, 'unauthorized', 'Sesja wygasła. Zaloguj się jeszcze raz.')
  return account
}

export const loginOptionsHandler: RouteHandler<typeof loginOptionsRoute> = (c) => {
  const people = config.login === 'demo' ? DEMO_PEOPLE.map((person) => ({ id: person.id, name: `${person.firstName} ${person.lastName}` })) : []
  return c.json({ mode: config.login, people }, 200)
}

export const demoLoginHandler: RouteHandler<typeof demoLoginRoute> = async (c) => {
  if (config.login !== 'demo') throw new ApiError(409, 'conflict', 'Logowanie pokazowe jest w tym serwisie wyłączone.')
  const identity = demoIdentity(c.req.valid('json').person)
  if (!identity) throw new ApiError(422, 'validation_error', 'Nie ma takiej przykładowej osoby.', [{ path: 'person', message: 'Wybierz jedną z osób z listy.' }])
  const { store } = await getContext()
  const session = await signIn(store, identity)
  return c.json({ session: session.token, expiresAt: session.expiresAt, account: accountView(store, session.account) }, 200)
}

export const accountHandler: RouteHandler<typeof accountRoute> = async (c) => {
  const { store } = await getContext()
  return c.json(accountView(store, loggedIn(store, c.req.valid('header')['x-keeper-session'])), 200)
}

export const accountLinkHandler: RouteHandler<typeof accountLinkRoute> = async (c) => {
  const { store } = await getContext()
  const headers = c.req.valid('header')
  const account = loggedIn(store, headers['x-keeper-session'])
  const aed = deviceOfOwnerLink(store, headers['x-owner-token'])
  if (await store.keepers.link(account.id, aed.id, now())) {
    await store.log({ actor: `keeper:${account.id}`, entity: 'aed', entityId: aed.id, action: 'keeper_linked', detail: { name: account.name, provider: account.provider } })
  }
  return c.json(accountView(store, account), 200)
}

export const accountUnlinkHandler: RouteHandler<typeof accountUnlinkRoute> = async (c) => {
  const { store } = await getContext()
  const account = loggedIn(store, c.req.valid('header')['x-keeper-session'])
  const { id } = c.req.valid('param')
  if (await store.keepers.unlink(account.id, id)) {
    await store.log({ actor: `keeper:${account.id}`, entity: 'aed', entityId: id, action: 'keeper_unlinked', detail: { name: account.name } })
  }
  return c.json(accountView(store, account), 200)
}
