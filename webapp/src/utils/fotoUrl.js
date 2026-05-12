/**
 * Helper para construir URLs absolutas de imágenes servidas por la API.
 *
 * Las URLs devueltas se usan en `<img src>` directo, que NO pasa por axios
 * y por lo tanto NO incluye el header `Authorization: Bearer ...`. Por eso
 * el endpoint correspondiente del backend acepta también `?token=<jwt>`
 * como query param, y este helper lo agrega leyendo el token de
 * localStorage en cada llamada (no cachea, para tomar siempre el actual).
 */

const API_HOST = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

export function urlConToken(path) {
  if (!path) return null
  const absoluto = path.startsWith('http') ? path : `${API_HOST}${path}`
  const token = localStorage.getItem('token')
  if (!token) return absoluto
  const sep = absoluto.includes('?') ? '&' : '?'
  return `${absoluto}${sep}token=${encodeURIComponent(token)}`
}
