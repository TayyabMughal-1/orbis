import type { RegionConfig, ShippingTier } from '../regions/config'

// ---------------------------------------------------------------------
// Turning a delivery window into a date a customer can plan around.
//
// "4–7 business days" asks someone to open a calendar and count. "Get it
// by Tue, 16 Sep" does not, and on a product page that difference shows
// up in conversion. This does the counting.
//
// It is deliberately a good-faith estimate, not a promise: it skips
// weekends using each market's own working week, but it knows nothing
// about public holidays. Copy that uses it should hedge accordingly
// ("get it by", not "guaranteed by").
// ---------------------------------------------------------------------

/**
 * Which days are weekends, per market. The UAE working week runs Monday
 * to Friday since 2022, with Saturday and Sunday off — same as the US.
 * Pakistan is the same. Kept as data because it is exactly the sort of
 * thing that differs once a fourth market is added.
 */
const WEEKEND_DAYS: Record<string, number[]> = {
  us: [0, 6],
  ae: [0, 6],
  pk: [0, 6],
}

function isWorkingDay(date: Date, region: string): boolean {
  const weekend = WEEKEND_DAYS[region] ?? [0, 6]
  return !weekend.includes(date.getDay())
}

/** Adds `days` working days to a date, skipping the local weekend. */
export function addBusinessDays(from: Date, days: number, region: string): Date {
  const date = new Date(from)
  let remaining = days
  while (remaining > 0) {
    date.setDate(date.getDate() + 1)
    if (isWorkingDay(date, region)) remaining -= 1
  }
  return date
}

/**
 * The date range an order placed now would arrive in. Orders placed
 * after the cut-off are treated as tomorrow's, because a warehouse that
 * has gone home cannot pick today's order.
 */
export function estimateDelivery(
  config: RegionConfig,
  tier: ShippingTier,
  now = new Date(),
): { earliest: Date; latest: Date; sameDay: boolean } {
  const [min, max] = tier.etaDays

  if (min === 0 && max === 0) {
    return { earliest: now, latest: now, sameDay: true }
  }

  // Dispatch cut-off: 2pm local, and never on a non-working day.
  let dispatch = new Date(now)
  if (now.getHours() >= 14) dispatch = addBusinessDays(dispatch, 1, config.code)
  while (!isWorkingDay(dispatch, config.code)) {
    dispatch.setDate(dispatch.getDate() + 1)
  }

  return {
    earliest: addBusinessDays(dispatch, min, config.code),
    latest: addBusinessDays(dispatch, max, config.code),
    sameDay: false,
  }
}

const dayMonth = (date: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)

/** "Tue, 16 Sep" or "Tue, 16 – Fri, 19 Sep" for a range. */
export function formatDeliveryEstimate(
  config: RegionConfig,
  tier: ShippingTier,
  now = new Date(),
): string {
  const { earliest, latest, sameDay } = estimateDelivery(config, tier, now)
  if (sameDay) return 'today'
  if (earliest.getTime() === latest.getTime()) return dayMonth(earliest, config.locale)
  return `${dayMonth(earliest, config.locale)} – ${dayMonth(latest, config.locale)}`
}
