/**
 * A limit per key over a sliding window, kept in memory. For lookups that each cost a public service a request
 * (the state registers), so that one visitor cannot get the whole server blocked there. A restart forgets it all,
 * which is fine for this purpose.
 */
export function throttle(limit: number, windowMs: number, clock: () => number = Date.now): (key: string) => boolean {
  const hits = new Map<string, number[]>()
  return (key) => {
    const now = clock()
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs)
    const allowed = recent.length < limit
    if (allowed) recent.push(now)
    hits.set(key, recent)
    // Now and then drop the keys whose hits have all expired, so the map does not grow without end.
    if (hits.size > 10_000) for (const [other, times] of hits) if (times.every((at) => now - at >= windowMs)) hits.delete(other)
    return allowed
  }
}
