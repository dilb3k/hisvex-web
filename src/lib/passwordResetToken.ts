/** Take the bearer proof out of browser history without persisting it. */
export function takePasswordResetToken(location: { hash: string; pathname: string }, history: { state: unknown; replaceState(data: unknown, unused: string, url: string): void }) {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''))
  const values = params.getAll('token')
  if (location.hash) history.replaceState(history.state, '', location.pathname)
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : ''
}
