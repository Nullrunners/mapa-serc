/**
 * Demand side of the gap analysis: residents of Poland in the 1 km grid of the 2021 census
 * (GUS, NSP 2021, published in the European grid by Eurostat, CC BY 4.0). Built by scripts/fetch-population.ts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { laeaToWgs84 } from './laea'

export const POPULATION_FILE = resolve(import.meta.dirname, '../../reference/census-2021-pl.csv.gz')

export const POPULATION_SOURCE = {
  name: 'Ludność w siatce 1 km, Narodowy Spis Powszechny 2021 (GUS), w wydaniu Eurostatu (Census 2021 grid, wersja 3)',
  url: 'https://ec.europa.eu/eurostat/web/gisco/geodata/population-distribution/population-grids',
  licence: 'CC BY 4.0',
  attribution: '© Unia Europejska, Eurostat; dane dla Polski: GUS. Zmiany: mieszkańców każdego kwadratu 1 km rozdzieliliśmy po równo na sześciokąty H3.',
} as const

/** One populated 1 km square. `e` and `n` are the south-west corner in EPSG:3035 kilometres. */
export interface GridCell {
  e: number
  n: number
  residents: number
  seniors: number
}

export function parseCells(text: string): GridCell[] {
  const cells: GridCell[] = []
  for (const line of text.split('\n').slice(1)) {
    if (!line) continue
    const [n, e, t, s] = line.split(',').map(Number)
    if (!(t! > 0)) continue
    cells.push({ e: e!, n: n!, residents: t!, seniors: Math.max(0, Math.min(s!, t!)) })
  }
  return cells
}

let cached: GridCell[] | null = null
/** All populated squares of Poland, read once. Empty when the file is missing. */
export function populationCells(): GridCell[] {
  if (!cached) cached = existsSync(POPULATION_FILE) ? parseCells(gunzipSync(readFileSync(POPULATION_FILE)).toString('utf8')) : []
  return cached
}

/** Corners of the square as [lat, lon], counter-clockwise from the south-west. */
export function cellCorners(cell: Pick<GridCell, 'e' | 'n'>): [number, number][] {
  const e = cell.e * 1000
  const n = cell.n * 1000
  return [laeaToWgs84(e, n), laeaToWgs84(e + 1000, n), laeaToWgs84(e + 1000, n + 1000), laeaToWgs84(e, n + 1000)]
}

export const cellCentre = (cell: Pick<GridCell, 'e' | 'n'>): [number, number] => laeaToWgs84(cell.e * 1000 + 500, cell.n * 1000 + 500)
