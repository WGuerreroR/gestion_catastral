import api from './axios'

const base = '/validacion-calidad'

const validacionCalidadApi = {
  // ── Reglas (CRUD dinámico) ───────────────────────────────────────────────
  listarReglas: ({ soloActivas = false } = {}) =>
    api.get(`${base}/reglas`, { params: { solo_activas: soloActivas } }).then(r => r.data),

  obtenerRegla: (id) =>
    api.get(`${base}/reglas/${id}`).then(r => r.data),

  crearRegla: (data) =>
    api.post(`${base}/reglas`, data).then(r => r.data),

  actualizarRegla: (id, data) =>
    api.put(`${base}/reglas/${id}`, data).then(r => r.data),

  borrarRegla: (id) =>
    api.delete(`${base}/reglas/${id}`).then(r => r.data),

  // ── Jobs ─────────────────────────────────────────────────────────────────
  crearJob: ({ alcance_tipo, alcance_valores = [], reglas_omitidas = [], aplicar_filtro_calidad = true }) =>
    api.post(`${base}/jobs`, {
      alcance_tipo, alcance_valores, reglas_omitidas, aplicar_filtro_calidad,
    }).then(r => r.data),

  // Preview de calidad: predios del alcance que no pasan el gate (calidad_*=1).
  previewCalidad: ({ alcance_tipo, alcance_valores = [] }) =>
    api.post(`${base}/jobs/preview-calidad`, { alcance_tipo, alcance_valores })
       .then(r => r.data),

  listarJobs: ({ limit = 50, offset = 0, incluir_ocultos = false } = {}) =>
    api.get(`${base}/jobs`, { params: { limit, offset, incluir_ocultos } }).then(r => r.data),

  cambiarVisibilidadJob: (id, oculto) =>
    api.patch(`${base}/jobs/${id}/visibilidad`, null, { params: { oculto } }).then(r => r.data),

  obtenerJob: (id) =>
    api.get(`${base}/jobs/${id}`).then(r => r.data),

  cancelarJob: (id) =>
    api.post(`${base}/jobs/${id}/cancelar`).then(r => r.data),

  listarErrores: (id, { limit = 100, offset = 0 } = {}) =>
    api.get(`${base}/jobs/${id}/errores`, { params: { limit, offset } }).then(r => r.data),

  // ── Errores agrupados por predio ────────────────────────────────────────
  listarErroresAgrupados: (id, { limit = 50, offset = 0 } = {}) =>
    api.get(`${base}/jobs/${id}/errores-agrupados`, { params: { limit, offset } }).then(r => r.data),

  // ── Excepciones (errores aceptados/justificados) por job ───────────────
  listarExclusiones: (id) =>
    api.get(`${base}/jobs/${id}/exclusiones`).then(r => r.data),

  // regla=null → excluye TODOS los errores actuales y futuros del predio en este job
  crearExclusion: (id, { numero_predial, regla = null, motivo = null }) =>
    api.post(`${base}/jobs/${id}/exclusiones`, { numero_predial, regla, motivo }).then(r => r.data),

  borrarExclusion: (id, { numero_predial, regla = null }) =>
    api.delete(`${base}/jobs/${id}/exclusiones`, {
      params: { numero_predial, ...(regla ? { regla } : {}) },
    }).then(r => r.data),

  // ── Conversión de errores en marcas (admin_marca_predio) ───────────────
  // Si regla=null, convierte TODOS los errores activos del predio.
  crearMarcasDesdeErrores: (id, { numero_predial, regla = null }) =>
    api.post(
      `${base}/jobs/${id}/predios/${encodeURIComponent(numero_predial)}/marcas`,
      null,
      { params: regla ? { regla } : {} },
    ).then(r => r.data),

  // Acciones masivas a nivel job (todos los predios con errores activos)
  crearMarcasMasivo: (id) =>
    api.post(`${base}/jobs/${id}/marcas-masivo`).then(r => r.data),

  excluirTodosLosErrores: (id, { motivo = null } = {}) =>
    api.post(`${base}/jobs/${id}/exclusiones-masivas`, { motivo }).then(r => r.data),

  // Migrar a validado.* el estado actual de elegibles del job
  migrarAValidado: (id) =>
    api.post(`${base}/jobs/${id}/migrar-validado`).then(r => r.data),

  urlReporte: (id) => {
    const token = localStorage.getItem('token')
    // El navegador no permite añadir headers a una descarga directa, así que
    // armamos la URL absoluta y devolvemos un fetch helper.
    return `${import.meta.env.VITE_API_URL}/api/v1${base}/jobs/${id}/reporte.log`
  },

  descargarReporte: async (id) => {
    const res = await api.get(`${base}/jobs/${id}/reporte.log`, { responseType: 'blob' })
    const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `validacion_calidad_job_${id}.log`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}

export default validacionCalidadApi
