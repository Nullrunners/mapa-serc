/**
 * Cyfrowy Paszport AED: what the keeper of a device tells us about it (expiry dates, "Potwierdzam sprawność"),
 * what passers-by report after scanning the sticker, and when the keeper should hear from us.
 * Pure functions only; storage is in src/db/passport.ts.
 */
import type { AedRecord, Status } from '@aed/schema'

export interface Passport {
  aedId: string
  electrodesExp: string | null
  electrodesChildExp: string | null
  batteryExp: string | null
  /** Status set by the keeper; null leaves the status from the sources. */
  status: Status | null
  /** Last "Potwierdzam sprawność" (YYYY-MM-DD). */
  confirmedAt: string | null
  /** Account of the keeper who made it while logged in; null when they came in by the owner link alone. */
  confirmedBy: string | null
  /** Private contact for reminders; never published, unlike `email_kontaktowy`. */
  notifyEmail: string | null
  notifyPhone: string | null
  /** Part of every owner link; raising it revokes the links given out before. */
  linkVersion: number
  updatedAt: string
}

export const emptyPassport = (aedId: string): Passport => ({
  aedId,
  electrodesExp: null,
  electrodesChildExp: null,
  batteryExp: null,
  status: null,
  confirmedAt: null,
  confirmedBy: null,
  notifyEmail: null,
  notifyPhone: null,
  linkVersion: 0,
  updatedAt: '',
})

export const REPORT_KINDS = ['ok', 'locked', 'missing', 'battery_alarm', 'damaged'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
export const PROBLEM_KINDS = REPORT_KINDS.filter((kind) => kind !== 'ok')

export const REPORT_TEXT: Record<ReportKind, string> = {
  ok: 'urządzenie jest na miejscu, zielona dioda miga',
  locked: 'szafka jest zamknięta',
  missing: 'urządzenia nie ma na miejscu',
  battery_alarm: 'urządzenie sygnalizuje problem z baterią',
  damaged: 'urządzenie albo szafka są uszkodzone',
}

export interface FieldReport {
  id: string
  aedId: string
  kind: ReportKind
  note: string | null
  at: string
  clientHash: string
}

export const ITEMS = ['electrodes', 'electrodes_child', 'battery'] as const
export type Item = (typeof ITEMS)[number]

export const ITEM_TEXT: Record<Item, string> = {
  electrodes: 'elektrody dla dorosłych',
  electrodes_child: 'elektrody dla dzieci',
  battery: 'bateria',
}

/** Reminders go this many days before the date; "expired" goes on the day after. */
export const WINDOWS = [30, 7] as const
export type Window = '30' | '7' | 'expired'

/** Expiry date of an item: what the keeper entered, else what the sources say. */
export function itemDate(item: Item, passport: Passport | undefined, record: AedRecord): string | null {
  switch (item) {
    case 'electrodes':
      return passport?.electrodesExp ?? record.termin_waznosci_elektrod
    case 'electrodes_child':
      return passport?.electrodesChildExp ?? record.termin_waznosci_elektrod_pediatrycznych
    case 'battery':
      return passport?.batteryExp ?? record.termin_waznosci_baterii
  }
}

const DAY_MS = 24 * 3600 * 1000
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)

export type ExpiryState = 'ok' | 'soon' | 'expired' | 'unknown'

export function expiryState(date: string | null, today: string): { state: ExpiryState; daysLeft: number | null } {
  if (!date) return { state: 'unknown', daysLeft: null }
  const daysLeft = daysBetween(today, date)
  return { state: daysLeft < 0 ? 'expired' : daysLeft <= WINDOWS[0] ? 'soon' : 'ok', daysLeft }
}

/** The reminder an item is due for today, or null. Checked as "at most N days left", so a missed day loses nothing. */
export function dueWindow(date: string, today: string): Window | null {
  const daysLeft = daysBetween(today, date)
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 7) return '7'
  if (daysLeft <= 30) return '30'
  return null
}

/** Fields of the published record the keeper's passport decides. */
export function passportOverride(passport: Passport): Partial<AedRecord> {
  const override: Partial<AedRecord> = {}
  if (passport.status) override.status = passport.status
  if (passport.confirmedAt) override.data_weryfikacji = passport.confirmedAt
  if (passport.electrodesExp) override.termin_waznosci_elektrod = passport.electrodesExp
  if (passport.electrodesChildExp) override.termin_waznosci_elektrod_pediatrycznych = passport.electrodesChildExp
  if (passport.batteryExp) override.termin_waznosci_baterii = passport.batteryExp
  return override
}

/** Provenance entry of a field the keeper set through the passport. */
export const PASSPORT_SOURCE = 'paszport'

/** Applies the keeper's values in place; true when something changed. */
export function applyOverride(record: AedRecord, provenance: Record<string, string>, override: Partial<AedRecord>): boolean {
  let changed = false
  for (const [field, value] of Object.entries(override) as [keyof AedRecord, unknown][]) {
    if (record[field] !== value) {
      ;(record as Record<string, unknown>)[field] = value
      changed = true
    }
    provenance[field] = PASSPORT_SOURCE
  }
  return changed
}

export interface ReportSummary {
  /** Last "it is here" from a passer-by. */
  lastOk: string | null
  okCount: number
  /**
   * Problems reported after the last confirmation by the keeper and after the last "it is here". `count` is the
   * number of people who reported it (one person counts once a day), not of clicks.
   */
  problems: { kind: ReportKind; count: number; lastAt: string }[]
}

/** What passers-by said in the last `days` days. */
export function summariseReports(reports: readonly FieldReport[], confirmedAt: string | null, nowIso: string, days = 30): ReportSummary {
  const since = new Date(Date.parse(nowIso) - days * DAY_MS).toISOString()
  const recent = reports.filter((report) => report.at >= since)
  const oks = recent.filter((report) => report.kind === 'ok')
  const lastOk = oks.reduce<string | null>((latest, report) => (latest === null || report.at > latest ? report.at : latest), null)
  // A confirmation is a date; a problem reported later that same day still counts.
  const settled = [lastOk, confirmedAt ? `${confirmedAt}T00:00:00.000Z` : null].filter((value): value is string => value !== null).sort().at(-1) ?? ''
  const open = new Map<ReportKind, { people: Set<string>; lastAt: string }>()
  for (const report of recent) {
    if (report.kind === 'ok' || report.at <= settled) continue
    const entry = open.get(report.kind) ?? { people: new Set<string>(), lastAt: report.at }
    entry.people.add(report.clientHash)
    if (report.at > entry.lastAt) entry.lastAt = report.at
    open.set(report.kind, entry)
  }
  return {
    lastOk,
    okCount: oks.length,
    problems: [...open].map(([kind, entry]) => ({ kind, count: entry.people.size, lastAt: entry.lastAt })).sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
  }
}

/** "k***@legionowo.pl": enough to recognise one's own address, not enough to harvest it. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  return `${local[0]}***@${domain}`
}
