import api from './axios'

const base = '/migracion-ladm'

const migracionLadmApi = {
  // ── Conexiones ─────────────────────────────────────────────────────────
  listarConexiones: () =>
    api.get(`${base}/conexiones`).then(r => r.data),

  obtenerConexion: (id) =>
    api.get(`${base}/conexiones/${id}`).then(r => r.data),

  crearConexion: (data) =>
    api.post(`${base}/conexiones`, data).then(r => r.data),

  actualizarConexion: (id, data) =>
    api.put(`${base}/conexiones/${id}`, data).then(r => r.data),

  borrarConexion: (id) =>
    api.delete(`${base}/conexiones/${id}`).then(r => r.data),

  probarConexionAdhoc: (data) =>
    api.post(`${base}/conexiones/probar`, data).then(r => r.data),

  probarConexionPerfil: (id) =>
    api.post(`${base}/conexiones/${id}/probar`).then(r => r.data),

  probarConexionLocal: () =>
    api.post(`${base}/conexiones/local/probar`).then(r => r.data),

  // ── Jobs ───────────────────────────────────────────────────────────────
  crearJob: ({ conexion_id = null, esquema_origen, esquema_destino, tabla_dominios }) =>
    api.post(`${base}/jobs`, {
      conexion_id, esquema_origen, esquema_destino,
      tabla_dominios: tabla_dominios || 'homologacion1_0_1_2',
    }).then(r => r.data),

  listarJobs: ({ limit = 50, offset = 0 } = {}) =>
    api.get(`${base}/jobs`, { params: { limit, offset } }).then(r => r.data),

  obtenerJob: (id) =>
    api.get(`${base}/jobs/${id}`).then(r => r.data),

  cancelarJob: (id) =>
    api.post(`${base}/jobs/${id}/cancelar`).then(r => r.data),

  listarErrores: (id, { limit = 100, offset = 0 } = {}) =>
    api.get(`${base}/jobs/${id}/errores`, { params: { limit, offset } }).then(r => r.data),

  descargarReporte: async (id) => {
    const res = await api.get(`${base}/jobs/${id}/reporte.log`, { responseType: 'blob' })
    const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `migracion_ladm_job_${id}.log`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}

export default migracionLadmApi
