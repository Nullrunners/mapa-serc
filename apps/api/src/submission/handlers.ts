/**
 * The single-device form: anyone reports one defibrillator, without logging in. An operator approves the report
 * into the shared source of user reports (and so onto the map and into that source's feed for dane.gov.pl) or
 * rejects it. Two lookups in the state address register help the form's map.
 */
import { randomUUID } from 'node:crypto'
import type { RouteHandler } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { now, today } from '../config'
import { getContext } from '../context'
import {
  DeviceApproval,
  DeviceSubmissionList,
  GeoAnswer,
  type approveDeviceSubmissionRoute,
  type deviceSubmissionsRoute,
  type findAddressRoute,
  type nearestAddressRoute,
  type rejectDeviceSubmissionRoute,
  type removeUserReportRoute,
  type submitDeviceRoute,
} from '../contract'
import type { Store } from '../db/store'
import { requireOperator } from '../handlers'
import { ApiError } from '../http/errors'
import { ok } from '../http/respond'
import { throttle } from '../http/throttle'
import { runJob } from '../jobs'
import { client } from '../passport/handlers'
import { maskEmail } from '../passport/model'
import { clientHash, welcomeProvider } from '../passport/service'
import { addressFromPoint, enrich, type GeocodedAddress } from '../pipeline/geocode'
import type { MergedAed } from '../pipeline/merge'
import { findDuplicate, linksOf } from '../wizard'
import { USER_SOURCE, addressLabel, recordOf, submittedRecord } from './record'

/** Reports one person may leave waiting in a day. More devices than that make a list, and lists go through the file wizard. */
export const SUBMISSIONS_PER_CLIENT_DAY = 10
/** Reports waiting at once, from everybody. Past that the form pauses until the operator catches up. */
export const MAX_PENDING = 500

const outsidePoland = (path: string) =>
  new ApiError(422, 'validation_error', 'Ten punkt nie leży w Polsce. Ustaw pinezkę na defibrylatorze.', [{ path, message: 'Punkt poza granicami Polski.' }])

export const submitDeviceHandler: RouteHandler<typeof submitDeviceRoute> = async (c) => {
  const { record: fields, keeperEmail } = c.req.valid('json')
  const { store, geo } = await getContext()
  const day = today()
  const hash = clientHash(client(c), day)
  if (store.submissions.countByClientOn(hash, day) >= SUBMISSIONS_PER_CLIENT_DAY) {
    throw new ApiError(409, 'conflict', `Z tego miejsca wysłano dziś już ${SUBMISSIONS_PER_CLIENT_DAY} zgłoszeń. Masz więcej urządzeń? Wgraj listę z pliku.`)
  }
  if (store.submissions.all().length >= MAX_PENDING) throw new ApiError(503, 'unavailable', 'Mamy teraz bardzo dużo zgłoszeń do sprawdzenia. Spróbuj jutro.')

  const id = randomUUID()
  const record = submittedRecord(id, fields)
  const { szerokosc_geograficzna: lat, dlugosc_geograficzna: lon } = record.input
  if (lat == null || lon == null) throw outsidePoland('record.szerokosc_geograficzna')
  const errors = record.issues.filter((issue) => issue.severity === 'error')
  if (errors.length > 0) {
    throw new ApiError(
      422,
      'validation_error',
      errors.map((issue) => issue.message).join(' '),
      errors.map((issue) => ({ path: `record.${issue.field ?? ''}`, message: issue.message })),
    )
  }
  // The box around Poland takes in some sea and some neighbours; the commune register knows the border. When it
  // does not answer, the report is taken anyway and the operator gets the commune on approval.
  const commune = await geo.commune(lat, lon).catch(() => undefined)
  if (commune === null) throw outsidePoland('record.szerokosc_geograficzna')
  await enrich([record], geo)
  await addressFromPoint([record], geo)

  await store.submissions.save({ id, createdAt: now(), input: record.input, raw: record.raw, fixes: record.fixes, issues: record.issues, keeperEmail: keeperEmail ?? null, clientHash: hash })
  await store.log({ actor: 'użytkownik', entity: 'submission', entityId: id, action: 'device_submitted', detail: { nazwa: record.input.nazwa ?? null, keeper: keeperEmail !== undefined } })
  return c.json({ id, status: 'pending' as const }, 200)
}

export const deviceSubmissionsHandler: RouteHandler<typeof deviceSubmissionsRoute> = async (c) => {
  requireOperator(c)
  const { store } = await getContext()
  return ok(c, DeviceSubmissionList, {
    items: store.submissions.all().map((submission) => {
      const { input } = submission
      return {
        id: submission.id,
        createdAt: submission.createdAt,
        record: {
          nazwa: input.nazwa ?? null,
          szerokosc_geograficzna: input.szerokosc_geograficzna ?? null,
          dlugosc_geograficzna: input.dlugosc_geograficzna ?? null,
          cecha_ulicy: input.cecha_ulicy ?? null,
          nazwa_ulicy: input.nazwa_ulicy ?? null,
          nr_budynku: input.nr_budynku ?? null,
          kod_pocztowy: input.kod_pocztowy ?? null,
          miejscowosc: input.miejscowosc ?? null,
          kod_terc: input.kod_terc ?? null,
          opis_lokalizacji: input.opis_lokalizacji ?? null,
          wewnatrz_budynku: input.wewnatrz_budynku ?? null,
          dostep: input.dostep ?? null,
          godziny_dostepnosci: input.godziny_dostepnosci ?? null,
          uwagi_dostepu: input.uwagi_dostepu ?? null,
        },
        warnings: submission.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message),
        keeperEmail: submission.keeperEmail ? maskEmail(submission.keeperEmail) : null,
        // Asked anew every time: a report approved in the meantime may be the same device.
        duplicateOf: findDuplicate(recordOf(submission), store, null),
      }
    }),
  })
}

type KeeperOutcome = 'sent' | 'not_asked' | 'not_published' | 'shared' | 'has_keeper'

/**
 * The management link goes to the person who said they look after the device only when it is theirs to look
 * after: published, built from their report alone (OpenStreetMap aside), and with nobody minding it yet.
 * Otherwise anyone could take over an institution's device by reporting it again.
 */
async function welcomeKeeper(store: Store, email: string | null, aed: MergedAed | undefined): Promise<KeeperOutcome> {
  if (!email) return 'not_asked'
  if (!aed || aed.publication !== 'official') return 'not_published'
  const kindOf = (sourceId: string) => store.reports.find((report) => report.id === sourceId)?.kind
  if (aed.sources.some((ref) => ref.sourceId !== USER_SOURCE.id && kindOf(ref.sourceId) !== 'osm')) return 'shared'
  if (store.passports.get(aed.id)?.notifyEmail || store.keepers.keepersOf(aed.id).length > 0) return 'has_keeper'
  await welcomeProvider(store, email, [linksOf(store, aed)], now())
  return 'sent'
}

export const approveDeviceSubmissionHandler: RouteHandler<typeof approveDeviceSubmissionRoute> = async (c) => {
  requireOperator(c)
  const { id } = c.req.valid('param')
  const { store, geo } = await getContext()
  const submission = store.submissions.get(id)
  if (!submission) throw new ApiError(404, 'not_found', `No device report with id ${id}.`)

  // The registers may have been silent when the report came; without its commune the device cannot be published.
  const record = recordOf(submission)
  if (!record.input.kod_terc || !record.input.miejscowosc) {
    await enrich([record], geo)
    await addressFromPoint([record], geo)
    if (!record.input.kod_terc || !record.input.miejscowosc) {
      throw new ApiError(503, 'unavailable', 'Państwowy rejestr gmin nie odpowiada, więc nie znamy gminy tego punktu. Spróbuj za chwilę.')
    }
    await store.submissions.save({ ...submission, input: record.input, fixes: record.fixes, issues: record.issues })
  }

  await store.addStoredRecord(USER_SOURCE, record)
  await store.log({ actor: 'operator', entity: 'submission', entityId: id, action: 'device_approved', detail: {} })
  await runJob('pipeline')
  const aed = store.deviceOf(USER_SOURCE.id, id)
  const keeper = await welcomeKeeper(store, submission.keeperEmail, aed)
  // The device's history is public: it says a report was approved, never who sent it.
  if (aed) await store.log({ actor: 'operator', entity: 'aed', entityId: aed.id, action: 'user_report_approved', detail: { submission: id } })
  // Last, so that an approval cut short (a restart during the pipeline run) can simply be repeated.
  await store.submissions.remove(id)
  return ok(c, DeviceApproval, { id, device: aed ? { id: aed.id, publication: aed.publication } : null, keeper })
}

export const rejectDeviceSubmissionHandler: RouteHandler<typeof rejectDeviceSubmissionRoute> = async (c) => {
  requireOperator(c)
  const { id } = c.req.valid('param')
  const { store } = await getContext()
  if (!(await store.submissions.remove(id))) throw new ApiError(404, 'not_found', `No device report with id ${id}.`)
  await store.log({ actor: 'operator', entity: 'submission', entityId: id, action: 'device_rejected', detail: {} })
  return c.json({ id, removed: true as const }, 200)
}

/** Takes an approved report back out of the dataset: approved by mistake, spam, or a test. */
export const removeUserReportHandler: RouteHandler<typeof removeUserReportRoute> = async (c) => {
  requireOperator(c)
  const { id } = c.req.valid('param')
  const { store } = await getContext()
  const ref = store.get(id)?.sources.find((source) => source.sourceId === USER_SOURCE.id)
  if (!ref || !(await store.removeStoredRecord(USER_SOURCE.id, ref.sourceKey))) throw new ApiError(404, 'not_found', `Device ${id} has no approved user report.`)
  await store.log({ actor: 'operator', entity: 'aed', entityId: id, action: 'user_report_removed', detail: { submission: ref.sourceKey } })
  await runJob('pipeline')
  return c.json({ id, removed: true as const }, 200)
}

// ------------------------------------------------------------------ address lookups

/** The register blocks a server that asks too eagerly, which would stop it for every visitor; 60 lookups per 10 minutes per person. */
const lookups = throttle(60, 10 * 60 * 1000)
const REGISTER_SILENT = 'Wyszukiwarka adresów chwilowo nie działa. Ustaw pinezkę na mapie.'

function lookupAllowed(c: Context): void {
  if (!lookups(clientHash(client(c), today()))) throw new ApiError(503, 'unavailable', 'Za dużo wyszukiwań naraz. Spróbuj za kilka minut albo ustaw pinezkę na mapie.')
}

const answer = (found: GeocodedAddress | null) => ({
  address: found ? { label: addressLabel(found), lat: found.lat, lon: found.lon, city: found.city, street: found.street, number: found.number, postcode: found.postcode } : null,
})

export const nearestAddressHandler: RouteHandler<typeof nearestAddressRoute> = async (c) => {
  lookupAllowed(c)
  const [lon, lat] = c.req.valid('query').at.split(',').map(Number) as [number, number]
  const { geo } = await getContext()
  const found = await geo.nearestAddress(lat, lon).catch(() => {
    throw new ApiError(503, 'unavailable', REGISTER_SILENT)
  })
  return ok(c, GeoAnswer, answer(found))
}

export const findAddressHandler: RouteHandler<typeof findAddressRoute> = async (c) => {
  lookupAllowed(c)
  const { geo } = await getContext()
  const found = await geo.address(c.req.valid('query').q).catch(() => {
    throw new ApiError(503, 'unavailable', REGISTER_SILENT)
  })
  return ok(c, GeoAnswer, answer(found))
}
