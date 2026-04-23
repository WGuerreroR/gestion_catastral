import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box, Button, Typography, Chip, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Alert, CircularProgress,
  Tooltip, Stack, Card, CardContent, Divider, Grid
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import AddIcon         from '@mui/icons-material/Add'
import EditIcon        from '@mui/icons-material/Edit'
import DeleteIcon      from '@mui/icons-material/Delete'
import MapIcon         from '@mui/icons-material/Map'
import PersonIcon      from '@mui/icons-material/Person'
import FolderIcon      from '@mui/icons-material/Folder'
import SwapHorizIcon   from '@mui/icons-material/SwapHoriz'
import WarningIcon     from '@mui/icons-material/Warning'
import AssignmentIcon  from '@mui/icons-material/Assignment'
import DownloadIcon    from '@mui/icons-material/Download'
import { useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'
import ModalMetodoAsignacion from '../components/ModalMetodoAsignacion'
import ModalMapaAsignacion   from '../components/ModalMapaAsignacion'

const coloresEstado = {
  campo:      'warning',
  validacion: 'info',
  finalizado: 'success'
}

const FORM_INICIAL = {
  clave_proyecto: '',
  descripcion:    '',
  estado:         'campo',
  responsable_id: ''
}

export default function Asignaciones() {
  const { user }   = useSelector(state => state.auth)
  const navigate   = useNavigate()
  const puedeAdmin = user?.roles?.some(r => ['administrador', 'supervisor'].includes(r))

  const [proyectos,    setProyectos]    = useState([])
  const [personas,     setPersonas]     = useState([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [success,      setSuccess]      = useState('')
  const [seleccionado, setSeleccionado] = useState(null)

  // Descargas del proyecto seleccionado
  const [descargando,    setDescargando]    = useState(false)
  const [descargandoQGZ, setDescargandoQGZ] = useState(false)
  const [estadoOffline,  setEstadoOffline]  = useState(null)
  const pollingRef = useRef(null)

  // Modal crear/editar
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editando,   setEditando]   = useState(null)
  const [form,       setForm]       = useState(FORM_INICIAL)
  const [guardando,  setGuardando]  = useState(false)

  // Modal cambiar responsable
  const [modalResp,    setModalResp]    = useState(false)
  const [proyectoResp, setProyectoResp] = useState(null)
  const [nuevoResp,    setNuevoResp]    = useState('')

  // Modal confirmación
  const [modalConfirm, setModalConfirm] = useState(false)
  const [confirmData,  setConfirmData]  = useState({ titulo: '', mensaje: '', onConfirm: null })
  const [confirmando,  setConfirmando]  = useState(false)

  // Modal asignación
  const [modalMetodo,    setModalMetodo]    = useState(false)
  const [modalMapa,      setModalMapa]      = useState(false)
  const [metodoSelected, setMetodoSelected] = useState(null)
  const [proyectoActivo, setProyectoActivo] = useState(null)

  const cargarDatos = useCallback(async () => {
    setLoading(true)
    try {
      const [prRes, peRes] = await Promise.all([
        api.get('/proyectos/'),
        api.get('/personas/')
      ])
      setProyectos(prRes.data)
      setPersonas(peRes.data.filter(p => p.activo))
    } catch {
      setError('Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   4000) }
  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }

  // ── Estado offline del proyecto seleccionado + polling ─────────────────
  const detenerPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  const cargarEstadoOffline = async (proyectoId) => {
    try {
      const { data } = await api.get(`/proyectos/${proyectoId}/estado-generacion`)
      setEstadoOffline(data)
      // Si está generando, arrancá el polling (si no está ya)
      if (['pendiente', 'procesando'].includes(data?.estado_generacion)) {
        iniciarPolling(proyectoId)
      } else {
        detenerPolling()
      }
      return data
    } catch {
      setEstadoOffline(null)
      return null
    }
  }

  const iniciarPolling = (proyectoId) => {
    if (pollingRef.current) return  // ya hay uno activo
    pollingRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/proyectos/${proyectoId}/estado-generacion`)
        setEstadoOffline(data)
        const e = data?.estado_generacion
        if (!e || !['pendiente', 'procesando'].includes(e)) {
          detenerPolling()
          if (e === 'terminado') mostrarSuccess('Proyecto offline listo')
          if (e === 'error')     mostrarError('Error generando proyecto offline')
        }
      } catch {
        // silencioso, el próximo tick volverá a intentar
      }
    }, 3000)
  }

  // Detener polling al desmontar
  useEffect(() => () => detenerPolling(), [])

  // ── Descargar proyecto offline (.zip) ───────────────────
  const handleDescargar = async (proyecto) => {
    setDescargando(true)
    try {
      const response = await api.get(
        `/proyectos/clave/${proyecto.clave_proyecto}/descarga`,
        { responseType: 'blob' }
      )
      const url  = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href     = url
      link.download = `${proyecto.clave_proyecto}_offline.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      mostrarError('Error descargando el proyecto offline')
    } finally {
      setDescargando(false)
    }
  }

  // ── Descargar área (proyecto QGIS con PostGIS vivo) ─────
  const handleDescargarQGZ = async (proyecto) => {
    setDescargandoQGZ(true)
    try {
      const response = await api.get(
        `/proyectos/${proyecto.id}/descargar-proyecto-qgis`,
        { responseType: 'blob' }
      )
      const url  = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href     = url
      link.download = `${proyecto.clave_proyecto}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error descargando área'))
    } finally {
      setDescargandoQGZ(false)
    }
  }

  const confirmar = ({ titulo, mensaje, onConfirm }) => {
    setConfirmData({ titulo, mensaje, onConfirm })
    setModalConfirm(true)
  }

  const handleConfirmar = async () => {
    setConfirmando(true)
    try {
      await confirmData.onConfirm()
      setModalConfirm(false)
    } finally {
      setConfirmando(false)
    }
  }



  // ── Crear / Editar ──────────────────────────────────────
  const abrirCrear = () => {
    setEditando(null)
    setForm(FORM_INICIAL)
    setModalOpen(true)
  }

  const abrirEditar = (proyecto) => {
    setEditando(proyecto)
    setForm({
      clave_proyecto: proyecto.clave_proyecto,
      descripcion:    proyecto.descripcion    || '',
      estado:         proyecto.estado,
      responsable_id: proyecto.responsable_id || ''
    })
    setModalOpen(true)
  }

  const handleGuardar = async () => {
    setGuardando(true)
    try {
      if (editando) {
        const { clave_proyecto, ...campos } = form
        await api.put(`/proyectos/${editando.id}`, campos)
      } else {
        await api.post('/proyectos/', form)
      }
      mostrarSuccess(editando ? 'Proyecto actualizado' : 'Proyecto creado exitosamente')
      setModalOpen(false)
      cargarDatos()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al guardar'))
    } finally {
      setGuardando(false)
    }
  }

  // ── Cambiar responsable ─────────────────────────────────
  const abrirCambiarResponsable = (proyecto) => {
    setProyectoResp(proyecto)
    setNuevoResp('')
    setModalResp(true)
  }

  const handleCambiarResponsable = async () => {
    try {
      await api.put(`/proyectos/${proyectoResp.id}/responsable`, {
        responsable_id: parseInt(nuevoResp)
      })
      mostrarSuccess('Responsable actualizado')
      setModalResp(false)
      cargarDatos()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al cambiar responsable'))
    }
  }

  // ── Eliminar ────────────────────────────────────────────
  const handleEliminar = (proyecto) => {
    confirmar({
      titulo:  'Eliminar proyecto',
      mensaje: `¿Eliminar el proyecto "${proyecto.clave_proyecto}"? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        await api.delete(`/proyectos/${proyecto.id}`)
        mostrarSuccess('Proyecto eliminado')
        if (seleccionado?.id === proyecto.id) setSeleccionado(null)
        cargarDatos()
      }
    })
  }

  // ── Asignación ──────────────────────────────────────────
  const abrirAsignacion = (proyecto) => {
    setProyectoActivo(proyecto)
    setModalMetodo(true)
  }

  const handleSeleccionarMetodo = (metodo) => {
    setMetodoSelected(metodo)
    setModalMetodo(false)
    setModalMapa(true)
  }

  const handleAsignacionExitosa = async (total) => {
    mostrarSuccess(`${total} predios asignados exitosamente`)
    cargarDatos()
    if (seleccionado?.id === proyectoActivo?.id) {
      setSeleccionado({ ...seleccionado, total_predios: (seleccionado.total_predios || 0) + total })
    }
    // Dispara regeneración offline en background (fire-and-forget)
    // El progreso detallado se ve en la página de detalle.
    if (proyectoActivo?.id) {
      try {
        await api.post(
          `/proyectos/${proyectoActivo.id}/proyecto-offline/generar`,
          null,
          { params: { reemplazar: true } }
        )
        if (seleccionado?.id === proyectoActivo?.id) {
          cargarEstadoOffline(proyectoActivo.id)
        }
      } catch (e) {
        console.warn('[offline] regeneración tras asignación falló:', e?.message)
      }
    }
  }

  // ── Columnas DataGrid ───────────────────────────────────
  const columnas = [
    {
      field:       'clave_proyecto',
      headerName:  'Clave',
      width:       160,
      align:       'center',
      headerAlign: 'center',
      renderCell: ({ value }) => (
        <Typography variant="body2" fontWeight={600}>{value}</Typography>
      )
    },
    {
      field:      'descripcion',
      headerName: 'Descripción',
      flex:       1
    },
    {
      field:      'estado',
      headerName: 'Estado',
      width:      120,
      renderCell: ({ value }) => (
        <Chip
          label={value}
          size="small"
          color={coloresEstado[value] || 'default'}
        />
      )
    },
    {
      field:      'responsable',
      headerName: 'Responsable',
      width:      200
    },
    {
      field:      'total_predios',
      headerName: 'Predios',
      width:      90,
      renderCell: ({ value }) => (
        <Chip label={value || 0} size="small" variant="outlined" />
      )
    },
    {
      field:       'acciones',
      headerName:  'Acciones',
      width:       260,
      sortable:    false,
      align:       'center',
      headerAlign: 'center',
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="center" width="100%">

          {puedeAdmin && (
            <>
              <Tooltip title="Asignar predios">
                <IconButton
                  size="small"
                  color="success"
                  onClick={() => abrirAsignacion(row)}
                >
                  <AssignmentIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Editar">
                <IconButton size="small" onClick={() => abrirEditar(row)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Cambiar responsable">
                <IconButton
                  size="small"
                  color="warning"
                  onClick={() => abrirCambiarResponsable(row)}
                >
                  <SwapHorizIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Eliminar">
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handleEliminar(row)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
      )
    }
  ]

  return (
    <Box sx={{ p: 3 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          Proyectos de asignación
        </Typography>
        {puedeAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={abrirCrear}>
            Nuevo proyecto
          </Button>
        )}
      </Box>

      {/* Alertas */}
      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Detalle del proyecto seleccionado */}
      {seleccionado && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FolderIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  {seleccionado.clave_proyecto}
                </Typography>
                <Chip
                  label={seleccionado.estado}
                  size="small"
                  color={coloresEstado[seleccionado.estado] || 'default'}
                />
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                {/* Chip "Generando offline" mientras el proyecto se está generando */}
                {['pendiente', 'procesando'].includes(estadoOffline?.estado_generacion) && (
                  <Chip
                    size="small"
                    color="info"
                    icon={<CircularProgress size={14} sx={{ color: 'inherit' }} />}
                    label={`Generando offline… ${estadoOffline?.progreso ?? 0}%`}
                  />
                )}
                {estadoOffline?.estado_generacion === 'error' && (
                  <Chip size="small" color="error" label="Error generando offline" />
                )}

                {estadoOffline?.estado_generacion === 'terminado' && estadoOffline?.archivo_existe && (
                  <Button
                    variant="outlined"
                    startIcon={descargando ? <CircularProgress size={16} /> : <DownloadIcon />}
                    onClick={() => handleDescargar(seleccionado)}
                    disabled={descargando}
                  >
                    {descargando ? 'Descargando...' : 'Descargar offline'}
                  </Button>
                )}

                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={descargandoQGZ ? <CircularProgress size={16} /> : <MapIcon />}
                  onClick={() => handleDescargarQGZ(seleccionado)}
                  disabled={descargandoQGZ}
                >
                  {descargandoQGZ ? 'Descargando...' : 'Descargar área'}
                </Button>

                <Button
                  variant="outlined"
                  startIcon={<MapIcon />}
                  onClick={() => navigate(`/asignaciones/${seleccionado.id}`)}
                >
                  Ver detalle
                </Button>
              </Stack>
            </Box>

            <Divider sx={{ mb: 2 }} />

            <Grid container spacing={3}>
              <Grid item xs={12} sm={4}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PersonIcon color="action" fontSize="small" />
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Responsable
                    </Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {seleccionado.responsable || 'Sin asignar'}
                    </Typography>
                  </Box>
                </Box>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <MapIcon color="action" fontSize="small" />
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Total predios
                    </Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {seleccionado.total_predios || 0}
                    </Typography>
                  </Box>
                </Box>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Descripción
                  </Typography>
                  <Typography variant="body2">
                    {seleccionado.descripcion || 'Sin descripción'}
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      <br />

      {/* Tabla */}
      <DataGrid
        rows={proyectos}
        columns={columnas}
        loading={loading}
        autoHeight
        pageSizeOptions={[10, 25, 50]}
        initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
        onRowClick={({ row }) => {
          setSeleccionado(row)
          detenerPolling()
          cargarEstadoOffline(row.id)
        }}
        disableRowSelectionOnClick={false}
        sx={{
          bgcolor: 'background.paper',
          borderRadius: 2,
          '& .MuiDataGrid-row': { cursor: 'pointer' },
          '& .MuiDataGrid-row.Mui-selected': {
            bgcolor: 'secundary.main',
            '&:hover': { bgcolor: 'secundary.main' }
          },
          // Centrar verticalmente el contenido de todas las celdas
          '& .MuiDataGrid-cell': {
            display: 'flex',
            alignItems: 'center',
          },
        }}
      />

      {/* ── Modal Crear / Editar ─────────────────────────── */}
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editando ? 'Editar proyecto' : 'Nuevo proyecto'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Clave del proyecto"
              value={form.clave_proyecto}
              onChange={e => setForm({ ...form, clave_proyecto: e.target.value })}
              disabled={!!editando}
              fullWidth required
              helperText="Ejemplo: PRY-2024-001"
            />
            <TextField
              label="Descripción"
              value={form.descripcion}
              onChange={e => setForm({ ...form, descripcion: e.target.value })}
              fullWidth multiline rows={3}
            />
            {editando && (
              <TextField
                select fullWidth
                label="Estado"
                value={form.estado}
                onChange={e => setForm({ ...form, estado: e.target.value })}
              >
                <MenuItem value="campo">Campo</MenuItem>
                <MenuItem value="validacion">Validación</MenuItem>
                <MenuItem value="finalizado">Finalizado</MenuItem>
              </TextField>
            )}
            <TextField
              select fullWidth
              label="Responsable"
              value={form.responsable_id}
              onChange={e => setForm({ ...form, responsable_id: e.target.value })}
              required
            >
              {personas.map(p => (
                <MenuItem key={p.id} value={p.id}>
                  {p.primer_nombre} {p.primer_apellido} — {(p.roles || []).join(', ')}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setModalOpen(false)}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleGuardar}
            disabled={guardando || !form.clave_proyecto || !form.responsable_id}
          >
            {guardando ? <CircularProgress size={20} /> : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Modal Cambiar Responsable ────────────────────── */}
      <Dialog open={modalResp} onClose={() => setModalResp(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Cambiar responsable</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Todos los predios del proyecto serán reasignados a la nueva persona.
          </Alert>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Proyecto: <strong>{proyectoResp?.clave_proyecto}</strong><br />
            Responsable actual: <strong>{proyectoResp?.responsable}</strong>
          </Typography>
          <TextField
            select fullWidth
            label="Nuevo responsable"
            value={nuevoResp}
            onChange={e => setNuevoResp(e.target.value)}
          >
            {personas
              .filter(p => p.id !== proyectoResp?.responsable_id)
              .map(p => (
                <MenuItem key={p.id} value={p.id}>
                  {p.primer_nombre} {p.primer_apellido}
                </MenuItem>
              ))
            }
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setModalResp(false)}>Cancelar</Button>
          <Button
            variant="contained" color="warning"
            onClick={handleCambiarResponsable}
            disabled={!nuevoResp}
          >
            Cambiar
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Modal Confirmación ───────────────────────────── */}
      <Dialog open={modalConfirm} onClose={() => !confirmando && setModalConfirm(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningIcon color="warning" />
            {confirmData.titulo}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">{confirmData.mensaje}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setModalConfirm(false)} disabled={confirmando}>
            Cancelar
          </Button>
          <Button
            variant="contained" color="error"
            onClick={handleConfirmar}
            disabled={confirmando}
          >
            {confirmando ? <CircularProgress size={20} color="inherit" /> : 'Confirmar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Modales de asignación ────────────────────────── */}
      <ModalMetodoAsignacion
        open={modalMetodo}
        onClose={() => setModalMetodo(false)}
        onSelect={handleSeleccionarMetodo}
      />

      <ModalMapaAsignacion
        open={modalMapa}
        onClose={() => setModalMapa(false)}
        metodo={metodoSelected}
        proyecto={proyectoActivo}
        onAsignar={handleAsignacionExitosa}
      />

    </Box>
  )
}
