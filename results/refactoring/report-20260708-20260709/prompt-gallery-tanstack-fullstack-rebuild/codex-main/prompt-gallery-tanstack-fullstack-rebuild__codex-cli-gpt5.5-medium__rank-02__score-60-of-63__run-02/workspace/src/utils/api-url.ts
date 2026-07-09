export function apiUrl(path: string) {
  if (typeof window !== 'undefined') return path
  return `${process.env.POWERPROMPT_ORIGIN ?? 'http://127.0.0.1:3000'}${path}`
}
