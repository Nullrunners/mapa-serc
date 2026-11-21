/**
 * The one table that says, for every route of the contract, which implementation serves it.
 * `stub` answers with sample data in the final shape (and says so in the body); `live` with real data.
 * To take an endpoint live, replace its stub here and run `pnpm contract`.
 */
import type { RouteConfig, RouteHandler } from '@hono/zod-openapi'
import {
  aedDetailRoute,
  aedListRoute,
  approveSourceRoute,
  candidateDecisionRoute,
  candidatesRoute,
  communityRoute,
  csvRoute,
  csvwRoute,
  feedRoute,
  gapsCommuneRoute,
  gapsCsvRoute,
  gapsLocalitiesRoute,
  gapsNearRoute,
  gapsOverviewRoute,
  gapsRoute,
  gapsSummaryRoute,
  geojsonRoute,
  healthRoute,
  importCommitRoute,
  importPreviewRoute,
  jobRoute,
  jsonldRoute,
  accountLinkRoute,
  accountRoute,
  accountUnlinkRoute,
  adminOwnerLinkRoute,
  demoLoginRoute,
  loginOptionsRoute,
  outboxRoute,
  ownerConfirmRoute,
  ownerLinkRequestRoute,
  ownerPassportRoute,
  ownerUpdateRoute,
  passportRoute,
  reportRoute,
  mapRoute,
  patternDocRoute,
  patternXlsxRoute,
  schemaRoute,
  sourceCsvRoute,
  sourceScopeRoute,
  sourcesRoute,
  statsRoute,
  tableSchemaRoute,
  templateRoute,
} from './contract'
import {
  aedDetailHandler,
  aedListHandler,
  communityHandler,
  csvHandler,
  csvwHandler,
  feedHandler,
  geojsonHandler,
  healthHandler,
  jobHandler,
  jsonldHandler,
  mapHandler,
  patternDocHandler,
  patternXlsxHandler,
  schemaHandler,
  sourceScopeHandler,
  sourcesHandler,
  statsHandler,
  tableSchemaHandler,
  templateHandler,
} from './handlers'
import { accountHandler, accountLinkHandler, accountUnlinkHandler, demoLoginHandler, loginOptionsHandler } from './auth/handlers'
import {
  adminOwnerLinkHandler,
  outboxHandler,
  ownerConfirmHandler,
  ownerLinkRequestHandler,
  ownerPassportHandler,
  ownerUpdateHandler,
  passportHandler,
  reportHandler,
} from './passport/handlers'
import { gapsCommuneHandler, gapsCsvHandler, gapsHandler, gapsLocalitiesHandler, gapsNearHandler, gapsOverviewHandler, gapsSummaryHandler } from './gaps/handlers'
import { candidateDecisionHandler, candidatesHandler } from './radar/handlers'
import { approveSourceHandler, importCommitHandler, importPreviewHandler, sourceCsvHandler } from './wizard'

export type EndpointStatus = 'stub' | 'live'

export interface Endpoint {
  route: RouteConfig
  // Handlers are typed against their own route where they are defined; the table itself is heterogeneous.
  handler: RouteHandler<any>
  status: EndpointStatus
}

const live = (route: RouteConfig, handler: RouteHandler<any>): Endpoint => ({ route, handler, status: 'live' })
// Kept for the next endpoint that enters the contract before its implementation.
export const stub = (route: RouteConfig, handler: RouteHandler<any>): Endpoint => ({ route, handler, status: 'stub' })

export const endpointId = (endpoint: Endpoint): string => endpoint.route.operationId ?? `${endpoint.route.method.toUpperCase()} ${endpoint.route.path}`

export function endpointStatuses(): Record<string, EndpointStatus> {
  return Object.fromEntries(endpoints.map((endpoint) => [endpointId(endpoint), endpoint.status]))
}

export const endpoints: Endpoint[] = [
  live(healthRoute, healthHandler(endpointStatuses)),

  live(aedListRoute, aedListHandler),
  // Registered before /v1/aed/{id}, which would otherwise read "aed.geojson"-like paths as an id.
  live(mapRoute, mapHandler),
  live(passportRoute, passportHandler),
  live(reportRoute, reportHandler),
  live(ownerLinkRequestRoute, ownerLinkRequestHandler),
  live(aedDetailRoute, aedDetailHandler),
  live(statsRoute, statsHandler),
  live(sourcesRoute, sourcesHandler),
  live(schemaRoute, schemaHandler),

  live(csvRoute, csvHandler),
  live(geojsonRoute, geojsonHandler),
  live(jsonldRoute, jsonldHandler),
  live(csvwRoute, csvwHandler),
  live(tableSchemaRoute, tableSchemaHandler),
  live(patternDocRoute, patternDocHandler),
  live(patternXlsxRoute, patternXlsxHandler),
  live(templateRoute, templateHandler),
  live(communityRoute, communityHandler),
  live(sourceScopeRoute, sourceScopeHandler),
  live(feedRoute, feedHandler),

  live(importPreviewRoute, importPreviewHandler),
  live(importCommitRoute, importCommitHandler),
  live(sourceCsvRoute, sourceCsvHandler),
  live(approveSourceRoute, approveSourceHandler),

  live(candidatesRoute, candidatesHandler),
  live(candidateDecisionRoute, candidateDecisionHandler),

  live(gapsSummaryRoute, gapsSummaryHandler),
  live(gapsOverviewRoute, gapsOverviewHandler),
  live(gapsNearRoute, gapsNearHandler),
  live(gapsCommuneRoute, gapsCommuneHandler),
  live(gapsLocalitiesRoute, gapsLocalitiesHandler),
  live(gapsCsvRoute, gapsCsvHandler),
  live(gapsRoute, gapsHandler),

  live(ownerPassportRoute, ownerPassportHandler),
  live(ownerUpdateRoute, ownerUpdateHandler),
  live(ownerConfirmRoute, ownerConfirmHandler),
  live(loginOptionsRoute, loginOptionsHandler),
  live(demoLoginRoute, demoLoginHandler),
  live(accountRoute, accountHandler),
  live(accountLinkRoute, accountLinkHandler),
  live(accountUnlinkRoute, accountUnlinkHandler),
  live(adminOwnerLinkRoute, adminOwnerLinkHandler),
  live(outboxRoute, outboxHandler),

  live(jobRoute, jobHandler),
]
