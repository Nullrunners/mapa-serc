/**
 * Single devices reported by anyone through the form, waiting for an operator. Kept apart from the sources: a
 * report enters the dataset only once approved (it then becomes a record of the shared source of user reports),
 * so nothing here reaches the map or the files. The row goes when the operator decides, and the keeper's address
 * with it.
 */
import type { AedInput } from '@aed/schema'
import type { Fix, Issue } from '../pipeline/types'
import type { Db, Param } from './duck'

export interface DeviceSubmission {
  id: string
  createdAt: string
  /** The device after normalisation and the registers, as the source record it becomes on approval. */
  input: AedInput
  /** The form's values as text; never the keeper's address. */
  raw: Record<string, string>
  fixes: Fix[]
  issues: Issue[]
  /** Private address of a person who looks after the device; null for a passer-by. Never published. */
  keeperEmail: string | null
  /** Who sent it, for the daily limit (see clientHash); the address itself is never stored. */
  clientHash: string
}

const COLUMNS = ['id', 'created_at', 'input', 'raw', 'fixes', 'issues', 'keeper_email', 'client_hash']
const json = (value: unknown): string => JSON.stringify(value)
const parse = <T>(text: unknown): T => JSON.parse(String(text)) as T

export class SubmissionBook {
  private items = new Map<string, DeviceSubmission>()

  constructor(private readonly db: Db) {}

  async load(): Promise<void> {
    for (const row of await this.db.all<Record<string, unknown>>('SELECT * FROM device_submissions ORDER BY created_at')) {
      this.items.set(String(row.id), {
        id: String(row.id),
        createdAt: String(row.created_at),
        input: parse(row.input),
        raw: parse(row.raw),
        fixes: parse(row.fixes),
        issues: parse(row.issues),
        keeperEmail: row.keeper_email === null || row.keeper_email === undefined ? null : String(row.keeper_email),
        clientHash: String(row.client_hash),
      })
    }
  }

  /** Oldest first: the operator works through them in the order they came. */
  all(): DeviceSubmission[] {
    return [...this.items.values()]
  }

  get(id: string): DeviceSubmission | undefined {
    return this.items.get(id)
  }

  /** Reports one person (hash) sent on one day that still wait. */
  countByClientOn(clientHash: string, day: string): number {
    let count = 0
    for (const item of this.items.values()) if (item.clientHash === clientHash && item.createdAt.startsWith(day)) count++
    return count
  }

  /** Adds a report, or replaces it with the same id. */
  async save(submission: DeviceSubmission): Promise<void> {
    const row: Param[] = [
      submission.id,
      submission.createdAt,
      json(submission.input),
      json(submission.raw),
      json(submission.fixes),
      json(submission.issues),
      submission.keeperEmail,
      submission.clientHash,
    ]
    await this.db.replace('device_submissions', COLUMNS, [row], { sql: 'DELETE FROM device_submissions WHERE id = ?', params: [submission.id] })
    this.items.set(submission.id, submission)
  }

  async remove(id: string): Promise<boolean> {
    if (!this.items.has(id)) return false
    await this.db.run('DELETE FROM device_submissions WHERE id = ?', [id])
    this.items.delete(id)
    return true
  }
}
