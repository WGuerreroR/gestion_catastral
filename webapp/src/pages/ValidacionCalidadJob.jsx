import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box, Typography, Paper, Stack, Chip, Button, LinearProgress, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination, Alert, IconButton, Tooltip, CircularProgress,
  Accordion, AccordionSummary, AccordionDetails,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Snackbar,
} from '@mui/material'
import ArrowBackIcon  from '@mui/icons-material/ArrowBack'
import DownloadIcon   from '@mui/icons-material/Download'
import CancelIcon     from '@mui/icons-material/Cancel'
import RefreshIcon    from '@mui/icons-material/Refresh'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import BlockIcon      from '@mui/icons-material/Block'
import RestoreIcon    from '@mui/icons-material/Restore'
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd'
import BookmarkIcon   from '@mui/icons-material/Bookmark'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import api from '../api/validacionCalidad'
import { useAuth } from '../hooks/useAuth'

const ESTADO_CHIP = {
  pending:   { label: 'Pendiente', color: 'default' },
  running:   { label: 'En curso',  color: 'info' },
  done:      { label: 'Terminado', color: 'success' },
  error:     { label: 'Error',     color: 'error' },
  cancelled: { label: 'Cancelado', color: 'warning' },
}

const ROLES_EXCLUYEN = ['administrador', 'supervisor', 'coordinador']
const ROLES_MARCAS   = ['administrador', 'supervisor']

function resumenMarcas({ creadas, duplicadas, sin_tipo, errores }) {
  const partes = []
  if (creadas > 0)    partes.push(`${creadas} creada${creadas === 1 ? '' : 's'}`)
  if (duplicadas > 0) partes.push(`${duplicadas} duplicada${duplicadas === 1 ? '' : 's'} (ya existía)`)
  if (sin_tipo > 0)   partes.push(`${sin_tipo} sin tipo de marca`)
  if (errores > 0)    partes.push(`${errores} con error`)
  return partes.length ? partes.join(', ') : 'Sin cambios'
}

function severidadResumen({ creadas, duplicadas, sin_tipo, errores }) {
  if (errores > 0) return 'error'
  if (creadas === 0 && (duplicadas > 0 || sin_tipo > 0)) return 'info'
  if (creadas > 0 && (duplicadas > 0 || sin_tipo > 0)) return 'info'
  if (creadas > 0) return 'success'
  return 'info'
}

export default function ValidacionCalidadJob() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const puedeExcluir = ROLES_EXCLUYEN.some(r => hasRole(r))
  const puedeCrearMarcas = ROLES_MARCAS.some(r => hasRole(r))

  const [job, setJob]     = useState(null)
  const [error, setError] = useState('')

  const [agrupados, setAgrupados]       = useState([])
  const [globales,  setGlobales]        = useState([])
  const [totalPredios, setTotalPredios] = useState(0)
  const [pagina, setPagina]             = useState(0)
  const [filas, setFilas]               = useState(25)
  const [cargandoErr, setCargandoErr]   = useState(false)

  const [acciones, setAcciones] = useState({}) // { numero_predial: 'pending' }
  const [dialogExcluirTodos, setDialogExcluirTodos] = useState(null) // numero_predial | null
  const [motivo, setMotivo] = useState('')
  const [snack, setSnack] = useState(null) // { severity, message } | null
  const [dialogMasivo, setDialogMasivo] = useState(null) // 'crear-marcas' | 'excluir-todo' | null
  const [motivoMasivo, setMotivoMasivo] = useState('')
  const [bulkPending, setBulkPending] = useState(false)

  const pollingRef = useRef(null)
  const enCurso = job && (job.estado === 'pending' || job.estado === 'running')

  const cargarJob = async () => {
    try {
      const data = await api.obtenerJob(id)
      setJob(data)
      return data
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al cargar el job')
      return null
    }
  }

  const cargarErrores = async (p = pagina, f = filas) => {
    setCargandoErr(true)
    try {
      const data = await api.listarErroresAgrupados(id, { limit: f, offset: p * f })
      setAgrupados(data.items || [])
      setGlobales(data.errores_globales || [])
      setTotalPredios(data.total_predios || 0)
    } catch {
      // ignore
    } finally {
      setCargandoErr(false)
    }
  }

  useEffect(() => {
    cargarJob().then(j => {
      if (j && (j.estado === 'done' || j.estado === 'error' || j.estado === 'cancelled')) {
        cargarErrores(0, filas)
      }
    })
  }, [id])

  useEffect(() => {
    if (!enCurso) {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
      return
    }
    pollingRef.current = setInterval(async () => {
      const j = await cargarJob()
      if (j && j.estado !== 'pending' && j.estado !== 'running') {
        clearInterval(pollingRef.current); pollingRef.current = null
        cargarErrores(0, filas)
      }
    }, 2000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [enCurso, id])

  const handleCancelar = async () => {
    setError('')
    try {
      const res = await api.cancelarJob(id)
      // El endpoint es autoritativo: ya devuelve el job en estado terminal.
      // Aplicamos directo sin esperar al próximo poll. El polling se detiene
      // solo porque enCurso pasa a false.
      if (res?.job) setJob(res.job)
      else await cargarJob()
      setSnack({
        severity: res?.forzado ? 'warning' : 'success',
        message: res?.mensaje || 'Job cancelado',
      })
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo cancelar')
    }
  }

  // Aplica las métricas devueltas por el backend tras una exclusión/restauración
  // y refresca la página actual de errores agrupados. Mantiene el job
  // sincronizado in-place sin un GET extra.
  const aplicarMetricas = async (metricas) => {
    if (metricas) {
      setJob(prev => prev ? {
        ...prev,
        predios_total:   metricas.predios_total,
        predios_validos: metricas.predios_validos,
        errores_total:   metricas.errores_total,
      } : prev)
    }
    await cargarErrores(pagina, filas)
  }

  const marcarAccion = (np, estado) => {
    setAcciones(prev => {
      const next = { ...prev }
      if (estado) next[np] = estado
      else delete next[np]
      return next
    })
  }

  const excluirError = async (numero_predial, regla) => {
    marcarAccion(numero_predial, 'pending')
    try {
      const res = await api.crearExclusion(id, { numero_predial, regla })
      await aplicarMetricas(res.metricas)
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo excluir el error')
    } finally {
      marcarAccion(numero_predial, null)
    }
  }

  const restaurarError = async (numero_predial, regla) => {
    marcarAccion(numero_predial, 'pending')
    try {
      const res = await api.borrarExclusion(id, { numero_predial, regla })
      await aplicarMetricas(res.metricas)
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo restaurar el error')
    } finally {
      marcarAccion(numero_predial, null)
    }
  }

  const confirmarExcluirTodos = async () => {
    const np = dialogExcluirTodos
    setDialogExcluirTodos(null)
    marcarAccion(np, 'pending')
    try {
      const res = await api.crearExclusion(id, {
        numero_predial: np, regla: null, motivo: motivo || null,
      })
      await aplicarMetricas(res.metricas)
      setMotivo('')
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo excluir el predio')
    } finally {
      marcarAccion(np, null)
    }
  }

  const restaurarTodosDelPredio = async (numero_predial) => {
    marcarAccion(numero_predial, 'pending')
    try {
      const res = await api.borrarExclusion(id, { numero_predial, regla: null })
      await aplicarMetricas(res.metricas)
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo restaurar el predio')
    } finally {
      marcarAccion(numero_predial, null)
    }
  }

  const crearMarcaError = async (numero_predial, regla) => {
    marcarAccion(numero_predial, 'pending')
    try {
      const res = await api.crearMarcasDesdeErrores(id, { numero_predial, regla })
      setSnack({ severity: severidadResumen(res), message: resumenMarcas(res) })
      await cargarErrores(pagina, filas)
    } catch (e) {
      setSnack({ severity: 'error', message: e.response?.data?.detail || 'No se pudo crear la marca' })
    } finally {
      marcarAccion(numero_predial, null)
    }
  }

  const crearMarcasPredio = async (numero_predial) => {
    marcarAccion(numero_predial, 'pending')
    try {
      const res = await api.crearMarcasDesdeErrores(id, { numero_predial })
      setSnack({ severity: severidadResumen(res), message: resumenMarcas(res) })
      await cargarErrores(pagina, filas)
    } catch (e) {
      setSnack({ severity: 'error', message: e.response?.data?.detail || 'No se pudieron crear marcas' })
    } finally {
      marcarAccion(numero_predial, null)
    }
  }

  const ejecutarCrearMarcasMasivo = async () => {
    setDialogMasivo(null)
    setBulkPending(true)
    try {
      const res = await api.crearMarcasMasivo(id)
      setSnack({
        severity: severidadResumen(res),
        message:
          `Procesados ${res.predios_procesados} predios — ` +
          resumenMarcas(res),
      })
      await cargarErrores(pagina, filas)
    } catch (e) {
      setSnack({ severity: 'error', message: e.response?.data?.detail || 'No se pudieron crear marcas' })
    } finally {
      setBulkPending(false)
    }
  }

  const ejecutarExcluirMasivo = async () => {
    const motivoFinal = motivoMasivo
    setDialogMasivo(null)
    setMotivoMasivo('')
    setBulkPending(true)
    try {
      const res = await api.excluirTodosLosErrores(id, { motivo: motivoFinal || null })
      await aplicarMetricas(res.metricas)
      setSnack({
        severity: 'success',
        message: `Excluidos errores de ${res.predios_excluidos} predios. Métricas actualizadas (recuerda Migrar a validado para reflejarlo en el esquema).`,
      })
    } catch (e) {
      setSnack({ severity: 'error', message: e.response?.data?.detail || 'No se pudieron excluir' })
    } finally {
      setBulkPending(false)
    }
  }

  const ejecutarMigrarAValidado = async () => {
    setDialogMasivo(null)
    setBulkPending(true)
    try {
      const metricas = await api.migrarAValidado(id)
      await aplicarMetricas(metricas)
      // Refresh del job para traer migrado_en y ocultar el botón.
      await cargarJob()
      setSnack({
        severity: 'success',
        message: `Migración completa. ${metricas.predios_validos} predios elegibles ahora en validado.lc_predio_p. Para volver a migrar, crea un nuevo job.`,
      })
    } catch (e) {
      setSnack({ severity: 'error', message: e.response?.data?.detail || 'No se pudo migrar a validado' })
    } finally {
      setBulkPending(false)
    }
  }

  if (!job && !error) {
    return <Box sx={{ p: 3 }}><CircularProgress /></Box>
  }

  if (error && !job) {
    return <Box sx={{ p: 3 }}><Alert severity="error">{error}</Alert></Box>
  }

  const c = ESTADO_CHIP[job.estado] || { label: job.estado, color: 'default' }
  const jobCerrado = ['done', 'error', 'cancelled'].includes(job.estado)

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        <IconButton onClick={() => navigate('/validacion-calidad')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={600}>
          Job #{job.id}
        </Typography>
        <Chip label={c.label} color={c.color} />
        {enCurso && (
          <Button
            color="warning" variant="outlined" size="small"
            startIcon={<CancelIcon />} onClick={handleCancelar}
            disabled={job.cancelar_solicitado}
          >
            {job.cancelar_solicitado ? 'Cancelando...' : 'Cancelar'}
          </Button>
        )}
        {jobCerrado && (
          <Button
            variant="contained" color="primary" size="small"
            startIcon={<DownloadIcon />}
            onClick={() => api.descargarReporte(job.id)}
          >
            Descargar reporte (.log)
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">Alcance</Typography>
            <Typography variant="body2" fontWeight={500}>
              {job.alcance_tipo === 'todo'
                ? 'Todo el dataset'
                : `${job.alcance_tipo === 'predios' ? 'Predios' : 'Manzanas'} (${(job.alcance_valores||[]).length})`}
            </Typography>
            {job.alcance_tipo !== 'todo' && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, wordBreak: 'break-all' }}>
                {(job.alcance_valores || []).slice(0, 5).join(', ')}
                {(job.alcance_valores || []).length > 5 && `, +${job.alcance_valores.length - 5} más`}
              </Typography>
            )}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">Reglas omitidas</Typography>
            <Typography variant="body2">{(job.reglas_omitidas || []).length}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Iniciado: {new Date(job.iniciado_en).toLocaleString()}
              {job.finalizado_en && ` · Fin: ${new Date(job.finalizado_en).toLocaleString()}`}
            </Typography>
            <Typography variant="caption" color="text.secondary">Por: {job.creado_por || '—'}</Typography>
          </Box>
        </Stack>
        <Box sx={{ mt: 2 }}>
          <LinearProgress variant="determinate" value={job.progreso} sx={{ height: 8, borderRadius: 4 }} />
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">{job.progreso}%</Typography>
            {enCurso && job.regla_actual && (
              <Typography variant="caption" color="info.main" sx={{ fontWeight: 500 }}>
                Ejecutando: {job.regla_actual}
              </Typography>
            )}
          </Stack>
        </Box>
        {job.error_message && (
          <Alert
            severity={
              job.estado === 'done' ? 'info'
                : job.estado === 'cancelled' ? 'warning'
                : 'error'
            }
            sx={{ mt: 2, whiteSpace: 'pre-wrap' }}
          >
            {job.error_message}
          </Alert>
        )}
      </Paper>

      {(job.predios_total != null) && (
        <Stack direction="row" spacing={2} mb={3}>
          <Paper sx={{ p: 2, flex: 1, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Predios analizados</Typography>
            <Typography variant="h5">{job.predios_total}</Typography>
          </Paper>
          <Paper sx={{ p: 2, flex: 1, textAlign: 'center', bgcolor: 'success.light' }}>
            <Typography variant="caption">Predios válidos</Typography>
            <Typography variant="h5">{job.predios_validos ?? '—'}</Typography>
          </Paper>
          <Paper sx={{ p: 2, flex: 1, textAlign: 'center', bgcolor: 'error.light' }}>
            <Typography variant="caption">Errores activos</Typography>
            <Typography variant="h5">{job.errores_total ?? '—'}</Typography>
          </Paper>
        </Stack>
      )}

      <Divider sx={{ mb: 2 }} />

      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
        <Typography variant="h6">
          Errores por predio {totalPredios > 0 && `(${totalPredios})`}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          {!enCurso && job?.migrado_en && (job?.predios_validos ?? 0) > 0 && (
            <Tooltip title={`Para volver a migrar este alcance, crea un nuevo job. Última migración: ${new Date(job.migrado_en).toLocaleString()}`}>
              <Chip
                size="small" color="success" icon={<CloudUploadIcon />}
                label={`Migrado: ${job.predios_validos} predio${job.predios_validos === 1 ? '' : 's'} — ${new Date(job.migrado_en).toLocaleDateString()}`}
                variant="outlined"
              />
            </Tooltip>
          )}
          {!enCurso && job?.migrado_en && (job?.predios_validos ?? 0) === 0 && (
            <Tooltip title={`No había predios elegibles cuando corrió la migración. Revisa el quality gate o crea un job nuevo. Fecha: ${new Date(job.migrado_en).toLocaleString()}`}>
              <Chip
                size="small" color="warning" icon={<CloudUploadIcon />}
                label="Sin elegibles para migrar"
                variant="outlined"
              />
            </Tooltip>
          )}
          {!enCurso && !job?.migrado_en && (job?.predios_validos ?? 0) > 0 && puedeExcluir && (
            <Tooltip title="Aplica el estado actual de elegibles al esquema validado.lc_predio_p">
              <span>
                <Button
                  size="small" variant="contained" color="primary"
                  startIcon={<CloudUploadIcon />}
                  onClick={() => setDialogMasivo('migrar-validado')}
                  disabled={bulkPending}
                >
                  Migrar a validado ({job.predios_validos})
                </Button>
              </span>
            </Tooltip>
          )}
          {!enCurso && agrupados.length > 0 && puedeCrearMarcas && (
            <Button
              size="small" variant="outlined" startIcon={<BookmarkAddIcon />}
              onClick={() => setDialogMasivo('crear-marcas')}
              disabled={bulkPending}
            >
              Crear marcas para todos
            </Button>
          )}
          {!enCurso && agrupados.length > 0 && puedeExcluir && (
            <Button
              size="small" variant="outlined" color="warning" startIcon={<BlockIcon />}
              onClick={() => setDialogMasivo('excluir-todo')}
              disabled={bulkPending}
            >
              Excluir todos los errores
            </Button>
          )}
          {bulkPending && <CircularProgress size={18} />}
          <Tooltip title="Refrescar">
            <span>
              <IconButton onClick={() => cargarErrores(pagina, filas)} disabled={cargandoErr || enCurso}>
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {enCurso ? (
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          <CircularProgress size={20} sx={{ mr: 1 }} />
          Esperando a que termine la validación para mostrar los errores agrupados...
        </Paper>
      ) : cargandoErr && agrupados.length === 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={20} /></Paper>
      ) : agrupados.length === 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center' }}>Sin errores en este job</Paper>
      ) : (
        <>
          {agrupados.map(p => (
            <PredioAccordion
              key={p.numero_predial}
              predio={p}
              puedeExcluir={puedeExcluir}
              puedeCrearMarcas={puedeCrearMarcas}
              ocupado={acciones[p.numero_predial] === 'pending'}
              onExcluirError={(regla) => excluirError(p.numero_predial, regla)}
              onRestaurarError={(regla) => restaurarError(p.numero_predial, regla)}
              onAbrirDialogExcluirTodos={() => setDialogExcluirTodos(p.numero_predial)}
              onRestaurarTodos={() => restaurarTodosDelPredio(p.numero_predial)}
              onCrearMarcaError={(regla) => crearMarcaError(p.numero_predial, regla)}
              onCrearMarcasPredio={() => crearMarcasPredio(p.numero_predial)}
            />
          ))}

          <TablePagination
            component="div"
            count={totalPredios}
            page={pagina}
            rowsPerPage={filas}
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage="Predios por página:"
            onPageChange={(_, p) => { setPagina(p); cargarErrores(p, filas) }}
            onRowsPerPageChange={(e) => {
              const f = parseInt(e.target.value, 10); setFilas(f); setPagina(0); cargarErrores(0, f)
            }}
          />
        </>
      )}

      {globales.length > 0 && (() => {
        // Separamos: las que vienen del catch del bucle de reglas (prefijo
        // `[ERROR EJECUCIÓN REGLA]`) son reglas mal configuradas. El resto
        // son errores genéricos sin predio asociado.
        const reglasMalConfiguradas = globales.filter(
          e => (e.descripcion || '').includes('[ERROR EJECUCIÓN REGLA]')
        )
        const otrosGlobales = globales.filter(
          e => !(e.descripcion || '').includes('[ERROR EJECUCIÓN REGLA]')
        )
        const limpiarPrefijo = d =>
          (d || '').replace(/^\[ERROR EJECUCIÓN REGLA\]\s*/, '')

        return (
          <>
            {reglasMalConfiguradas.length > 0 && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="h6" gutterBottom>
                  Reglas con errores de ejecución ({reglasMalConfiguradas.length})
                </Typography>
                <Alert severity="warning" sx={{ mb: 1 }}>
                  Estas reglas <strong>no se pudieron ejecutar</strong> en este job (SQL
                  inválido, columna inexistente, timeout, etc.). Sus errores no entran al
                  reporte por predio y <strong>no se pueden convertir en marcas</strong> —
                  hay que revisar y corregir el SQL de la regla en la sección
                  &quot;Administrar reglas&quot;.
                </Alert>
                <TableContainer component={Paper} sx={{ mb: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Regla</TableCell>
                        <TableCell>Mensaje del motor SQL</TableCell>
                        <TableCell>Fecha</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reglasMalConfiguradas.map(e => (
                        <TableRow key={e.id}>
                          <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                            <Chip size="small" color="warning" variant="outlined" label={e.regla || '—'} />
                          </TableCell>
                          <TableCell sx={{ maxWidth: 800, whiteSpace: 'normal', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                            {limpiarPrefijo(e.descripcion)}
                          </TableCell>
                          <TableCell>{e.fecha_registro ? new Date(e.fecha_registro).toLocaleString() : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}

            {otrosGlobales.length > 0 && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="h6" gutterBottom>
                  Otros errores sin predio asociado ({otrosGlobales.length})
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Errores reportados por reglas pero sin un número predial concreto.
                  No son excluibles ni convertibles en marcas.
                </Typography>
                <TableContainer component={Paper}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Regla</TableCell>
                        <TableCell>Descripción</TableCell>
                        <TableCell>Fecha</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {otrosGlobales.map(e => (
                        <TableRow key={e.id}>
                          <TableCell>{e.regla || '—'}</TableCell>
                          <TableCell sx={{ maxWidth: 800, whiteSpace: 'normal' }}>{e.descripcion}</TableCell>
                          <TableCell>{e.fecha_registro ? new Date(e.fecha_registro).toLocaleString() : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </>
        )
      })()}

      <Snackbar
        open={!!snack}
        autoHideDuration={6000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {snack && (
          <Alert
            severity={snack.severity}
            onClose={() => setSnack(null)}
            sx={{ width: '100%' }}
          >
            {snack.message}
          </Alert>
        )}
      </Snackbar>

      <Dialog
        open={dialogMasivo === 'migrar-validado'}
        onClose={() => setDialogMasivo(null)}
        maxWidth="sm" fullWidth
      >
        <DialogTitle>Migrar predios elegibles al esquema validado</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 1 }}>
            Se aplicará el estado actual al esquema <code>validado.*</code>:
            los predios del alcance se eliminan y se vuelven a insertar
            <strong> {job?.predios_validos ?? 0} predios elegibles</strong> con
            sus tablas relacionadas.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Esta acción es <strong>idempotente</strong>: puedes correrla cuantas
            veces quieras. Es la forma de reflejar en validado.* los cambios
            que hayas hecho con exclusiones desde la última migración.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogMasivo(null)}>Cancelar</Button>
          <Button variant="contained" onClick={ejecutarMigrarAValidado}>
            Migrar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={dialogMasivo === 'crear-marcas'}
        onClose={() => setDialogMasivo(null)}
        maxWidth="sm" fullWidth
      >
        <DialogTitle>Crear marcas para todos los predios</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 1 }}>
            Se procesarán <strong>{totalPredios} predios</strong> del reporte.
            Para cada error activo cuya regla tenga tipo de marca configurado
            se intentará crear una marca. Los duplicados (ya existentes) y los
            que no tengan tipo se omiten silenciosamente.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Esta acción puede tomar unos segundos. Tras terminar verás un
            resumen con cuántas marcas se crearon, duplicaron y omitieron.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogMasivo(null)}>Cancelar</Button>
          <Button variant="contained" onClick={ejecutarCrearMarcasMasivo}>
            Crear marcas
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={dialogMasivo === 'excluir-todo'}
        onClose={() => { setDialogMasivo(null); setMotivoMasivo('') }}
        maxWidth="sm" fullWidth
      >
        <DialogTitle>Excluir todos los errores activos del job</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Se excluirán los errores de <strong>todos los {totalPredios} predios</strong>
            con errores activos en este job. Los predios que queden sin errores
            activos se promoverán a <code>validado.lc_predio_p</code>.
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Esta acción es <strong>reversible</strong> por predio (puedes restaurar
            cada uno individualmente desde el reporte), pero conviene anotar el
            motivo para auditoría.
          </Typography>
          <TextField
            autoFocus fullWidth multiline minRows={2}
            label="Motivo (opcional)"
            value={motivoMasivo}
            onChange={e => setMotivoMasivo(e.target.value)}
            placeholder="Por qué se aceptan los errores actuales del job"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogMasivo(null); setMotivoMasivo('') }}>
            Cancelar
          </Button>
          <Button variant="contained" color="warning" onClick={ejecutarExcluirMasivo}>
            Excluir todo
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!dialogExcluirTodos} onClose={() => { setDialogExcluirTodos(null); setMotivo('') }}>
        <DialogTitle>Excluir todos los errores del predio</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Predio: <strong>{dialogExcluirTodos}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Si todos sus errores quedan excluidos, el predio se promoverá a
            <code> validado.lc_predio_p</code> y sus tablas relacionadas.
          </Typography>
          <TextField
            autoFocus fullWidth multiline minRows={2}
            label="Motivo (opcional)"
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Por qué se aceptan los errores de este predio"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogExcluirTodos(null); setMotivo('') }}>Cancelar</Button>
          <Button variant="contained" color="warning" onClick={confirmarExcluirTodos}>
            Excluir todos
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}


function PredioAccordion({
  predio, puedeExcluir, puedeCrearMarcas, ocupado,
  onExcluirError, onRestaurarError,
  onAbrirDialogExcluirTodos, onRestaurarTodos,
  onCrearMarcaError, onCrearMarcasPredio,
}) {
  const { numero_predial, id_operacion, errores_total, errores_activos, predio_excluido_total, errores } = predio
  const todosExcluidos = errores_activos === 0
  const algunoExcluido = errores_total > errores_activos

  // Hay al menos un error activo, no excluido, sin marca y con tipo_marca configurado
  const hayConvertibles = errores.some(
    e => !e.excluido && !e.marca_id && e.tiene_tipo_marca
  )

  return (
    <Accordion sx={{ mb: 0.5 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%', flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
              {numero_predial}
            </Typography>
            {id_operacion && (
              <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                id_operacion: {id_operacion}
              </Typography>
            )}
          </Box>
          <Chip
            size="small"
            label={`${errores_activos} ${errores_activos === 1 ? 'activo' : 'activos'}`}
            color={errores_activos > 0 ? 'error' : 'success'}
          />
          {algunoExcluido && (
            <Chip size="small" label={`${errores_total - errores_activos} excluido${errores_total - errores_activos === 1 ? '' : 's'}`} variant="outlined" />
          )}
          {predio_excluido_total && (
            <Chip size="small" label="todo el predio excluido" color="warning" variant="outlined" />
          )}
          <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
            {puedeCrearMarcas && hayConvertibles && (
              <Tooltip title="Crear marca para cada error activo cuya regla tenga tipo_marca configurado">
                <span>
                  <Button
                    size="small" variant="outlined" startIcon={<BookmarkAddIcon />}
                    onClick={onCrearMarcasPredio} disabled={ocupado}
                  >
                    Crear marcas
                  </Button>
                </span>
              </Tooltip>
            )}
            {puedeExcluir && (
              predio_excluido_total ? (
                <Button
                  size="small" variant="outlined" startIcon={<RestoreIcon />}
                  onClick={onRestaurarTodos} disabled={ocupado}
                >
                  Restaurar predio
                </Button>
              ) : (
                <Button
                  size="small" variant="outlined" color="warning" startIcon={<BlockIcon />}
                  onClick={onAbrirDialogExcluirTodos} disabled={ocupado || todosExcluidos}
                >
                  Excluir todos
                </Button>
              )
            )}
          </Stack>
          {ocupado && <CircularProgress size={16} />}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Table size="small">
          <TableBody>
            {errores.map(e => {
              const tachado = e.excluido
                ? { textDecoration: 'line-through', opacity: 0.55 }
                : {}
              const tooltipMarca = !e.tiene_tipo_marca
                ? 'Esta regla no tiene tipo de marca asociado. Configúralo en la sección de reglas.'
                : e.excluido
                  ? 'El error está excluido. Restáuralo para poder crear marca.'
                  : ''
              return (
                <TableRow key={e.id} hover>
                  <TableCell sx={{ width: 110, fontFamily: 'monospace', ...tachado }}>
                    {e.regla || '—'}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'normal', ...tachado }}>
                    {e.descripcion}
                  </TableCell>
                  <TableCell sx={{ width: 150 }}>
                    {e.marca_id ? (
                      <Tooltip title={`Marca #${e.marca_id} ya creada (ver en /marcas)`}>
                        <Chip
                          size="small" icon={<BookmarkIcon />}
                          label={`marca #${e.marca_id}`}
                          variant="outlined" color="primary"
                        />
                      </Tooltip>
                    ) : puedeCrearMarcas ? (
                      <Tooltip title={tooltipMarca}>
                        <span>
                          <Button
                            size="small" variant="text" startIcon={<BookmarkAddIcon />}
                            onClick={() => onCrearMarcaError(e.regla)}
                            disabled={ocupado || !e.tiene_tipo_marca || e.excluido}
                          >
                            Crear marca
                          </Button>
                        </span>
                      </Tooltip>
                    ) : null}
                  </TableCell>
                  <TableCell sx={{ width: 150 }}>
                    {puedeExcluir && (
                      e.excluido ? (
                        <Button
                          size="small" variant="text" startIcon={<RestoreIcon />}
                          onClick={() => onRestaurarError(e.regla)}
                          disabled={ocupado || predio_excluido_total}
                          title={predio_excluido_total ? 'Primero restaure el predio completo' : ''}
                        >
                          Restaurar
                        </Button>
                      ) : (
                        <Button
                          size="small" variant="text" color="warning" startIcon={<BlockIcon />}
                          onClick={() => onExcluirError(e.regla)}
                          disabled={ocupado}
                        >
                          Excluir
                        </Button>
                      )
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </AccordionDetails>
    </Accordion>
  )
}
