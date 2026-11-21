/**
 * Messages to device keepers, by email (SMTP) and SMS (SMSAPI.pl). Every message is written to the outbox first,
 * so the operator sees what went out and a deployment without mail or SMS accounts still works: there the
 * message is only logged.
 */
import nodemailer, { type Transporter } from 'nodemailer'
import { config, now } from '../config'
import type { Channel, OutboxMessage, PassportBook } from '../db/passport'

export interface Message {
  aedId: string | null
  channel: Channel
  recipient: string
  subject: string
  body: string
  reason: string
}

let transporter: Transporter | undefined

async function sendEmail(message: Message): Promise<void> {
  transporter ??= nodemailer.createTransport(config.mail.smtpUrl)
  await transporter.sendMail({ from: config.mail.from, to: message.recipient, subject: message.subject, text: message.body })
}

/** SMSAPI.pl: https://www.smsapi.pl/docs – POST /sms.do with a bearer token. */
async function sendSms(message: Message): Promise<void> {
  const form = new URLSearchParams({ to: message.recipient.replace(/^\+/, ''), message: message.body, format: 'json', encoding: 'utf-8' })
  if (config.sms.from) form.set('from', config.sms.from)
  if (config.sms.test) form.set('test', '1')
  const response = await fetch('https://api.smsapi.pl/sms.do', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.sms.token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(15_000),
  })
  const answer = (await response.json().catch(() => ({}))) as { error?: number; message?: string }
  if (!response.ok || answer.error) throw new Error(`SMSAPI ${response.status}: ${answer.message ?? answer.error ?? 'no answer'}`)
}

const configured = (channel: Channel) => (channel === 'email' ? config.mail.smtpUrl !== '' : config.sms.token !== '')

/** Sends one message and records the outcome. Never throws: a failed delivery is a row in the outbox. */
export async function send(book: PassportBook, message: Message): Promise<OutboxMessage> {
  const at = now()
  if (!configured(message.channel)) return book.record({ ...message, at, status: 'logged', error: null })
  try {
    await (message.channel === 'email' ? sendEmail(message) : sendSms(message))
    return book.record({ ...message, at, status: 'sent', error: null })
  } catch (error) {
    console.error(`[notify] ${message.channel} to ${message.recipient} failed`, error)
    return book.record({ ...message, at, status: 'failed', error: error instanceof Error ? error.message : String(error) })
  }
}
