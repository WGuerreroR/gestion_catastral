import { useState, useEffect, useCallback } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, Grid, IconButton, InputLabel, MenuItem, Select,
  Stack, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import ArrowBackIcon  from '@mui/icons-material/ArrowBack'
import FactCheckIcon  from '@mui/icons-material/FactCheck'
import ShuffleIcon    from '@mui/icons-material/Shuffle'
import TableChartIcon from '@mui/icons-material/TableChart'
import MapIcon        from '@mui/icons-material/Map'
import DeleteIcon     from '@mui/icons-material/Delete'
import DoneAllIcon    from '@mui/icons-material/DoneAll'
import DownloadIcon   from '@mui/icons-material/Download'
import EditIcon       from '@mui/icons-material/Edit'
import LockIcon       from '@mui/icons-material/Lock'
import AssignmentIcon from '@mui/icons-material/Assignment'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api/axios'
import MapaCalidad, { COLORES } from '../components/MapaCalidad'
import { getErrorMessage } from '../utils/errorHandler'

const Z_POR_CONFIANZA = { 0.9: 1.645, 0.95: 1.96, 0.99: 2.58 }
function calcMuestra(N, e, conf = 0.95) {
  if (N <= 0) return 0
  if (N === 1) return 1
  const Z = Z_POR_CONFIANZA[conf] || 1.96
  const num = N * Z * Z * 0.25
  const den = e * e * (N - 1) + Z * Z * 0.25
  return Math.max(1, Math.ceil(num / den))
}

export default function CalidadAsignacionesDetalle() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [proyecto,     setProyecto]     = useState(null)
  const [predios,      setPredios]      = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [geojson,      setGeojson]      = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [tab,          setTab]          = useState(0)
  const [filtro,       setFiltro]       = useState('todos')
  const [error,        setError]        = useState('')
  const [success,      setSuccess]      = useState('')
  const [predioActivo, setPredioActivo] = useState(null)
  const [confirmarEliminar, setConfirmarEliminar] = useState(false)
  const [eliminando,   setEliminando]   = useState(false)
  const [rerandomOpen, setRerandomOpen] = useState(false)
  const [rerandomMargen, setRerandomMargen] = useState(0.10)
  const [rerandomizando,  setRerandomizando]  = useState(false)
  const [cerrarOpen, setCerrarOpen]   = useState(false)
  const [cerrando,    setCerrando]    = useState(false)
  const [validandoId, setValidandoId] = useState(null)  // id_operacion del que se está toggleando
  const [editarOpen,  setEditarOpen]  = useState(false)
  const [editNombre,  setEditNombre]  = useState('')
  const [editDescripcion, setEditDescripcion] = useState('')
  const [guardando,   setGuardando]   = useState(false)
  const [descargandoQgis, setDescargandoQgis] = useState(false)

  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }
  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   4000) }

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const [prRes, pdRes, asRes] = await Promise.all([
        api.get(`/calidad-muestreo/${id}`),
        api.get(`/calidad-muestreo/${id}/predios`),
        api.get(`/calidad-muestreo/${id}/asignaciones`),
      ])
      setProyecto(prRes.data)
      setPredios(pdRes.data)
      setAsignaciones(asRes.data)
    } catch {
      mostrarError('Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    if (tab !== 1 || geojson) return
    api.get(`/calidad-muestreo/${id}/geojson`)
      .then(({ data }) => setGeojson(data))
      .catch(() => {})
  }, [tab, id, geojson])

  const handleEliminar = async () => {
    setEliminando(true)
    try {
      await api.delete(`/calidad-muestreo/${id}`)
      navigate('/calidad-asignaciones')
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al eliminar el proyecto'))
      setEliminando(false)
      setConfirmarEliminar(false)
    }
  }

  const abrirRerandomizar = () => {
    setRerandomMargen(Number(proyecto?.margen_error ?? 0.10))
    setRerandomOpen(true)
  }
  const abrirEditar = () => {
    setEditNombre(proyecto?.nombre ?? '')
    setEditDescripcion(proyecto?.descripcion ?? '')
    setEditarOpen(true)
  }
  const guardarEdicion = async () => {
    if (!editNombre.trim()) return
    setGuardando(true)
    try {
      await api.put(`/calidad-muestreo/${id}`, {
        nombre:      editNombre.trim(),
        descripcion: editDescripcion.trim() || null,
      })
      setEditarOpen(false)
      mostrarSuccess('Proyecto actualizado')
      cargar()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al actualizar el proyecto'))
    } finally {
      setGuardando(false)
    }
  }

  const descargarQgis = async () => {
    setDescargandoQgis(true)
    try {
      const response = await api.get(`/calidad-muestreo/${id}/descargar-qgis`,
        { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      // Si el server pasa un Content-Disposition con filename, usarlo; sino fallback.
      const cd = response.headers?.['content-disposition'] || ''
      const m  = cd.match(/filename="([^"]+)"/)
      link.download = m ? m[1] : `calidad_${id}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error descargando proyecto QGIS'))
    } finally {
      setDescargandoQgis(false)
    }
  }

  const togglearValidado = async (predio) => {
    if (proyecto?.estado === 'cerrado') return
    setValidandoId(predio.id_operacion)
    try {
      await api.patch(
        `/calidad-muestreo/${id}/predios/${encodeURIComponent(predio.id_operacion)}/validacion`,
        { validado: !predio.validado },
      )
      cargar()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al marcar el predio'))
    } finally {
      setValidandoId(null)
    }
  }

  const ejecutarCerrar = async () => {
    setCerrando(true)
    try {
      const data = await api.post(`/calidad-muestreo/${id}/cerrar`)
      setCerrarOpen(false)
      mostrarSuccess(`Proyecto cerrado: ${data.data.predios_marcados} predios marcados con calidad_campo=1`)
      cargar()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al cerrar el proyecto'))
    } finally {
      setCerrando(false)
    }
  }

  const ejecutarRerandomizar = async () => {
    setRerandomizando(true)
    try {
      const margenActual = Number(proyecto?.margen_error ?? 0.10)
      const body = rerandomMargen !== margenActual
        ? { margen_error: rerandomMargen }
        : {}
      await api.post(`/calidad-muestreo/${id}/rerandomizar`, body)
      setRerandomOpen(false)
      mostrarSuccess('Muestra recalculada exitosamente')
      setGeojson(null)
      cargar()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al recalcular la muestra'))
    } finally {
      setRerandomizando(false)
    }
  }

  const prediosFiltrados = predios.filter(p => {
    if (filtro === 'muestra')    return p.en_muestra
    if (filtro === 'no_muestra') return !p.en_muestra
    return true
  })

  const proyectoCerrado = proyecto?.estado === 'cerrado'

  const columnasPredios = [
    { field: 'id_operacion', headerName: 'ID operación', width: 130 },
    {
      field: 'npn', headerName: 'NPN', width: 200,
      valueGetter: (_v, row) => row?.npn || row?.npn_etiqueta || '—'
    },
    { field: 'nombre_predio', headerName: 'Nombre', flex: 1 },
    {
      field: 'en_muestra', headerName: 'Muestra', width: 110,
      renderCell: ({ value }) => value
        ? <Chip label="Muestra" size="small" color="primary" icon={<ShuffleIcon />} />
        : <Chip label="—" size="small" />
    },
    {
      field: 'validado', headerName: 'Validar', width: 100, sortable: false,
      renderCell: ({ row }) => {
        if (!row.en_muestra) return null
        const cargandoEsta = validandoId === row.id_operacion
        return (
          <Checkbox
            size="small"
            checked={Boolean(row.validado)}
            disabled={proyectoCerrado || cargandoEsta}
            onChange={() => togglearValidado(row)}
          />
        )
      },
    },
  ]

  const columnasAsignaciones = [
    { field: 'clave_proyecto',    headerName: 'Asignación', width: 180 },
    { field: 'responsable',       headerName: 'Operador',   flex: 1 },
    { field: 'estado_asignacion', headerName: 'Estado',     width: 130,
      renderCell: ({ value }) => <Chip label={value} size="small" /> },
    { field: 'total_predios',     headerName: 'Predios',    width: 100,
      renderCell: ({ value }) => <Chip label={value} size="small" variant="outlined" /> },
  ]

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <CircularProgress />
    </Box>
  )

  const areaGeojson  = geojson?.area_proyecto || null

  return (
    <Box sx={{ p: 3 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/calidad-asignaciones')}>
          <ArrowBackIcon />
        </IconButton>
        <FactCheckIcon color="primary" />
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h5" fontWeight={600}>{proyecto?.nombre}</Typography>
            <Tooltip title={proyecto?.estado === 'cerrado'
              ? 'No se puede editar un proyecto cerrado'
              : 'Editar nombre y descripción'}>
              <span>
                <IconButton size="small" onClick={abrirEditar}
                  disabled={proyecto?.estado === 'cerrado'}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Chip label="Asignación" size="small" color="primary" />
            <Chip
              label={proyecto?.estado}
              size="small"
              color={proyecto?.estado === 'activo' ? 'success' : 'default'}
            />
            {proyecto?.margen_error != null && (
              <Chip
                size="small" variant="outlined"
                label={`Margen ${Math.round(proyecto.margen_error * 100)}% · IC ${Math.round((proyecto.nivel_confianza ?? 0.95) * 100)}%`}
              />
            )}
            {proyecto?.estado === 'cerrado' && proyecto?.fecha_cierre && (
              <Chip
                size="small" color="success" icon={<LockIcon />}
                label={`Cerrado el ${new Date(proyecto.fecha_cierre).toLocaleDateString('es-CO')}`}
              />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {proyecto?.descripcion || 'Sin descripción'}
          </Typography>
        </Box>
        {(() => {
          const cerrado = proyecto?.estado === 'cerrado'
          const todosValidados = (proyecto?.muestra_calculada ?? 0) > 0 &&
            (proyecto?.validados_count ?? 0) >= (proyecto?.muestra_calculada ?? 0)
          const disabled = cerrado || todosValidados
          const tooltip = cerrado
            ? 'Proyecto cerrado: no admite cambios'
            : todosValidados
              ? 'Todos los predios muestra están validados — no se puede recalcular'
              : 'Recalcular muestra (cambia margen y/o re-sortea)'
          return (
            <Tooltip title={tooltip}>
              <span>
                <Button
                  variant="outlined" color="primary"
                  startIcon={<ShuffleIcon />}
                  onClick={abrirRerandomizar}
                  disabled={disabled}
                >
                  Recalcular muestra
                </Button>
              </span>
            </Tooltip>
          )
        })()}
        <Tooltip title={!proyecto?.area_geojson
          ? 'El proyecto no tiene área (sin asignaciones con geometría)'
          : 'Descargar proyecto QGIS (.zip)'}>
          <span>
            <Button
              variant="outlined"
              startIcon={descargandoQgis
                ? <CircularProgress size={16} />
                : <DownloadIcon />}
              onClick={descargarQgis}
              disabled={descargandoQgis || !proyecto?.area_geojson}
            >
              {descargandoQgis ? 'Generando…' : 'Descargar QGIS'}
            </Button>
          </span>
        </Tooltip>
        <Button
          variant="contained" color="success"
          startIcon={<DoneAllIcon />}
          onClick={() => setCerrarOpen(true)}
          disabled={
            proyecto?.estado === 'cerrado' ||
            (proyecto?.validados_count ?? 0) < (proyecto?.muestra_calculada ?? 0)
          }
        >
          Cerrar proyecto
        </Button>
        <Button
          variant="outlined" color="error"
          startIcon={<DeleteIcon />}
          onClick={() => setConfirmarEliminar(true)}
        >
          Eliminar
        </Button>
      </Box>

      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Cards resumen */}
      {(() => {
        const validados   = proyecto?.validados_count ?? 0
        const muestra     = proyecto?.muestra_calculada ?? 0
        const colorValid  = validados >= muestra && muestra > 0 ? 'success.main' : 'warning.main'
        const cards = [
          { label: 'Asignaciones',      value: proyecto?.asignaciones_count ?? asignaciones.length, color: 'text.primary' },
          { label: 'Total predios',     value: proyecto?.total_predios,     color: 'text.primary' },
          { label: 'Muestra calculada', value: muestra,                     color: 'primary.main' },
          { label: 'Validados',         value: `${validados} / ${muestra}`, color: colorValid },
        ]
        return (
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {cards.map(({ label, value, color }) => (
              <Grid item xs={6} sm={3} key={label}>
                <Card>
                  <CardContent sx={{ textAlign: 'center', py: 2 }}>
                    <Typography variant="h4" fontWeight={700} color={color}>{value}</Typography>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )
      })()}

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab icon={<TableChartIcon />} iconPosition="start" label="Predios" />
        <Tab icon={<MapIcon />}        iconPosition="start" label="Mapa" />
        <Tab icon={<AssignmentIcon />} iconPosition="start" label={`Asignaciones (${asignaciones.length})`} />
      </Tabs>

      {/* Tab Predios */}
      {tab === 0 && (
        <Box>
          <Stack direction="row" spacing={1} mb={2}>
            {[
              { key: 'todos',      label: 'Todos'            },
              { key: 'muestra',    label: 'Solo muestra'     },
              { key: 'no_muestra', label: 'No seleccionados' },
            ].map(f => (
              <Chip key={f.key} label={f.label}
                onClick={() => setFiltro(f.key)}
                color={filtro === f.key ? 'primary' : 'default'}
                variant={filtro === f.key ? 'filled' : 'outlined'}
              />
            ))}
          </Stack>
          <DataGrid
            rows={prediosFiltrados}
            getRowId={(row) => row.id_operacion}
            columns={columnasPredios}
            autoHeight
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            disableRowSelectionOnClick
            sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
          />
        </Box>
      )}

      {/* Tab Mapa — siempre en DOM para preservar el OL map */}
      <Box sx={{ display: tab === 1 ? 'flex' : 'none', gap: 2 }}>
        <Box sx={{
          flexGrow: 1, borderRadius: 2, overflow: 'hidden',
          position: 'relative', border: '1px solid', borderColor: 'divider',
        }}>
          <MapaCalidad
            geojson={geojson}
            areaGeojson={areaGeojson}
            height={550}
            onClickPredioo={setPredioActivo}
          />

          <Card sx={{ position: 'absolute', bottom: 16, left: 16, zIndex: 1000, p: 1.5 }}>
            <Typography variant="caption" fontWeight={600} display="block" mb={1}>
              Leyenda
            </Typography>
            {[
              { label: 'Universo', c: COLORES.universo, dash: false },
              { label: 'Muestra',  c: COLORES.muestra,  dash: false },
              { label: 'Área evaluada', c: COLORES.area, dash: true },
            ].map(({ label, c, dash }) => (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Box sx={{
                  width: 14, height: 14, borderRadius: 0.5,
                  bgcolor: c.fill,
                  border: `2px ${dash ? 'dashed' : 'solid'} ${c.stroke}`,
                }} />
                <Typography variant="caption">{label}</Typography>
              </Box>
            ))}
          </Card>
        </Box>

        {predioActivo && (
          <Card sx={{ width: 240, overflow: 'auto', height: 550 }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={600} mb={1}>
                Detalle del predio
              </Typography>
              <Divider sx={{ mb: 1.5 }} />
              <Stack spacing={1}>
                {[
                  { label: 'NPN',     value: predioActivo.npn_etiqueta || predioActivo.npn },
                  { label: 'Nombre',  value: predioActivo.nombre_predio },
                  { label: 'Municipio', value: predioActivo.municipio },
                ].map(({ label, value }) => (
                  <Box key={label}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="body2" fontWeight={500}>{value || '—'}</Typography>
                  </Box>
                ))}
                <Box>
                  <Typography variant="caption" color="text.secondary">En muestra</Typography>
                  <Box mt={0.5}>
                    {predioActivo.en_muestra
                      ? <Chip label="Muestra" size="small" color="primary" icon={<ShuffleIcon />} />
                      : <Chip label="No seleccionado" size="small" />
                    }
                  </Box>
                </Box>
                <Button size="small" variant="outlined"
                  onClick={() => window.open(
                    `/predios/visor?busqueda=${encodeURIComponent(predioActivo.npn || predioActivo.id_operacion)}`,
                    '_blank',
                  )}>
                  Abrir en visor
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Box>

      {/* Tab Asignaciones */}
      {tab === 2 && (
        <DataGrid
          rows={asignaciones}
          getRowId={(row) => row.asignacion_id}
          columns={columnasAsignaciones}
          autoHeight
          pageSizeOptions={[10, 25]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          disableRowSelectionOnClick
          sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
        />
      )}

      {/* Dialog recalcular muestra */}
      <Dialog
        open={rerandomOpen}
        onClose={() => !rerandomizando && setRerandomOpen(false)}
        maxWidth="xs" fullWidth
      >
        <DialogTitle>Recalcular muestra</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Margen de error</InputLabel>
              <Select
                value={rerandomMargen}
                label="Margen de error"
                onChange={(e) => setRerandomMargen(parseFloat(e.target.value))}
                disabled={rerandomizando}
              >
                <MenuItem value={0.05}>5%</MenuItem>
                <MenuItem value={0.10}>10%</MenuItem>
                <MenuItem value={0.15}>15%</MenuItem>
                <MenuItem value={0.20}>20%</MenuItem>
                <MenuItem value={0.25}>25%</MenuItem>
              </Select>
            </FormControl>

            {(() => {
              const margenActual = Number(proyecto?.margen_error ?? 0.10)
              const conf         = Number(proyecto?.nivel_confianza ?? 0.95)
              const N            = Number(proyecto?.total_predios ?? 0)
              const cambia       = rerandomMargen !== margenActual
              const nuevaMuestra = cambia ? calcMuestra(N, rerandomMargen, conf) : (proyecto?.muestra_calculada ?? 0)
              return (
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {cambia
                      ? `Cambiando margen ${Math.round(margenActual*100)}% → ${Math.round(rerandomMargen*100)}%, la muestra pasa de ${proyecto?.muestra_calculada} a:`
                      : 'Se re-sortearán los predios manteniendo el tamaño actual:'}
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Chip
                      label={`${nuevaMuestra} predios`}
                      color="primary"
                      icon={<ShuffleIcon />}
                    />
                    {cambia && (
                      <Chip
                        size="small" variant="outlined" color="warning"
                        label="se actualizará el proyecto"
                      />
                    )}
                  </Stack>
                </Box>
              )
            })()}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRerandomOpen(false)} disabled={rerandomizando}>
            Cancelar
          </Button>
          <Button
            variant="contained" color="primary"
            onClick={ejecutarRerandomizar}
            disabled={rerandomizando}
            startIcon={rerandomizando
              ? <CircularProgress size={16} color="inherit" />
              : <ShuffleIcon />}
          >
            {rerandomizando ? 'Procesando...' : 'Recalcular'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog editar */}
      <Dialog
        open={editarOpen}
        onClose={() => !guardando && setEditarOpen(false)}
        maxWidth="sm" fullWidth
      >
        <DialogTitle>Editar proyecto</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus fullWidth size="small" required
              label="Nombre del proyecto"
              value={editNombre}
              onChange={(e) => setEditNombre(e.target.value)}
              disabled={guardando}
            />
            <TextField
              fullWidth size="small" multiline rows={3}
              label="Descripción"
              value={editDescripcion}
              onChange={(e) => setEditDescripcion(e.target.value)}
              disabled={guardando}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditarOpen(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            variant="contained" color="primary"
            onClick={guardarEdicion}
            disabled={guardando || !editNombre.trim()}
            startIcon={guardando
              ? <CircularProgress size={16} color="inherit" />
              : <EditIcon />}
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog cerrar proyecto */}
      <Dialog
        open={cerrarOpen}
        onClose={() => !cerrando && setCerrarOpen(false)}
        maxWidth="sm" fullWidth
      >
        <DialogTitle>Cerrar proyecto y propagar calidad de campo</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              Todos los <strong>{proyecto?.muestra_calculada}</strong> predios de la muestra
              fueron validados.
            </Typography>
            <Typography variant="body2">
              Al confirmar, se marcarán <strong>{proyecto?.total_predios}</strong> predios
              del universo (incluidos los no muestreados) con{' '}
              <code>calidad_campo = 1</code> en <code>lc_predio_p</code>, y el proyecto
              pasará a estado <strong>cerrado</strong>.
            </Typography>
            <Alert severity="warning">
              Esta acción es irreversible. Después del cierre no se podrá modificar la
              muestra ni revertir las marcas de calidad.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCerrarOpen(false)} disabled={cerrando}>
            Cancelar
          </Button>
          <Button
            variant="contained" color="success"
            onClick={ejecutarCerrar}
            disabled={cerrando}
            startIcon={cerrando
              ? <CircularProgress size={16} color="inherit" />
              : <DoneAllIcon />}
          >
            {cerrando ? 'Cerrando...' : 'Cerrar y propagar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog eliminar */}
      <Dialog
        open={confirmarEliminar}
        onClose={() => !eliminando && setConfirmarEliminar(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Eliminar proyecto</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            ¿Seguro que deseas eliminar el proyecto{' '}
            <strong>{proyecto?.nombre}</strong>? Esta acción no se puede deshacer
            y se eliminarán también el universo y la muestra asociados.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmarEliminar(false)} disabled={eliminando}>
            Cancelar
          </Button>
          <Button
            variant="contained" color="error"
            onClick={handleEliminar}
            disabled={eliminando}
            startIcon={eliminando
              ? <CircularProgress size={16} color="inherit" />
              : <DeleteIcon />}
          >
            {eliminando ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}
