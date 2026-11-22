/**
 * The one DuckDB file of the application. Only the API process opens it: DuckDB allows a single process
 * per file, so jobs run inside the API (POST /admin/jobs/{name}) instead of in a second process.
 *
 * Every statement goes through one connection and one queue. The dataset is tens of thousands of rows and
 * requests are answered from memory (src/db/store.ts), so there is nothing to gain from concurrency here.
 * JSON documents are stored as text and parsed in TypeScript; no DuckDB extension is needed.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api'

export type Param = string | number | boolean | null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id VARCHAR, kind VARCHAR, def VARCHAR, report VARCHAR, updated_at VARCHAR);
CREATE TABLE IF NOT EXISTS source_records (
  source_id VARCHAR, source_key VARCHAR, input VARCHAR, raw VARCHAR, fixes VARCHAR, issues VARCHAR);
CREATE TABLE IF NOT EXISTS aed (
  id VARCHAR, publication VARCHAR, lat DOUBLE, lon DOUBLE, kod_terc VARCHAR, quality INTEGER,
  record VARCHAR, provenance VARCHAR, sources VARCHAR, issues VARCHAR);
CREATE TABLE IF NOT EXISTS aed_links (
  source_id VARCHAR, source_key VARCHAR, aed_id VARCHAR);
CREATE TABLE IF NOT EXISTS review_pairs (
  id VARCHAR, a VARCHAR, b VARCHAR, score DOUBLE, distance_m INTEGER, decision VARCHAR);
CREATE TABLE IF NOT EXISTS candidates (
  id VARCHAR, kind VARCHAR, status VARCHAR, document VARCHAR, updated_at VARCHAR);
CREATE TABLE IF NOT EXISTS change_log (
  logged_at VARCHAR, actor VARCHAR, entity VARCHAR, entity_id VARCHAR, action VARCHAR, detail VARCHAR);
CREATE TABLE IF NOT EXISTS geocode_cache (
  key VARCHAR, result VARCHAR);
CREATE TABLE IF NOT EXISTS meta (
  key VARCHAR, value VARCHAR);
CREATE TABLE IF NOT EXISTS passport (
  aed_id VARCHAR, electrodes_exp VARCHAR, electrodes_child_exp VARCHAR, battery_exp VARCHAR, status VARCHAR,
  confirmed_at VARCHAR, notify_email VARCHAR, notify_phone VARCHAR, link_version INTEGER, updated_at VARCHAR);
CREATE TABLE IF NOT EXISTS field_reports (
  id VARCHAR, aed_id VARCHAR, kind VARCHAR, note VARCHAR, created_at VARCHAR, client_hash VARCHAR);
CREATE TABLE IF NOT EXISTS outbox (
  id VARCHAR, aed_id VARCHAR, channel VARCHAR, recipient VARCHAR, subject VARCHAR, body VARCHAR, reason VARCHAR,
  created_at VARCHAR, status VARCHAR, error VARCHAR);
CREATE TABLE IF NOT EXISTS reminders_sent (
  aed_id VARCHAR, item VARCHAR, due_date VARCHAR, win VARCHAR, sent_at VARCHAR);
ALTER TABLE passport ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR;
CREATE TABLE IF NOT EXISTS keeper_account (
  id VARCHAR, provider VARCHAR, subject_key VARCHAR, name VARCHAR, created_at VARCHAR, last_login_at VARCHAR);
CREATE TABLE IF NOT EXISTS keeper_device (
  account_id VARCHAR, aed_id VARCHAR, linked_at VARCHAR);
CREATE TABLE IF NOT EXISTS device_submissions (
  id VARCHAR, created_at VARCHAR, input VARCHAR, raw VARCHAR, fixes VARCHAR, issues VARCHAR, keeper_email VARCHAR, client_hash VARCHAR);
`

export class Db {
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly connection: DuckDBConnection,
  ) {}

  static async open(path: string): Promise<Db> {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    const instance = await DuckDBInstance.create(path, { threads: '2', memory_limit: '512MB' })
    const connection = await instance.connect()
    await connection.run(SCHEMA)
    return new Db(instance, connection)
  }

  /** Runs `work` after everything queued before it. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work)
    this.queue = result.catch(() => undefined)
    return result
  }

  all<T = Record<string, unknown>>(sql: string, params: Param[] = []): Promise<T[]> {
    return this.enqueue(async () => {
      const reader = await this.connection.runAndReadAll(sql, params as DuckDBValue[])
      return reader.getRowObjectsJson() as T[]
    })
  }

  run(sql: string, params: Param[] = []): Promise<void> {
    return this.enqueue(async () => {
      await this.connection.run(sql, params as DuckDBValue[])
    })
  }

  /**
   * Replaces rows atomically: optional deletes, then the inserts, in one transaction.
   * Rows go in batches of multi-row INSERTs, which is fast enough for the whole dataset.
   */
  replace(table: string, columns: string[], rows: Param[][], deleteSql?: { sql: string; params?: Param[] }): Promise<void> {
    return this.enqueue(async () => {
      await this.connection.run('BEGIN TRANSACTION')
      try {
        if (deleteSql) await this.connection.run(deleteSql.sql, (deleteSql.params ?? []) as DuckDBValue[])
        const BATCH = 400
        const tuple = `(${columns.map(() => '?').join(',')})`
        for (let offset = 0; offset < rows.length; offset += BATCH) {
          const batch = rows.slice(offset, offset + BATCH)
          await this.connection.run(
            `INSERT INTO ${table} (${columns.join(',')}) VALUES ${batch.map(() => tuple).join(',')}`,
            batch.flat() as DuckDBValue[],
          )
        }
        await this.connection.run('COMMIT')
      } catch (error) {
        await this.connection.run('ROLLBACK').catch(() => undefined)
        throw error
      }
    })
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      this.connection.closeSync()
      this.instance.closeSync()
    })
  }
}
