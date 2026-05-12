import api from './axios'

export const revisionMasivaApi = {
  listar: () => api.get('/revision-masiva/predios').then(r => r.data),

  actualizarCalidad: (idOperacion, campo, valor) =>
    api.patch(`/calidad/predio/${encodeURIComponent(idOperacion)}/calidad`, {
      campo, valor,
    }).then(r => r.data),
}

export default revisionMasivaApi
