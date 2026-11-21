/**
 * ETRS89-LAEA (EPSG:3035, the European statistical grid) to WGS84 latitude and longitude.
 * Inverse Lambert Azimuthal Equal Area on the GRS80 ellipsoid, EPSG method 9820 (IOGP guidance note 7-2).
 * ETRS89 and WGS84 differ by well under a metre in Poland, far below a 1 km grid cell.
 */
const a = 6378137
const f = 1 / 298.257222101
const e2 = 2 * f - f * f
const e = Math.sqrt(e2)
const RAD = Math.PI / 180
const PHI0 = 52 * RAD
const LAMBDA0 = 10 * RAD
const FE = 4321000
const FN = 3210000

const q = (phi: number) => {
  const s = Math.sin(phi)
  return (1 - e2) * (s / (1 - e2 * s * s) - Math.log((1 - e * s) / (1 + e * s)) / (2 * e))
}
const qP = q(Math.PI / 2)
const beta0 = Math.asin(q(PHI0) / qP)
const Rq = a * Math.sqrt(qP / 2)
const D = (a * Math.cos(PHI0)) / (Math.sqrt(1 - e2 * Math.sin(PHI0) ** 2) * Rq * Math.cos(beta0))

/** Easting and northing in metres → [lat, lon] in degrees. */
export function laeaToWgs84(easting: number, northing: number): [number, number] {
  const x = easting - FE
  const y = northing - FN
  const rho = Math.hypot(x / D, D * y)
  if (rho === 0) return [PHI0 / RAD, LAMBDA0 / RAD]
  const C = 2 * Math.asin(rho / (2 * Rq))
  const betaPrime = Math.asin(Math.cos(C) * Math.sin(beta0) + (D * y * Math.sin(C) * Math.cos(beta0)) / rho)
  const lambda = LAMBDA0 + Math.atan2(x * Math.sin(C), D * rho * Math.cos(beta0) * Math.cos(C) - D * D * y * Math.sin(beta0) * Math.sin(C))
  const phi =
    betaPrime +
    (e2 / 3 + (31 * e2 ** 2) / 180 + (517 * e2 ** 3) / 5040) * Math.sin(2 * betaPrime) +
    ((23 * e2 ** 2) / 360 + (251 * e2 ** 3) / 3780) * Math.sin(4 * betaPrime) +
    ((761 * e2 ** 3) / 45360) * Math.sin(6 * betaPrime)
  return [phi / RAD, lambda / RAD]
}
