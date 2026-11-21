/**
 * Who a keeper is, when they log in "with mObywatel" instead of carrying an owner link around.
 *
 * In a real deployment the identity comes from login.gov.pl (Węzeł Krajowy), where a person confirms the login in
 * the mObywatel app; the service gets a signed statement with the first name, surname and PESEL. Connecting a service
 * takes integration tests, an application and the minister's consent (gov.pl/web/login/dla-integratorow), so this
 * prototype has a stand-in: a few made-up people to pick from. Everything after `signIn` (accounts, sessions,
 * devices of an account) does not care which of the two produced the `Identity`.
 *
 * Logging in says who somebody is, not that a device is theirs. A device joins an account only when the person also
 * holds its owner link (src/radar/links.ts), which goes to the institution's address or comes from the operator.
 */
import { createHmac } from 'node:crypto'
import { config, now } from '../config'
import type { IdentityProviderId, KeeperAccount } from '../db/keepers'
import type { Store } from '../db/store'
import { signLink, verifyLink } from '../radar/links'

export interface Identity {
  provider: IdentityProviderId
  /** The provider's stable identifier of the person; from login.gov.pl the PESEL. Hashed before it is stored. */
  subject: string
  firstName: string
  lastName: string
}

/** People of the stand-in provider. The surnames say what they are, so nobody takes them for real keepers. */
export const DEMO_PEOPLE: readonly { id: string; firstName: string; lastName: string }[] = [
  { id: 'anna', firstName: 'Anna', lastName: 'Przykładowa' },
  { id: 'jan', firstName: 'Jan', lastName: 'Pokazowy' },
  { id: 'maria', firstName: 'Maria', lastName: 'Testowa' },
]

export function demoIdentity(personId: string): Identity | null {
  const person = DEMO_PEOPLE.find((entry) => entry.id === personId)
  return person ? { provider: 'demo', subject: `demo:${person.id}`, firstName: person.firstName, lastName: person.lastName } : null
}

/** "Anna P.": enough for co-workers to know who it was, without the full surname in our database. */
export const shortName = (firstName: string, lastName: string) => `${firstName} ${lastName.charAt(0)}.`

const subjectKey = (identity: Identity) => createHmac('sha256', config.linkSecret).update(`keeper|${identity.provider}|${identity.subject}`).digest('hex')

export const SESSION_HOURS = 12

export interface Session {
  token: string
  expiresAt: string
  account: KeeperAccount
}

/** Finds or creates the account of an identified person and opens a session for it. */
export async function signIn(store: Store, identity: Identity): Promise<Session> {
  const account = await store.keepers.signIn(identity.provider, subjectKey(identity), shortName(identity.firstName, identity.lastName), now())
  const expires = Math.floor(Date.parse(now()) / 1000) + SESSION_HOURS * 3600
  return { token: signLink('session', account.id, expires), expiresAt: new Date(expires * 1000).toISOString(), account }
}

/** The account a session token belongs to, or null when the token is not ours, has ended, or login is switched off. */
export function sessionAccount(store: Store, token: string | undefined): KeeperAccount | null {
  if (!token || config.login === 'off') return null
  const session = verifyLink('session', token)
  if (!session || session.version * 1000 <= Date.parse(now())) return null
  const account = store.keepers.get(session.id)
  // An account made by the stand-in must not outlive it: once real login is in place, demo people get nothing.
  return account && (account.provider !== 'demo' || config.login === 'demo') ? account : null
}
