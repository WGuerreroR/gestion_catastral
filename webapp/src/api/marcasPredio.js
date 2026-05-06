import api from './axios'

const base = (idOperacion) => `/predios/${encodeURIComponent(idOperacion)}/marcas`

export const marcasPredioApi = {
  listar: (idOperacion, { categoria, estado } = {}) => {
    const params = {}
    if (categoria) params.categoria = categoria
    if (estado)    params.estado    = estado
    return api.get(`${base(idOperacion)}/`, { params }).then(r => r.data)
  },

  crear: (idOperacion, data) =>
    api.post(`${base(idOperacion)}/`, data).then(r => r.data),

  eventos: (idOperacion, marcaId) =>
    api.get(`${base(idOperacion)}/${marcaId}/eventos`).then(r => r.data),

  cerrar: (idOperacion, marcaId, observacion) =>
    api.patch(`${base(idOperacion)}/${marcaId}/cerrar`, { observacion }).then(r => r.data),

  reabrir: (idOperacion, marcaId, observacion) =>
    api.patch(`${base(idOperacion)}/${marcaId}/reabrir`, { observacion }).then(r => r.data),

  listarGlobal: ({ solo_mias = true, estado, categoria, prioridad, q, limit, offset } = {}) => {
    const params = { solo_mias }
    if (estado    !== undefined) params.estado    = estado
    if (categoria !== undefined) params.categoria = categoria
    if (prioridad !== undefined) params.prioridad = prioridad
    if (q         !== undefined) params.q         = q
    if (limit     !== undefined) params.limit     = limit
    if (offset    !== undefined) params.offset    = offset
    return api.get('/marcas/', { params }).then(r => r.data)
  },
}

export default marcasPredioApi
