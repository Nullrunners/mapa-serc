import { serve } from '@hono/node-server'
import { createApp } from './app'
import { config } from './config'
import { getContext } from './context'
import { endpointStatuses } from './endpoints'
import { overviewFor } from './gaps/state'
import { runJob } from './jobs'

const app = createApp()

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, async (info) => {
  const statuses = Object.values(endpointStatuses())
  const live = statuses.filter((status) => status === 'live').length
  console.log(`aed-hub api ${config.version} on http://localhost:${info.port}  (reference: /docs, contract: /openapi.json)`)
  console.log(`endpoints: ${live} live, ${statuses.length - live} stub`)
  if (config.adminToken === '') console.log('ADMIN_TOKEN is not set: operator endpoints (/admin/*, Radar decisions) refuse every request')

  try {
    const { store } = await getContext()
    if (store.ranAt === null) {
      // First start on this machine: build the dataset from the copies we have, without waiting for the network.
      console.log('empty database: running the pipeline on local copies of the sources (run `pnpm job pipeline --refresh` to download fresh ones)')
      const summary = await runJob('pipeline', { refresh: false })
      console.log(`pipeline: ${summary.official} official, ${summary.community} community, ${summary.incomplete} incomplete`)
    } else {
      const official = store.aeds.filter((aed) => aed.publication === 'official').length
      console.log(`dataset loaded from ${config.dbPath}: ${store.aeds.length} devices (${official} official), merged ${store.ranAt}`)
    }
    // National gap figures in the background, so the first visitor of /braki does not wait for them.
    overviewFor(store).then((overview) => console.log(`gaps: national figures ready in ${(overview.tookMs / 1000).toFixed(1)} s`), () => undefined)
  } catch (error) {
    console.error('could not open the database or run the first pipeline', error)
  }
})

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error
  console.error(
    `Port ${config.port} is already in use, most likely by another copy of this API.\n` + `Stop that one, or start this one on another port: PORT=${config.port + 1} pnpm dev`,
  )
  process.exit(1)
})
