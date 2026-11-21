/**
 * Name and slogan of the campaign as messages to keepers sign them. When the final name is chosen, change it here
 * and in apps/web/lib/brand.ts.
 */
export const BRAND = { name: 'AED Hub', slogan: 'dane na ratunek' } as const

/** Last line of every email. */
export const SIGNATURE = `${BRAND.name} – ${BRAND.slogan}`

/** Start of every SMS, so the recipient knows who writes before reading on. */
export const SMS_PREFIX = `${BRAND.name}:`
