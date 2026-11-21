/**
 * What the passport endpoints and the reminders job do: the public summary of a device, reports from passers-by,
 * the keeper's changes, and the messages that go to the keeper.
 */
import { createHash } from 'node:crypto'
import { UNNAMED_PLACE, type AedRecord } from '@aed/schema'
import { config } from '../config'
import type { Store } from '../db/store'
import { send } from '../notify'
import type { MergedAed } from '../pipeline/merge'
import { ownerUrl, passportUrl } from '../radar/links'
import {
  dueWindow,
  expiryState,
  itemDate,
  ITEM_TEXT,
  ITEMS,
  maskEmail,
  PROBLEM_KINDS,
  REPORT_TEXT,
  summariseReports,
  type Item,
  type Passport,
  type ReportKind,
  type Window,
} from './model'

const HOUR_MS = 3600 * 1000

/** "2026-03-14" → "14.03.2026". */
export const plDate = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3.$2.$1')

/** What to call a device in a message: its name, or its address when nobody named it. */
export function deviceName(record: AedRecord): string {
  const street = [record.nazwa_ulicy, record.nr_budynku].filter(Boolean).join(' ')
  const address = [street, record.miejscowosc].filter(Boolean).join(', ')
  return record.nazwa === UNNAMED_PLACE && address ? address : record.nazwa
}

/** Where messages about a device go: the keeper's private contact, else the institution's address from the data. */
export function recipients(passport: Passport | undefined, record: AedRecord): { email: string | null; phone: string | null } {
  return { email: passport?.notifyEmail ?? record.email_kontaktowy ?? null, phone: passport?.notifyPhone ?? null }
}

export function publicPassport(store: Store, aed: MergedAed, nowIso: string, today: string) {
  const passport = store.passports.get(aed.id)
  const confirmedAt = passport?.confirmedAt ?? aed.record.data_weryfikacji ?? null
  return {
    id: aed.id,
    name: deviceName(aed.record),
    publication: aed.publication,
    status: aed.record.status,
    confirmedAt,
    confirmedByKeeper: passport?.confirmedAt != null,
    items: ITEMS.map((item) => {
      const date = itemDate(item, passport, aed.record)
      return { item, label: ITEM_TEXT[item], date, ...expiryState(date, today) }
    }),
    reports: summariseReports(store.passports.reportsOf(aed.id), confirmedAt, nowIso),
    keeperEmail: aed.record.email_kontaktowy ? maskEmail(aed.record.email_kontaktowy) : null,
    passportUrl: passportUrl(aed.id),
  }
}

/**
 * Devices that should not count as protection: electrodes or battery past their date (from the keeper or the
 * source), or reported missing or damaged by two different passers-by in the last week with no confirmation since.
 */
export function notWorking(store: Store, today: string, nowIso: string): Set<string> {
  const ids = new Set<string>()
  for (const aed of store.aeds) {
    const passport = store.passports.get(aed.id)
    if (ITEMS.some((item) => expiryState(itemDate(item, passport, aed.record), today).state === 'expired')) ids.add(aed.id)
    const reports = store.passports.reportsOf(aed.id)
    if (reports.length === 0) continue
    const open = summariseReports(reports, passport?.confirmedAt ?? null, nowIso, 7).problems
    if (open.some((problem) => (problem.kind === 'missing' || problem.kind === 'damaged') && problem.count >= 2)) ids.add(aed.id)
  }
  return ids
}

/** Same person, same device, same day → same hash; the address itself is never stored. */
export const clientHash = (client: string, today: string) => createHash('sha256').update(`${config.linkSecret}|${today}|${client}`).digest('hex').slice(0, 32)

export type ReportOutcome = 'accepted' | 'duplicate' | 'limit'

/** Reports a day one person may send, over all devices, and one device may receive from everybody together. */
export const REPORTS_PER_CLIENT_DAY = 30
export const REPORTS_PER_DEVICE_DAY = 20

/**
 * A passer-by's report. One per device per hour from one person, 30 a day from one person and 20 a day for one
 * device, so flooding one device from many addresses stops early too. Problems go to the keeper at once.
 */
export async function fieldReport(store: Store, aed: MergedAed, kind: ReportKind, note: string | null, client: string, nowIso: string, today: string): Promise<ReportOutcome> {
  const hash = clientHash(client, today)
  const reports = store.passports.reportsOf(aed.id)
  if (reports.some((report) => report.clientHash === hash && Date.parse(nowIso) - Date.parse(report.at) < HOUR_MS)) return 'duplicate'
  if (store.passports.reportsByClientOn(hash, today) >= REPORTS_PER_CLIENT_DAY) return 'limit'
  if (reports.filter((report) => report.at.startsWith(today)).length >= REPORTS_PER_DEVICE_DAY) return 'limit'
  await store.passports.report({ aedId: aed.id, kind, note, at: nowIso, clientHash: hash })
  if ((PROBLEM_KINDS as readonly string[]).includes(kind)) await notifyProblem(store, aed, kind, note, nowIso)
  return 'accepted'
}

/** Tells the keeper about a problem; at most one such message per device every 6 hours. */
async function notifyProblem(store: Store, aed: MergedAed, kind: ReportKind, note: string | null, nowIso: string): Promise<void> {
  const recent = store.passports.messagesOf(aed.id).some((message) => message.reason === 'problem_report' && Date.parse(nowIso) - Date.parse(message.at) < 6 * HOUR_MS)
  const passport = store.passports.get(aed.id)
  // Same rule as reminders: only a keeper who opened the passport gets these messages.
  if (recent || !passport) return
  const to = recipients(passport, aed.record)
  const name = deviceName(aed.record)
  const link = ownerUrl(aed.id, passport?.linkVersion ?? 0)
  const subject = `Zgłoszenie przy defibrylatorze „${name}”: ${REPORT_TEXT[kind]}`
  const body = [
    'Dzień dobry,',
    '',
    `osoba, która zeskanowała naklejkę na defibrylatorze „${name}”, zgłosiła: ${REPORT_TEXT[kind]}.`,
    note ? `Dopisała: „${note}”.` : null,
    '',
    'Sprawdź urządzenie. Jeśli wszystko jest w porządku, kliknij „Potwierdzam sprawność” na stronie urządzenia:',
    link,
    '',
    'AED Hub – dane na ratunek',
  ]
    .filter((line) => line !== null)
    .join('\n')
  if (to.email) await send(store.passports, { aedId: aed.id, channel: 'email', recipient: to.email, subject, body, reason: 'problem_report' })
  if (to.phone) await send(store.passports, { aedId: aed.id, channel: 'sms', recipient: to.phone, subject, body: `AED Hub: przy defibrylatorze „${name}” zgłoszono: ${REPORT_TEXT[kind]}. Sprawdź: ${link}`, reason: 'problem_report' })
}

/** Sends the owner link to the address the data already gives for the device; never to an address typed in. */
export async function sendOwnerLink(store: Store, aed: MergedAed, nowIso: string): Promise<{ sentTo: string } | 'no_email' | 'too_soon'> {
  const email = aed.record.email_kontaktowy
  if (!email) return 'no_email'
  if (store.passports.messagesOf(aed.id).some((message) => message.reason === 'owner_link' && Date.parse(nowIso) - Date.parse(message.at) < 10 * 60 * 1000)) return 'too_soon'
  const name = deviceName(aed.record)
  const link = ownerUrl(aed.id, store.passports.get(aed.id)?.linkVersion ?? 0)
  await send(store.passports, {
    aedId: aed.id,
    channel: 'email',
    recipient: email,
    subject: `Link do paszportu defibrylatora „${name}”`,
    body: [
      'Dzień dobry,',
      '',
      `ktoś poprosił o link do zarządzania defibrylatorem „${name}”. Pod tym adresem wpiszesz terminy ważności elektrod i baterii, a po przeglądzie klikniesz „Potwierdzam sprawność”:`,
      link,
      '',
      'Przypomnimy o wymianie 30 i 7 dni przed terminem. Nie przekazuj tego linku osobom spoza instytucji.',
      'Jeśli to nie Ty prosiłeś o link, zignoruj tę wiadomość.',
      '',
      'AED Hub – dane na ratunek',
    ].join('\n'),
    reason: 'owner_link',
  })
  return { sentTo: maskEmail(email) }
}

export interface DeviceLinks {
  id: string
  name: string
  ownerUrl: string
  passportUrl: string
  stickerUrl: string
}

/**
 * Once a provider's devices are published: each gets a passport whose reminders go to the address the provider
 * typed in the wizard (a keeper who already set their own contact keeps it), and the provider gets one message
 * with the sticker and the management link of every device. At most one such message to an address in 10 minutes.
 */
export async function welcomeProvider(store: Store, email: string, devices: readonly DeviceLinks[], nowIso: string): Promise<'sent' | 'too_soon' | 'no_devices'> {
  if (devices.length === 0) return 'no_devices'
  for (const device of devices) {
    const passport = store.passports.getOrEmpty(device.id)
    if (!passport.notifyEmail) await store.passports.save({ ...passport, notifyEmail: email })
  }
  if (store.passports.outbox.some((message) => message.reason === 'passports_ready' && message.recipient === email && Date.parse(nowIso) - Date.parse(message.at) < 10 * 60 * 1000)) return 'too_soon'
  const one = devices.length === 1
  await send(store.passports, {
    aedId: one ? devices[0]!.id : null,
    channel: 'email',
    recipient: email,
    subject: one ? `Naklejka i paszport defibrylatora „${devices[0]!.name}”` : `Naklejki i paszporty Twoich defibrylatorów (${devices.length})`,
    body: [
      'Dzień dobry,',
      '',
      `dziękujemy za zgłoszenie ${one ? 'defibrylatora' : 'defibrylatorów'} do otwartego zbioru danych. ${one ? 'Urządzenie ma' : 'Każde urządzenie ma'} swój paszport.`,
      '',
      `1. Wydrukuj ${one ? 'naklejkę' : 'naklejki'} z kodem QR i przyklej przy ${one ? 'urządzeniu' : 'urządzeniach'}. Kto zeskanuje kod, potwierdzi, że defibrylator jest na miejscu, albo zgłosi Ci problem.`,
      '2. W panelu opiekuna wpisz terminy ważności elektrod i baterii. Przypomnimy o wymianie na ten adres 30 i 7 dni przed terminem.',
      '3. Po przeglądzie kliknij „Potwierdzam sprawność”. W otwartym zbiorze danych urządzenie będzie wtedy oznaczone jako sprawne i sprawdzone.',
      '',
      ...devices.flatMap((device) => [device.name, `  naklejka: ${device.stickerUrl}`, `  panel opiekuna: ${device.ownerUrl}`, '']),
      'Nie przekazuj linków do panelu osobom spoza instytucji: każdy z nich pozwala zmieniać dane urządzenia.',
      '',
      'AED Hub – dane na ratunek',
    ].join('\n'),
    reason: 'passports_ready',
  })
  return 'sent'
}

/** Saves the keeper's changes and puts them into the published record at once. */
export async function updatePassport(store: Store, aedId: string, change: Partial<Passport>, today: string, actor: string, action: string): Promise<Passport> {
  const saved = await store.passports.save({ ...store.passports.getOrEmpty(aedId), ...change, aedId })
  await store.applyPassport(aedId, today)
  await store.log({ actor, entity: 'aed', entityId: aedId, action, detail: change })
  return saved
}

const WINDOW_TEXT = (date: string, window: Window, today: string) => {
  if (window === 'expired') return `termin minął ${plDate(date)}`
  const days = Math.max(0, Math.round((Date.parse(date) - Date.parse(today)) / (24 * HOUR_MS)))
  return `ważne do ${plDate(date)} (zostało ${days} ${days === 1 ? 'dzień' : 'dni'})`
}

/**
 * Reminders 30 and 7 days before an expiry date, and once after it. One message per device and channel listing
 * everything due; a reminder already given is never repeated, so running the job often is safe.
 */
export async function runReminders(store: Store, today: string): Promise<Record<string, number>> {
  let devices = 0
  let messages = 0
  let noContact = 0
  for (const aed of store.aeds) {
    const passport = store.passports.get(aed.id)
    // Only keepers who opened the passport hear from us; an address copied from a municipal file never asked for it.
    if (aed.publication === 'incomplete' || !passport) continue
    const due: { item: Item; date: string; window: Window }[] = []
    for (const item of ITEMS) {
      const date = itemDate(item, passport, aed.record)
      const window = date ? dueWindow(date, today) : null
      if (date && window && !store.passports.reminderSent(aed.id, item, date, window)) due.push({ item, date, window })
    }
    if (due.length === 0) continue
    const to = recipients(passport, aed.record)
    if (!to.email && !to.phone) {
      noContact++
      continue
    }
    devices++
    const name = deviceName(aed.record)
    const link = ownerUrl(aed.id, passport?.linkVersion ?? 0)
    const lines = due.map((entry) => `- ${ITEM_TEXT[entry.item]}: ${WINDOW_TEXT(entry.date, entry.window, today)}`)
    const expired = due.some((entry) => entry.window === 'expired')
    const subject = `Defibrylator „${name}”: ${expired ? 'minął termin ważności' : 'zbliża się termin wymiany'} (${due.map((entry) => ITEM_TEXT[entry.item]).join(', ')})`
    const body = [
      'Dzień dobry,',
      '',
      `piszemy w sprawie defibrylatora „${name}”.`,
      '',
      ...lines,
      '',
      expired ? 'Urządzenie z przeterminowanymi elektrodami albo baterią może nie zadziałać, gdy będzie potrzebne. Wymień je jak najszybciej.' : 'Zamów wymianę, zanim termin minie.',
      'Po wymianie wpisz nowe daty i kliknij „Potwierdzam sprawność”. Urządzenie będzie wtedy oznaczone w otwartym zbiorze danych jako sprawne i sprawdzone:',
      link,
      '',
      'AED Hub – dane na ratunek',
    ].join('\n')
    if (to.email) {
      await send(store.passports, { aedId: aed.id, channel: 'email', recipient: to.email, subject, body, reason: 'reminder' })
      messages++
    }
    if (to.phone) {
      const sms = `AED Hub: defibrylator „${name}” – ${due.map((entry) => `${ITEM_TEXT[entry.item]} ${WINDOW_TEXT(entry.date, entry.window, today)}`).join('; ')}. Nowe daty: ${link}`
      await send(store.passports, { aedId: aed.id, channel: 'sms', recipient: to.phone, subject, body: sms, reason: 'reminder' })
      messages++
    }
    for (const entry of due) await store.passports.markReminder(aed.id, entry.item, entry.date, entry.window)
  }
  return { devices, messages, withoutContact: noContact }
}
