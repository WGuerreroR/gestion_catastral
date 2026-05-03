import api from './axios'

const BASE = '/calidad-muestreo'

export const calidadMuestreoApi = {
  asignacionesDisponibles: () =>
    api.get(`${BASE}/asignaciones-disponibles`).then(r => r.data),

  preview: (asignacion_ids, margen_error = 0.10) =>
    api.post(`${BASE}/preview`, { asignacion_ids, margen_error }).then(r => r.data),

  crear: (data) =>
    api.post(`${BASE}/`, data).then(r => r.data),

  listar: () =>
    api.get(`${BASE}/`).then(r => r.data),

  detalle: (id) =>
    api.get(`${BASE}/${id}`).then(r => r.data),

  actualizar: (id, data) =>
    api.put(`${BASE}/${id}`, data).then(r => r.data),

  predios: (id) =>
    api.get(`${BASE}/${id}/predios`).then(r => r.data),

  asignaciones: (id) =>
    api.get(`${BASE}/${id}/asignaciones`).then(r => r.data),

  geojson: (id) =>
    api.get(`${BASE}/${id}/geojson`).then(r => r.data),

  rerandomizar: (id) =>
    api.post(`${BASE}/${id}/rerandomizar`).then(r => r.data),

  eliminar: (id) =>
    api.delete(`${BASE}/${id}`).then(r => r.data),

  marcarValidado: (id, idOperacion, validado) =>
    api.patch(
      `${BASE}/${id}/predios/${encodeURIComponent(idOperacion)}/validacion`,
      { validado },
    ).then(r => r.data),

  cerrar: (id) =>
    api.post(`${BASE}/${id}/cerrar`).then(r => r.data),

  descargarQgis: (id) =>
    api.get(`${BASE}/${id}/descargar-qgis`, { responseType: 'blob' }),
}

export default calidadMuestreoApi
