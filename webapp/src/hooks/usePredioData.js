import { useEffect, useState, useCallback } from 'react'
import { getPredioCompleto } from '../api/predios'
import { getErrorMessage } from '../utils/errorHandler'

export default function usePredioData(busqueda, opciones) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [status, setStatus]   = useState(null)

  const cargar = useCallback(async () => {
    if (!busqueda) {
      setData(null)
      setError(null)
      setStatus(null)
      return
    }
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const d = await getPredioCompleto(busqueda, opciones)
      setData(d)
    } catch (e) {
      setStatus(e?.response?.status || null)
      setError(getErrorMessage(e, 'No se pudo cargar el predio'))
      setData(null)
    } finally {
      setLoading(false)
    }
  // opciones se pasa por valor, no merece dep tracking — el padre lo memoriza si lo necesita
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda])

  useEffect(() => { cargar() }, [cargar])

  return { data, loading, error, status, recargar: cargar }
}
