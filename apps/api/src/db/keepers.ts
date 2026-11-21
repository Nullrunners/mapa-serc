/**
 * Storage of keeper accounts: who logged in, and which devices each of them looks after. We keep a first name with
 * the initial of the surname and a keyed hash of the identifier the identity provider gave; never the identifier.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from './duck'

export type IdentityProviderId = 'demo' | 'login.gov.pl'

export interface KeeperAccount {
  id: string
  provider: IdentityProviderId
  /** Keyed hash of the provider's identifier of the person (for login.gov.pl: the PESEL). */
  subjectKey: string
  /** "Anna P." */
  name: string
  createdAt: string
  lastLoginAt: string
}

export interface KeeperDevice {
  accountId: string
  aedId: string
  linkedAt: string
}

export class KeeperBook {
  private accounts = new Map<string, KeeperAccount>()
  private bySubject = new Map<string, KeeperAccount>()
  private devices: KeeperDevice[] = []

  constructor(private readonly db: Db) {}

  async load(): Promise<void> {
    for (const row of await this.db.all<Record<string, unknown>>('SELECT * FROM keeper_account')) {
      this.remember({
        id: String(row.id),
        provider: row.provider as IdentityProviderId,
        subjectKey: String(row.subject_key),
        name: String(row.name),
        createdAt: String(row.created_at),
        lastLoginAt: String(row.last_login_at),
      })
    }
    this.devices = (await this.db.all<Record<string, unknown>>('SELECT * FROM keeper_device ORDER BY linked_at')).map((row) => ({
      accountId: String(row.account_id),
      aedId: String(row.aed_id),
      linkedAt: String(row.linked_at),
    }))
  }

  private remember(account: KeeperAccount): void {
    this.accounts.set(account.id, account)
    this.bySubject.set(account.subjectKey, account)
  }

  get(id: string): KeeperAccount | undefined {
    return this.accounts.get(id)
  }

  /** The account of this person, created at their first login. */
  async signIn(provider: IdentityProviderId, subjectKey: string, name: string, nowIso: string): Promise<KeeperAccount> {
    const known = this.bySubject.get(subjectKey)
    const account: KeeperAccount = known ? { ...known, name, lastLoginAt: nowIso } : { id: randomUUID(), provider, subjectKey, name, createdAt: nowIso, lastLoginAt: nowIso }
    await this.db.replace(
      'keeper_account',
      ['id', 'provider', 'subject_key', 'name', 'created_at', 'last_login_at'],
      [[account.id, account.provider, account.subjectKey, account.name, account.createdAt, account.lastLoginAt]],
      { sql: 'DELETE FROM keeper_account WHERE id = ?', params: [account.id] },
    )
    this.remember(account)
    return account
  }

  isKeeper(accountId: string, aedId: string): boolean {
    return this.devices.some((device) => device.accountId === accountId && device.aedId === aedId)
  }

  /** Devices of one account, oldest link first. */
  devicesOf(accountId: string): KeeperDevice[] {
    return this.devices.filter((device) => device.accountId === accountId)
  }

  /** Who may manage a device after logging in. */
  keepersOf(aedId: string): { account: KeeperAccount; linkedAt: string }[] {
    return this.devices.flatMap((device) => {
      const account = device.aedId === aedId ? this.accounts.get(device.accountId) : undefined
      return account ? [{ account, linkedAt: device.linkedAt }] : []
    })
  }

  /** Adds a device to an account; false when it was there already. */
  async link(accountId: string, aedId: string, nowIso: string): Promise<boolean> {
    if (this.isKeeper(accountId, aedId)) return false
    await this.db.run('INSERT INTO keeper_device (account_id, aed_id, linked_at) VALUES (?, ?, ?)', [accountId, aedId, nowIso])
    this.devices.push({ accountId, aedId, linkedAt: nowIso })
    return true
  }

  /** Takes a device off one account; false when it was not there. */
  async unlink(accountId: string, aedId: string): Promise<boolean> {
    if (!this.isKeeper(accountId, aedId)) return false
    await this.db.run('DELETE FROM keeper_device WHERE account_id = ? AND aed_id = ?', [accountId, aedId])
    this.devices = this.devices.filter((device) => !(device.accountId === accountId && device.aedId === aedId))
    return true
  }

  /** Takes a device away from every account; returns how many had it. */
  async unlinkDevice(aedId: string): Promise<number> {
    const before = this.devices.length
    await this.db.run('DELETE FROM keeper_device WHERE aed_id = ?', [aedId])
    this.devices = this.devices.filter((device) => device.aedId !== aedId)
    return before - this.devices.length
  }
}
