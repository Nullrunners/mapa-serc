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
  /** Signs owner confirmation links. */
  linkSecret: env.LINK_SECRET ?? 'dev-only-secret',
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** Public address of this API; resource links in the dane.gov.pl feed are built from it and must be https. */
  publicApiUrl: (env.PUBLIC_API_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  publicWebUrl: (env.PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  llm: { apiKey: env.ANTHROPIC_API_KEY ?? '', model: env.LLM_MODEL ?? 'claude-haiku-5-5' },
  warsawApiKey: env.WARSAW_API_KEY ?? '',
  /** OFFLINE=1: never call the registers; answer only from what is cached (tests, no network). */
  offline: env.OFFLINE === '1' || env.OFFLINE === 'true',
  /** Fixed "today" (YYYY-MM-DD) for reproducible tests. */
  fixedToday: env.FIXED_TODAY,
} as const

export const today = (): string => config.fixedToday ?? new Date().toISOString().slice(0, 10)
export const now = (): string => (config.fixedToday ? `${config.fixedToday}T12:00:00.000Z` : new Date().toISOString())
