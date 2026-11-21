/** The process-wide state: one database, one store, one registers client. Created on first use. */
import { config } from './config'
import { Db } from './db/duck'
import { Store } from './db/store'
import { createGeo, type Geo } from './pipeline/geocode'

export interface AppContext {
  db: Db
  store: Store
  geo: Geo
  /** Same cache, no network: answers only what was looked up before. */
  cachedGeo: Geo
}

const noNetwork: typeof fetch = async () => {
  throw new Error('cache only')
}

let contextPromise: Promise<AppContext> | undefined

export function getContext(): Promise<AppContext> {
  contextPromise ??= (async () => {
    const db = await Db.open(config.dbPath)
    const store = new Store(db)
    await store.load()
    const cachedGeo = createGeo(store.geoCache(), noNetwork)
    return { db, store, geo: config.offline ? cachedGeo : createGeo(store.geoCache()), cachedGeo }
  })()
  // A failed start (e.g. the file is locked by another process) must not be cached forever.
  contextPromise.catch(() => (contextPromise = undefined))
  return contextPromise
}
