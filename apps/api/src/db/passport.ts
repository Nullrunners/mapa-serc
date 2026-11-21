/**
 * Storage of the device passports: the keeper's values, the reports of passers-by, the messages we sent and the
 * reminders already given. Kept apart from the `aed` table, which every pipeline run rewrites whole.
 */
import { randomUUID } from 'node:crypto'
import { emptyPassport, type FieldReport, type Item, type Passport, type ReportKind, type Window } from '../passport/model'
import type { Db } from './duck'

export type Channel = 'email' | 'sms'
export type DeliveryStatus = 'sent' | 'logged' | 'failed'

export interface OutboxMessage {
  id: string
  aedId: string | null
  channel: Channel
  recipient: string
  subject: string
  body: string
  /** owner_link, reminder, problem_report, test */
  reason: string
  at: string
  status: DeliveryStatus
  error: string | null
}

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))

export class PassportBook {
  private passports = new Map<string, Passport>()
  private reports = new Map<string, FieldReport[]>()
  private reminders = new Set<string>()
  outbox: OutboxMessage[] = []

  constructor(private readonly db: Db) {}

  async load(): Promise<void> {
    for (const row of await this.db.all<Record<string, unknown>>('SELECT * FROM passport')) {
      this.passports.set(String(row.aed_id), {
        aedId: String(row.aed_id),
        electrodesExp: text(row.electrodes_exp),
        electrodesChildExp: text(row.electrodes_child_exp),
        batteryExp: text(row.battery_exp),
        status: text(row.status) as Passport['status'],
        confirmedAt: text(row.confirmed_at),
        notifyEmail: text(row.notify_email),
        notifyPhone: text(row.notify_phone),
        linkVersion: Number(row.link_version ?? 0),
        updatedAt: String(row.updated_at ?? ''),
      })
    }
    for (const row of await this.db.all<Record<string, unknown>>('SELECT * FROM field_reports ORDER BY created_at')) {
      this.addReport({ id: String(row.id), aedId: String(row.aed_id), kind: row.kind as ReportKind, note: text(row.note), at: String(row.created_at), clientHash: String(row.client_hash) })
    }
    for (const row of await this.db.all<Record<string, unknown>>('SELECT aed_id, item, due_date, win FROM reminders_sent')) {
      this.reminders.add(reminderKey(String(row.aed_id), row.item as Item, String(row.due_date), row.win as Window))
    }
    this.outbox = (await this.db.all<Record<string, unknown>>('SELECT * FROM outbox ORDER BY created_at')).map((row) => ({
      id: String(row.id),
      aedId: text(row.aed_id),
      channel: row.channel as Channel,
      recipient: String(row.recipient),
      subject: String(row.subject ?? ''),
      body: String(row.body ?? ''),
      reason: String(row.reason),
      at: String(row.created_at),
      status: row.status as DeliveryStatus,
      error: text(row.error),
    }))
  }

  get(aedId: string): Passport | undefined {
    return this.passports.get(aedId)
  }

  all(): Passport[] {
    return [...this.passports.values()]
  }

  async save(passport: Passport): Promise<Passport> {
    const saved = { ...passport, updatedAt: new Date().toISOString() }
    await this.db.replace(
      'passport',
      ['aed_id', 'electrodes_exp', 'electrodes_child_exp', 'battery_exp', 'status', 'confirmed_at', 'notify_email', 'notify_phone', 'link_version', 'updated_at'],
      [[saved.aedId, saved.electrodesExp, saved.electrodesChildExp, saved.batteryExp, saved.status, saved.confirmedAt, saved.notifyEmail, saved.notifyPhone, saved.linkVersion, saved.updatedAt]],
      { sql: 'DELETE FROM passport WHERE aed_id = ?', params: [saved.aedId] },
    )
    this.passports.set(saved.aedId, saved)
    return saved
  }

  /** The passport, or a blank one that is not stored until something is saved. */
  getOrEmpty(aedId: string): Passport {
    return this.passports.get(aedId) ?? emptyPassport(aedId)
  }

  reportsOf(aedId: string): readonly FieldReport[] {
    return this.reports.get(aedId) ?? []
  }

  /** Reports one person (hash) sent on one day, over all devices. */
  reportsByClientOn(clientHash: string, day: string): number {
    let count = 0
    for (const list of this.reports.values()) for (const report of list) if (report.clientHash === clientHash && report.at.startsWith(day)) count++
    return count
  }

  private addReport(report: FieldReport): void {
    const list = this.reports.get(report.aedId)
    if (list) list.push(report)
    else this.reports.set(report.aedId, [report])
  }

  async report(entry: Omit<FieldReport, 'id'>): Promise<FieldReport> {
    const report = { ...entry, id: randomUUID() }
    await this.db.run('INSERT INTO field_reports (id, aed_id, kind, note, created_at, client_hash) VALUES (?, ?, ?, ?, ?, ?)', [
      report.id,
      report.aedId,
      report.kind,
      report.note,
      report.at,
      report.clientHash,
    ])
    this.addReport(report)
    return report
  }

  reminderSent(aedId: string, item: Item, dueDate: string, window: Window): boolean {
    return this.reminders.has(reminderKey(aedId, item, dueDate, window))
  }

  async markReminder(aedId: string, item: Item, dueDate: string, window: Window): Promise<void> {
    await this.db.run('INSERT INTO reminders_sent (aed_id, item, due_date, win, sent_at) VALUES (?, ?, ?, ?, ?)', [aedId, item, dueDate, window, new Date().toISOString()])
    this.reminders.add(reminderKey(aedId, item, dueDate, window))
  }

  async record(message: Omit<OutboxMessage, 'id'>): Promise<OutboxMessage> {
    const saved = { ...message, id: randomUUID() }
    await this.db.run('INSERT INTO outbox (id, aed_id, channel, recipient, subject, body, reason, created_at, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      saved.id,
      saved.aedId,
      saved.channel,
      saved.recipient,
      saved.subject,
      saved.body,
      saved.reason,
      saved.at,
      saved.status,
      saved.error,
    ])
    this.outbox.push(saved)
    return saved
  }

  messagesOf(aedId: string): OutboxMessage[] {
    return this.outbox.filter((message) => message.aedId === aedId)
  }
}

const reminderKey = (aedId: string, item: Item, dueDate: string, window: Window) => `${aedId}|${item}|${dueDate}|${window}`
