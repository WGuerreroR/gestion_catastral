import api from './axios'

export function getPredioCompleto(busqueda, opciones = {}) {
  const { incluirGeometrias = true, incluirFotosMetadata = true } = opciones
  return api.get(`/predios/${encodeURIComponent(busqueda)}/completo`, {
    params: {
      incluir_geometrias: incluirGeometrias,
      incluir_fotos_metadata: incluirFotosMetadata,
    },
  }).then(r => r.data)
}

export function getDominio(nombreTabla) {
  return api.get(`/dominios/${encodeURIComponent(nombreTabla)}`).then(r => r.data)
}

export function getManzana(codigoManzana) {
  return api.get(`/spatial/manzana/${encodeURIComponent(codigoManzana)}`).then(r => r.data)
}

export function getAuditoriaCampo(idOperacion, tabla, pk) {
  return api.get(
    `/predios/${encodeURIComponent(idOperacion)}/auditoria/${encodeURIComponent(tabla)}/${encodeURIComponent(pk)}`
  ).then(r => r.data)
}

export function guardarPredio(idOperacion, formId, cambios) {
  return api.post(
    `/predios/${encodeURIComponent(idOperacion)}/guardar`,
    { form_id: formId, cambios }
  ).then(r => r.data)
}

/**
 * Descarga el PDF del predio. Usa fetch con Authorization en lugar de
 * un <a download> directo porque axios interceptor inyecta el token y
 * el endpoint requiere autenticación.
 */
export async function descargarPredioPDF(idOperacion, formId = 'predio-completo-lectura') {
  const response = await api.get(
    `/predios/${encodeURIComponent(idOperacion)}/export-pdf`,
    { params: { form_id: formId }, responseType: 'blob' }
  )
  const blob = new Blob([response.data], { type: 'application/pdf' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `predio_${idOperacion}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// URL absoluta de una foto del predio (para usar directamente en <img src>)
const API_HOST = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
export function urlFotoPredio(idOperacion, rutaRelativa) {
  if (!rutaRelativa) return null
  return `${API_HOST}/api/v1/predios/${encodeURIComponent(idOperacion)}/fotos/${rutaRelativa}`
}
