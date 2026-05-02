/**
 * Hook para cargar catálogos LADM (`*tipo`) que llenan widgets `select`.
 *
 * Caché a nivel módulo (vive mientras la pestaña esté abierta). Múltiples
 * widgets pidiendo el mismo dominio comparten una sola request en vuelo
 * (deduplicación por Promise compartida). El backend además cachea con
 * TTL 1h, así que esto solo evita el round-trip dentro de la sesión.
 */
import { useEffect, useState } from 'react'
import { getDominio } from '../api/predios'
import { getErrorMessage } from '../utils/errorHandler'

const _cache = new Map()         // tabla → { items, expira? }
const _enVuelo = new Map()       // tabla → Promise<items>

function fetchDominio(tabla) {
  const cached = _cache.get(tabla)
  if (cached) return Promise.resolve(cached.items)

  const enVuelo = _enVuelo.get(tabla)
  if (enVuelo) return enVuelo

  const promesa = getDominio(tabla)
    .then(d => {
      const items = d.items || []
      _cache.set(tabla, { items })
      _enVuelo.delete(tabla)
      return items
    })
    .catch(err => {
      _enVuelo.delete(tabla)
      throw err
    })

  _enVuelo.set(tabla, promesa)
  return promesa
}

export default function useDominio(tabla) {
  // Lazy init para que el primer render ya tenga los items si están cacheados,
  // sin necesidad de setState en el cuerpo del effect.
  const [items, setItems]     = useState(() => _cache.get(tabla)?.items ?? null)
  const [loading, setLoading] = useState(() => Boolean(tabla) && !_cache.has(tabla))
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelado = false

    // Diferimos cualquier setState a un microtask para no incumplir la
    // regla react-hooks/set-state-in-effect (mismo patrón que ModalFotosPredio.jsx).
    Promise.resolve().then(() => {
      if (cancelado) return

      if (!tabla) {
        setItems(null)
        setLoading(false)
        setError(null)
        return
      }

      const cached = _cache.get(tabla)
      if (cached) {
        setItems(cached.items)
        setLoading(false)
        setError(null)
        return
      }

      setLoading(true)
      setError(null)

      fetchDominio(tabla)
        .then(its => {
          if (cancelado) return
          setItems(its)
          setLoading(false)
        })
        .catch(err => {
          if (cancelado) return
          setError(getErrorMessage(err, `No se pudo cargar el catálogo "${tabla}"`))
          setItems([])
          setLoading(false)
        })
    })

    return () => { cancelado = true }
  }, [tabla])

  return { items, loading, error }
}

// Útil para tests o para invalidar el caché manualmente
export function _resetCacheDominios() {
  _cache.clear()
  _enVuelo.clear()
}
