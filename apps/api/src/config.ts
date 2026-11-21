/** Runtime configuration, read once from the environment (see .env.example at the repo root). */
import { join, resolve } from 'node:path'

const env = process.env
const REPO_ROOT = resolve(import.meta.dirname, '../../..')

/** DATA_DIR=:memory: keeps everything in memory (tests). */
const dataDir = env.DATA_DIR === ':memory:' ? null : resolve(REPO_ROOT, env.DATA_DIR ?? 'data')
const port = Number(env.PORT ?? 8787)

export const config = {
  port,
  /** Contract version; keep in step with package.json. */
  version: '0.1.0',
  dataDir,
  dbPath: dataDir ? join(dataDir, 'aed.duckdb') : ':memory:',
  /** Downloaded copies of the sources. */
  rawDir: dataDir ? join(dataDir, 'raw') : null,
  /** Protects /admin/* and operator actions. Empty = those endpoints refuse every request. */
  adminToken: env.ADMIN_TOKEN ?? '',
  /** Signs owner confirmation links and keeper sessions. */
  linkSecret: env.LINK_SECRET ?? 'dev-only-secret',
  /**
   * How a keeper logs in "with mObywatel". demo = a stand-in with made-up people, for showing the flow; anyone may
   * pick any of them, so it proves nothing about who is logging in. off = keepers come in only by their owner link.
   * The real thing is login.gov.pl, which a service joins only with the minister's consent (see src/auth/identity.ts).
   */
  login: (env.MOBYWATEL_LOGIN === 'off' ? 'off' : 'demo') as 'demo' | 'off',
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** Public address of this API; resource links in the dane.gov.pl feed are built from it and must be https. */
  publicApiUrl: (env.PUBLIC_API_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  publicWebUrl: (env.PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  llm: { apiKey: env.ANTHROPIC_API_KEY ?? '', model: env.LLM_MODEL ?? 'claude-haiku-5-5' },
  warsawApiKey: env.WARSAW_API_KEY ?? '',
  /** Email to device keepers (passport reminders, owner links). Empty SMTP_URL: messages are only logged in the outbox. */
  // `||`, not `??`: compose passes an unset variable as an empty string, and an empty sender is not a default.
  mail: { smtpUrl: env.SMTP_URL ?? '', from: env.MAIL_FROM || 'Mapa serc <no-reply@aed-hub.local>' },
  /** SMS through SMSAPI.pl. Empty token: messages are only logged. SMSAPI_TEST=1 asks SMSAPI not to deliver them. */
  sms: { token: env.SMSAPI_TOKEN ?? '', from: env.SMS_FROM ?? '', test: env.SMSAPI_TEST === '1' || env.SMSAPI_TEST === 'true' },
  /**
   * Proxies in front of the API that append the address they saw to X-Forwarded-For (Coolify's proxy: 1). The
   * client is the entry this many places from the end; whatever comes before it the client could have typed.
   * 0 = ignore the header and use the address of the connection.
   */
  trustedProxyHops: Math.max(0, Number(env.TRUSTED_PROXY_HOPS || 1) || 0),
  /** OFFLINE=1: never call the registers; answer only from what is cached (tests, no network). */
  offline: env.OFFLINE === '1' || env.OFFLINE === 'true',
  /** Fixed "today" (YYYY-MM-DD) for reproducible tests. */
  fixedToday: env.FIXED_TODAY,
} as const

export const today = (): string => config.fixedToday ?? new Date().toISOString().slice(0, 10)
export const now = (): string => (config.fixedToday ? `${config.fixedToday}T12:00:00.000Z` : new Date().toISOString())
