import { catalogInput } from '~/contracts'
import { getDatabase } from './db.server'
import { getAnalytics, getCatalogCounts, listPrompts } from './queries.server'

export function catalogResponse(search: Record<string, unknown>) {
  const input = catalogInput.parse(search)
  return { data: listPrompts(getDatabase(), input), meta: getCatalogCounts(getDatabase()) }
}

export function analyticsResponse() {
  return { data: getAnalytics(getDatabase()) }
}
