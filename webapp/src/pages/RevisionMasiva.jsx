import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box, Typography, Alert, AlertTitle, CircularProgress, IconButton, Tooltip, Checkbox,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Chip,
  Autocomplete, TextField, FormGroup, FormControlLabel, LinearProgress, Stack
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import FactCheckIcon       from '@mui/icons-material/FactCheck'
import VisibilityIcon      from '@mui/icons-material/Visibility'
import BookmarkIcon        from '@mui/icons-material/Bookmark'
import RefreshIcon         from '@mui/icons-material/Refresh'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import WarningAmberIcon    from '@mui/icons-material/WarningAmber'
import revisionMasivaApi from '../api/revisionMasiva'
import { getErrorMessage } from '../utils/errorHandler'
import MarcasPredio   from '../components/marcas/MarcasPredio'
import PredioVisor    from '../components/predio-visor/PredioVisor'
import predioCompletoLectura from '../config/predio-forms/predio-completo-lectura.json'

const CAMPOS_CALIDAD = [
  { campo: 'calidad_campo',          label: 'Campo',          marcasField: null                              },
  { campo: 'calidad_sig',            label: 'SIG',            marcasField: 'marcas_abiertas_sig'             },
  { campo: 'calidad_identificacion', label: 'Identificación', marcasField: 'marcas_abiertas_identificacion'  },
  { campo: 'calidad_fisica',         label: 'Física',         marcasField: 'marcas_abiertas_fisica'          },
  { campo: 'calidad_juridica',       label: 'Jurídica',       marcasField: 'marcas_abiertas_juridica'        },
  { campo: 'calidad_economica',      label: 'Económica',      marcasField: 'marcas_abiertas_economica'       },
]

export default function RevisionMasiva() {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')
  const [actualizando, setActualizando] = useState({}) // { `${id}:${campo}`: true }

  const [filtroManzana, setFiltroManzana] = useState(null)

  const [modalMarcas,   setModalMarcas]   = useState({ open: false, idOperacion: null })
  const [modalDetalles, setModalDetalles] = useState({ open: false, idOperacion: null })

  // Validación masiva
  const [modalMasiva, setModalMasiva] = useState(false)
  const [criteriosSel, setCriteriosSel] = useState(
    () => CAMPOS_CALIDAD.reduce((acc, c) => ({ ...acc, [c.campo]: true }), {})
  )
  const [ejecutandoMasiva, setEjecutandoMasiva] = useState(false)
  const [progresoMasiva, setProgresoMasiva] = useState({ hechos: 0, total: 0 })

  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   5000) }
  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000) }

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const data = await revisionMasivaApi.listar()
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error cargando predios para revisión'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Deriva la manzana (LEFT(numero_predial, 17)) por fila y la lista
  // única de manzanas presentes en los datos cargados.
  const rowsConManzana = useMemo(
    () => rows.map(r => ({
      ...r,
      manzana: r.numero_predial ? String(r.numero_predial).slice(0, 17) : '',
    })),
    [rows]
  )

  const manzanasDisponibles = useMemo(() => {
    const set = new Set(rowsConManzana.map(r => r.manzana).filter(Boolean))
    return Array.from(set).sort()
  }, [rowsConManzana])

  const rowsFiltradas = useMemo(
    () => filtroManzana
      ? rowsConManzana.filter(r => r.manzana === filtroManzana)
      : rowsConManzana,
    [rowsConManzana, filtroManzana]
  )

  const toggleCalidad = async (row, campo) => {
    const key = `${row.id_operacion}:${campo}`
    if (actualizando[key]) return

    const valorActual = Number(row[campo] || 0)
    const valorNuevo  = valorActual === 1 ? 0 : 1

    setActualizando(prev => ({ ...prev, [key]: true }))
    setRows(prev => prev.map(r =>
      r.id_operacion === row.id_operacion ? { ...r, [campo]: valorNuevo } : r
    ))

    try {
      const resp = await revisionMasivaApi.actualizarCalidad(row.id_operacion, campo, valorNuevo)
      if (resp?.ucs_recalculadas > 0) {
        mostrarSuccess(
          `Calificación recalculada en ${resp.ucs_recalculadas} unidad${resp.ucs_recalculadas === 1 ? '' : 'es'} de construcción`
        )
      }
    } catch (e) {
      // Rollback
      setRows(prev => prev.map(r =>
        r.id_operacion === row.id_operacion ? { ...r, [campo]: valorActual } : r
      ))
      mostrarError(getErrorMessage(e, `No se pudo actualizar ${campo}`))
    } finally {
      setActualizando(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  // ── Validación masiva sobre los predios filtrados ─────────────────
  const criteriosElegidos = CAMPOS_CALIDAD.filter(c => criteriosSel[c.campo])

  // Cuenta cuántos (predio, criterio) se intentarían marcar (pendientes
  // y no bloqueados por marcas abiertas).
  const previewMasiva = useMemo(() => {
    let pendientes = 0, yaAprobados = 0, bloqueados = 0
    for (const row of rowsFiltradas) {
      for (const c of criteriosElegidos) {
        const aprobado = Number(row[c.campo] || 0) === 1
        const marcas   = c.marcasField ? Number(row[c.marcasField] || 0) : 0
        if (aprobado) yaAprobados += 1
        else if (marcas > 0) bloqueados += 1
        else pendientes += 1
      }
    }
    return { pendientes, yaAprobados, bloqueados }
  }, [rowsFiltradas, criteriosElegidos])

  const ejecutarMasiva = async () => {
    if (ejecutandoMasiva) return
    const tareas = []
    for (const row of rowsFiltradas) {
      for (const c of criteriosElegidos) {
        const aprobado = Number(row[c.campo] || 0) === 1
        const marcas   = c.marcasField ? Number(row[c.marcasField] || 0) : 0
        if (!aprobado && marcas === 0) {
          tareas.push({ idOperacion: row.id_operacion, campo: c.campo })
        }
      }
    }

    setEjecutandoMasiva(true)
    setProgresoMasiva({ hechos: 0, total: tareas.length })

    let ok = 0, fallidos = 0, ucsRecalc = 0
    const idsAfectados = new Set()
    for (let i = 0; i < tareas.length; i++) {
      const t = tareas[i]
      try {
        const resp = await revisionMasivaApi.actualizarCalidad(t.idOperacion, t.campo, 1)
        ok += 1
        idsAfectados.add(t.idOperacion)
        if (resp?.ucs_recalculadas) ucsRecalc += resp.ucs_recalculadas
      } catch {
        fallidos += 1
      }
      setProgresoMasiva({ hechos: i + 1, total: tareas.length })
    }

    setEjecutandoMasiva(false)
    setModalMasiva(false)

    if (ok > 0) {
      mostrarSuccess(
        `${ok} aprobación${ok === 1 ? '' : 'es'} aplicada${ok === 1 ? '' : 's'}. ` +
        `${idsAfectados.size} predio${idsAfectados.size === 1 ? '' : 's'} listo${idsAfectados.size === 1 ? '' : 's'} para validación de calidad.` +
        (ucsRecalc > 0
          ? ` Calificación recalculada en ${ucsRecalc} UC${ucsRecalc === 1 ? '' : 's'}.`
          : '')
      )
    }
    if (fallidos > 0) mostrarError(`${fallidos} actualizaci${fallidos === 1 ? 'ón falló' : 'ones fallaron'}`)

    // Recargar para refrescar conteos de marcas y estados
    cargar()
  }

  const columnasCalidad = CAMPOS_CALIDAD.map(({ campo, label, marcasField }) => ({
    field: campo,
    headerName: label,
    width: 110,
    sortable: false,
    filterable: false,
    align: 'center',
    headerAlign: 'center',
    renderCell: ({ row }) => {
      const key = `${row.id_operacion}:${campo}`
      const enProceso = !!actualizando[key]
      const aprobado  = Number(row[campo] || 0) === 1
      const marcasAbiertas = marcasField ? Number(row[marcasField] || 0) : 0
      // Solo bloquea aprobar; desmarcar siempre permitido (alinea con el endpoint)
      const bloqueado = !aprobado && marcasAbiertas > 0

      if (enProceso) return <CircularProgress size={16} />

      const checkbox = (
        <Checkbox
          size="small"
          checked={aprobado}
          onChange={() => toggleCalidad(row, campo)}
          color="success"
          disabled={bloqueado}
        />
      )

      if (bloqueado) {
        return (
          <Tooltip title={`Hay ${marcasAbiertas} marca${marcasAbiertas === 1 ? '' : 's'} abierta${marcasAbiertas === 1 ? '' : 's'} en ${label} — ciérralas para aprobar`}>
            <span>{checkbox}</span>
          </Tooltip>
        )
      }
      return checkbox
    },
  }))

  const columnas = [
    { field: 'id_operacion',     headerName: 'ID Operación', width: 150 },
    { field: 'npn',              headerName: 'NPN',          width: 190 },
    { field: 'nombre_predio',    headerName: 'Identificación', width: 200 },
    { field: 'municipio',        headerName: 'Municipio',    width: 130 },
    { field: 'asignacion_clave', headerName: 'Asignación',   width: 150,
      renderCell: ({ value }) => value
        ? <Chip size="small" label={value} variant="outlined" />
        : <Typography variant="caption" color="text.secondary">—</Typography>
    },
    ...columnasCalidad,
    {
      field: '__seguimiento',
      headerName: 'Seguimiento',
      width: 110,
      sortable: false, filterable: false, align: 'center', headerAlign: 'center',
      renderCell: ({ row }) => (
        <Tooltip title="Ver marcas / seguimiento del predio">
          <IconButton
            size="small"
            onClick={() => setModalMarcas({ open: true, idOperacion: row.id_operacion })}
          >
            <BookmarkIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
    {
      field: '__detalle',
      headerName: 'Detalle',
      width: 90,
      sortable: false, filterable: false, align: 'center', headerAlign: 'center',
      renderCell: ({ row }) => (
        <Tooltip title="Ver detalle del predio">
          <IconButton
            size="small"
            onClick={() => setModalDetalles({ open: true, idOperacion: row.id_operacion })}
          >
            <VisibilityIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ]

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <FactCheckIcon color="primary" />
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          Revisión masiva
        </Typography>
        <Tooltip title="Recargar">
          <span>
            <IconButton onClick={cargar} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Predios pertenecientes a asignaciones cuyos proyectos de calidad ya fueron cerrados
        (validados en campo). Marca cada aspecto a medida que apruebes la revisión.
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Autocomplete
          size="small"
          options={manzanasDisponibles}
          value={filtroManzana}
          onChange={(_, v) => setFiltroManzana(v)}
          sx={{ width: 280 }}
          renderInput={(params) => (
            <TextField {...params} label="Filtrar por manzana" placeholder="Código de manzana" />
          )}
          noOptionsText="Sin manzanas"
          clearOnEscape
        />
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          Mostrando {rowsFiltradas.length} de {rowsConManzana.length} predios
        </Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<PlaylistAddCheckIcon />}
          onClick={() => setModalMasiva(true)}
          disabled={loading || rowsFiltradas.length === 0}
        >
          Validar masivamente
        </Button>
      </Box>

      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <DataGrid
          rows={rowsFiltradas}
          columns={columnas}
          autoHeight
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          disableRowSelectionOnClick
          getRowId={(r) => r.id_operacion}
          sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
        />
      )}

      {/* Modal Seguimiento (marcas) */}
      <Dialog
        open={modalMarcas.open}
        onClose={() => setModalMarcas({ open: false, idOperacion: null })}
        maxWidth="md" fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BookmarkIcon color="primary" />
            Seguimiento del predio
            {modalMarcas.idOperacion && (
              <Chip size="small" label={modalMarcas.idOperacion} variant="outlined" sx={{ ml: 1 }} />
            )}
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {modalMarcas.idOperacion && (
            <MarcasPredio idOperacion={modalMarcas.idOperacion} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalMarcas({ open: false, idOperacion: null })}>
            Cerrar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal Detalle (PredioVisor) */}
      <Dialog
        open={modalDetalles.open}
        onClose={() => setModalDetalles({ open: false, idOperacion: null })}
        maxWidth="lg" fullWidth scroll="paper"
      >
        <DialogTitle>Detalles del predio</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {modalDetalles.idOperacion && (
            <Box sx={{ p: 2 }}>
              <PredioVisor
                formConfig={predioCompletoLectura}
                busqueda={modalDetalles.idOperacion}
                modoOverride="view"
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalDetalles({ open: false, idOperacion: null })}>
            Cerrar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal Validación masiva */}
      <Dialog
        open={modalMasiva}
        onClose={() => !ejecutandoMasiva && setModalMasiva(false)}
        maxWidth="sm" fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PlaylistAddCheckIcon color="primary" />
            Validar masivamente
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Aprobar los aspectos seleccionados para los{' '}
            <strong>{rowsFiltradas.length}</strong> predios filtrados
            {filtroManzana ? <> (manzana <Chip size="small" label={filtroManzana} sx={{ ml: 0.5 }} /></> : null}
            {filtroManzana ? ')' : null}.
          </Typography>

          <Typography variant="caption" color="text.secondary">Criterios a validar:</Typography>
          <FormGroup sx={{ mb: 2 }}>
            {CAMPOS_CALIDAD.map(c => (
              <FormControlLabel
                key={c.campo}
                control={
                  <Checkbox
                    size="small"
                    checked={!!criteriosSel[c.campo]}
                    onChange={(_, v) => setCriteriosSel(prev => ({ ...prev, [c.campo]: v }))}
                    disabled={ejecutandoMasiva}
                  />
                }
                label={c.label}
              />
            ))}
          </FormGroup>

          <Stack spacing={1.5}>
            <Alert severity="warning" icon={<WarningAmberIcon />}>
              <AlertTitle>Advertencia</AlertTitle>
              Tras esta acción, los predios afectados quedarán <strong>listos para la
              validación de calidad</strong>. Los predios con marcas abiertas en alguna
              categoría seleccionada serán omitidos automáticamente.
            </Alert>

            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary">Resumen:</Typography>
              <Typography variant="body2">
                A aplicar: <strong>{previewMasiva.pendientes}</strong>{' '}
                · ya aprobados: {previewMasiva.yaAprobados}{' '}
                · bloqueados por marcas: {previewMasiva.bloqueados}
              </Typography>
            </Box>

            {ejecutandoMasiva && (
              <Box>
                <LinearProgress
                  variant="determinate"
                  value={progresoMasiva.total ? (progresoMasiva.hechos / progresoMasiva.total) * 100 : 0}
                />
                <Typography variant="caption" color="text.secondary">
                  {progresoMasiva.hechos} / {progresoMasiva.total}
                </Typography>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setModalMasiva(false)} disabled={ejecutandoMasiva}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={ejecutarMasiva}
            disabled={
              ejecutandoMasiva ||
              criteriosElegidos.length === 0 ||
              previewMasiva.pendientes === 0
            }
            startIcon={ejecutandoMasiva
              ? <CircularProgress size={16} />
              : <PlaylistAddCheckIcon />}
          >
            {ejecutandoMasiva ? 'Aplicando...' : `Aprobar ${previewMasiva.pendientes}`}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
