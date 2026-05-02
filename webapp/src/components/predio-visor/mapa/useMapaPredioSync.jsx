/* eslint-disable react-refresh/only-export-components */
/**
 * Sincronización bidireccional mapa ↔ secciones tipo `lista`.
 *
 * Estado compartido:
 *   selected: { capaId, featureId, source } | null
 *   - source === 'map'  → vino de un click en feature → la sección hace
 *                          scrollIntoView + clase resaltado por 2s.
 *   - source === 'list' → vino de un click en card de la sección → el
 *                          mapa hace fit al extent del feature y aplica
 *                          estilo_resaltado.
 *
 * Las secciones tipo `lista` que tienen una capa vinculada y la
 * SeccionMapa consumen este context.
 */
import { createContext, useCallback, useContext, useState } from 'react'

const MapaPredioSyncContext = createContext(null)

export function MapaPredioSyncProvider({ children }) {
  const [selected, setSelected] = useState(null)

  const select = useCallback((capaId, featureId, source) => {
    if (!capaId || !featureId) return
    setSelected({ capaId, featureId: String(featureId), source: source || 'map' })
  }, [])

  const clear = useCallback(() => setSelected(null), [])

  const value = { selected, select, clear }
  return (
    <MapaPredioSyncContext.Provider value={value}>
      {children}
    </MapaPredioSyncContext.Provider>
  )
}

/**
 * Hook seguro: si NO hay Provider arriba, devuelve un stub no-op.
 * Esto permite que SeccionLista funcione fuera del visor (ej. test o
 * embed sin mapa) sin romper.
 */
export function useMapaPredioSync() {
  const ctx = useContext(MapaPredioSyncContext)
  return ctx || { selected: null, select: () => {}, clear: () => {} }
}
