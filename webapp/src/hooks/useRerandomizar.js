/**
 * hooks/useRerandomizar.js
 * Hook que maneja el flujo completo de rerandomización:
 * confirmación → loading → llamada API → refresco → feedback
 *
 * Uso:
 *   const { confirmar, dialogProps, cargando } = useRerandomizar({
 *     tipo: 'interna' | 'externa',
 *     id: number,
 *     onExito: () => recargarDatos()
 *   })
 */
import { useState } from 'react'
import api from '../api/axios'

export default function useRerandomizar({ tipo, id, onExito, onError }) {
  const [abierto,  setAbierto]  = useState(false)
  const [cargando, setCargando] = useState(false)

  const confirmar = () => setAbierto(true)
  const cancelar  = () => setAbierto(false)

  const ejecutar  = async () => {
    setCargando(true)
    try {
      await api.post(`/calidad-${tipo}/${id}/rerandomizar`)
      setAbierto(false)
      if (onExito) onExito()
    } catch (e) {
      if (onError) onError('Error al rerandomizar la muestra')
    } finally {
      setCargando(false)
    }
  }

  // Props listos para pasarle a un <Dialog> de MUI
  const dialogProps = {
    open:     abierto,
    onClose:  () => !cargando && cancelar(),
    cargando,
    onConfirmar: ejecutar,
    onCancelar:  cancelar
  }

  return { confirmar, dialogProps, cargando }
}
