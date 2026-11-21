/** Writes the contract to openapi/openapi.json. Run with `pnpm contract` after any change under src/contract/. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildOpenApiDocument, createApp } from '../src/app'

const document = buildOpenApiDocument(createApp())
mkdirSync('openapi', { recursive: true })
writeFileSync('openapi/openapi.json', JSON.stringify(document, null, 2) + '\n')

const operations = Object.values(document.paths ?? {}).flatMap((path) => Object.keys(path ?? {}))
console.log(`openapi/openapi.json written: ${operations.length} operations, ${Object.keys(document.components?.schemas ?? {}).length} schemas`)
