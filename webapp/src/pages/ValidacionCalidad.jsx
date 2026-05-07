import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Paper, Button, Stack, Radio, RadioGroup, FormControl,
  FormControlLabel, FormLabel, TextField, Alert, AlertTitle, Chip, Divider, Checkbox,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress, IconButton, Tooltip, LinearProgress, Switch,
  Dialog, DialogTitle, DialogContent, DialogActions, Collapse
} from '@mui/material'
import PlayArrowIcon  from '@mui/icons-material/PlayArrow'
import RefreshIcon    from '@mui/icons-material/Refresh'
import RuleIcon       from '@mui/icons-material/Rule'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import api from '../api/validacionCalidad'

const ESTADOS_ACTIVOS = new Set(['pending', 'running'])
const POLL_MS = 3000

const ESTADO_CHIP = {
  pending:   { label: 'Pendiente', color: 'default' },
  running:   { label: 'En curso',  color: 'info' },
  done:      { label: 'Terminado', color: 'success' },
  error:     { label: 'Error',     color: 'error' },
  cancelled: { label: 'Cancelado', color: 'warning' },
}

// El usuario puede pegar IDs separados por coma, espacio o salto de línea.
function parseLista(texto) {
  return [...new Set(
    (texto || '')
      .split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
  )]
}

function formatoAlcance(job) {
  if (job.alcance_tipo === 'todo') return 'Todo'
  const n = (job.alcance_valores || []).length
  return `${job.alcance_tipo === 'predios' ? 'Predios' : 'Manzanas'}: ${n}`
}

export default function ValidacionCalidad() {
  const navigate = useNavigate()

  const [reglas, setReglas]               = useState([])
  const [loadingReglas, setLoadingReglas] = useState(true)
  const [seleccionadas, setSeleccionadas] = useState(new Set())
  const [alcanceTipo, setAlcanceTipo]     = useState('todo')
  const [textoAlcance, setTextoAlcance]   = useState('')
  const [aplicarFiltroCalidad, setAplicarFiltroCalidad] = useState(true)
  const [creando, setCreando]             = useState(false)
  const [verificandoCalidad, setVerificandoCalidad] = useState(false)
  const [dialogPreview, setDialogPreview] = useState(null) // PreviewCalidadResponse | null
  const [error, setError]                 = useState('')

  const [jobs, setJobs]               = useState([])
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [mostrarOcultos, setMostrarOcultos] = useState(false)
  const [historicoAbierto, setHistoricoAbierto] = useState(() => {
    const v = localStorage.getItem('vc_historico_abierto')
    return v === '1'   // default: colapsado; solo abierto si lo abriste antes
  })
  const toggleHistorico = () => {
    setHistoricoAbierto(prev => {
      const next = !prev
      localStorage.setItem('vc_historico_abierto', next ? '1' : '0')
      return next
    })
  }
  const pollRef = useRef(null)

  useEffect(() => {
    cargarReglas()
    cargarJobs()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // Recargar cuando cambia el toggle de ocultos
  useEffect(() => {
    cargarJobs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarOcultos])

  // Mantener un poll cada 3s mientras haya algún job activo. Cuando ya no
  // queden activos, detenerlo para no recargar la lista innecesariamente.
  useEffect(() => {
    const hayActivos = jobs.some(j => ESTADOS_ACTIVOS.has(j.estado))
    if (hayActivos && !pollRef.current) {
      pollRef.current = setInterval(() => cargarJobs({ silent: true }), POLL_MS)
    } else if (!hayActivos && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [jobs])

  const cargarReglas = async () => {
    setLoadingReglas(true)
    try {
      const data = await api.listarReglas()
      setReglas(data)
      setSeleccionadas(new Set(data.filter(r => r.activa).map(r => r.id)))
    } catch (e) {
      setError('Error al cargar reglas')
    } finally {
      setLoadingReglas(false)
    }
  }

  const cargarJobs = async ({ silent = false } = {}) => {
    if (!silent) setLoadingJobs(true)
    try {
      setJobs(await api.listarJobs({ limit: 30, incluir_ocultos: mostrarOcultos }))
    } catch {
      // ignore
    } finally {
      if (!silent) setLoadingJobs(false)
    }
  }

  const toggleVisibilidad = async (job) => {
    try {
      await api.cambiarVisibilidadJob(job.id, !job.oculto)
      cargarJobs()
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo cambiar la visibilidad')
    }
  }

  const jobActivo = useMemo(
    () => jobs.find(j => ESTADOS_ACTIVOS.has(j.estado)) || null,
    [jobs]
  )

  const valoresAlcance = useMemo(() => parseLista(textoAlcance), [textoAlcance])
  const reglasOmitidas = useMemo(
    () => reglas.filter(r => !seleccionadas.has(r.id)).map(r => r.id),
    [reglas, seleccionadas]
  )
  const numEjecutar = reglas.length - reglasOmitidas.length

  const toggleRegla = (id) => {
    setSeleccionadas(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const seleccionarTodas    = () => setSeleccionadas(new Set(reglas.map(r => r.id)))
  const deseleccionarTodas  = () => setSeleccionadas(new Set())

  const crearJobReal = async () => {
    setCreando(true)
    try {
      const { job_id } = await api.crearJob({
        alcance_tipo:           alcanceTipo,
        alcance_valores:        alcanceTipo === 'todo' ? [] : valoresAlcance,
        reglas_omitidas:        reglasOmitidas,
        aplicar_filtro_calidad: aplicarFiltroCalidad,
      })
      navigate(`/validacion-calidad/jobs/${job_id}`)
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al crear el job')
    } finally {
      setCreando(false)
    }
  }

  const handleEjecutar = async () => {
    setError('')
    if (alcanceTipo !== 'todo' && valoresAlcance.length === 0) {
      setError(`Indica al menos un ${alcanceTipo === 'predios' ? 'número predial' : 'código de manzana'}`)
      return
    }

    // Preview previo: detecta identificadores que no existen en BD y, si el
    // gate de calidad está activo, también predios sin calidad aprobada.
    // Lo corremos siempre que haya valores en el alcance (no solo cuando el
    // gate está activo) — si la lista pegada no matchea nada en BD, no tiene
    // sentido seguir. Si el preview falla por red/timeout, no bloqueamos.
    const corrioPreview = alcanceTipo !== 'todo' || aplicarFiltroCalidad
    if (corrioPreview) {
      setVerificandoCalidad(true)
      try {
        const preview = await api.previewCalidad({
          alcance_tipo:    alcanceTipo,
          alcance_valores: alcanceTipo === 'todo' ? [] : valoresAlcance,
        })

        // Bloqueo duro: si el usuario pasó valores pero NINGUNO existe en
        // BD, no hay nada que validar.
        if (alcanceTipo !== 'todo' && preview.total_alcance === 0) {
          setVerificandoCalidad(false)
          setError(
            alcanceTipo === 'predios'
              ? `Ninguno de los ${valoresAlcance.length} identificadores existe en lc_predio_p. Verifica los números prediales o id_operacion.`
              : `Ninguna de las ${valoresAlcance.length} manzanas tiene predios en lc_predio_p.`
          )
          return
        }

        // Si hay algo que advertir (faltantes y/o sin calidad), abrir dialog
        const hayFaltantes = (preview.valores_no_encontrados || []).length > 0
        const haySinCalidad = aplicarFiltroCalidad && preview.sin_calidad > 0
        if (hayFaltantes || haySinCalidad) {
          setDialogPreview(preview)
          setVerificandoCalidad(false)
          return // espera confirmación del usuario
        }
      } catch {
        // preview opcional; si falla seguimos
      }
      setVerificandoCalidad(false)
    }

    await crearJobReal()
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={600}>Validación de calidad</Typography>
        <Button
          startIcon={<RuleIcon />}
          variant="outlined"
          onClick={() => navigate('/validacion-calidad/reglas')}
        >
          Administrar reglas
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" mb={3}>
        Aplica las reglas de calidad sobre los predios del alcance que
        selecciones. El proceso corre en segundo plano y al terminar genera
        un reporte por predio con los errores detectados.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {jobActivo && (
        <Alert
          severity="info"
          icon={<CircularProgress size={20} />}
          sx={{ mb: 2 }}
          action={
            <Button
              size="small"
              variant="outlined"
              startIcon={<VisibilityIcon />}
              onClick={() => navigate(`/validacion-calidad/jobs/${jobActivo.id}`)}
            >
              Ver detalle
            </Button>
          }
        >
          <AlertTitle>
            Hay una validación en curso (job #{jobActivo.id})
          </AlertTitle>
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Alcance: {formatoAlcance(jobActivo)} · Estado: {jobActivo.estado}
              {jobActivo.creado_por ? ` · Iniciado por ${jobActivo.creado_por}` : ''}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={jobActivo.progreso || 0}
              sx={{ height: 6, borderRadius: 3 }}
            />
            <Typography variant="caption" color="text.secondary">
              {jobActivo.progreso || 0}% completado
            </Typography>
          </Box>
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} mb={3}>
        {/* Alcance */}
        <Paper sx={{ p: 2, flex: 1 }}>
          <FormControl>
            <FormLabel sx={{ mb: 1, fontWeight: 600 }}>Alcance</FormLabel>
            <RadioGroup
              row value={alcanceTipo}
              onChange={e => { setAlcanceTipo(e.target.value); setTextoAlcance('') }}
            >
              <FormControlLabel value="todo"     control={<Radio />} label="Todo el dataset" />
              <FormControlLabel value="predios"  control={<Radio />} label="Predios" />
              <FormControlLabel value="manzanas" control={<Radio />} label="Manzanas" />
            </RadioGroup>
          </FormControl>

          {alcanceTipo !== 'todo' && (
            <Box mt={2}>
              <TextField
                fullWidth multiline minRows={3} size="small"
                label={alcanceTipo === 'predios'
                  ? 'Números prediales o id_operacion (uno por línea o separados por coma)'
                  : 'Códigos de manzana (uno por línea o separados por coma)'}
                value={textoAlcance}
                onChange={e => setTextoAlcance(e.target.value)}
                placeholder={alcanceTipo === 'predios'
                  ? '15176010100000750030000000000\nch-16318'
                  : '15176010100000017\n15176010100000018'}
                helperText={alcanceTipo === 'predios'
                  ? 'Acepta cualquiera de los dos identificadores; pueden ir mezclados.'
                  : ''}
              />
              <Typography variant="caption" color="text.secondary">
                {valoresAlcance.length} {alcanceTipo === 'predios' ? 'predio(s)' : 'manzana(s)'}
              </Typography>
            </Box>
          )}
        </Paper>

        {/* Reglas */}
        <Paper sx={{ p: 2, flex: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <FormLabel sx={{ fontWeight: 600 }}>
              Reglas a aplicar ({numEjecutar} de {reglas.length})
            </FormLabel>
            <Stack direction="row" spacing={0.5}>
              <Button size="small" onClick={seleccionarTodas}>Todas</Button>
              <Button size="small" onClick={deseleccionarTodas}>Ninguna</Button>
            </Stack>
          </Stack>

          {numEjecutar === 0 && reglas.length > 0 && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              No se aplicará ninguna regla; todos los predios del alcance
              se considerarán válidos.
            </Alert>
          )}

          {loadingReglas ? <CircularProgress size={24} /> : (
            <Box sx={{ maxHeight: 280, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}>
              {reglas.map(r => (
                <Stack key={r.id} direction="row" alignItems="center" spacing={1}>
                  <Checkbox
                    size="small"
                    checked={seleccionadas.has(r.id)}
                    onChange={() => toggleRegla(r.id)}
                    disabled={!r.activa}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {r.codigo} — {r.nombre}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      entidad: {r.entidad}{!r.activa && ' · inactiva'}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Box>
          )}
        </Paper>
      </Stack>

      <Paper sx={{ p: 2, mb: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={aplicarFiltroCalidad}
              onChange={e => setAplicarFiltroCalidad(e.target.checked)}
            />
          }
          label="Solo promover predios con calidad de equipo aprobada (calidad_*=1)"
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 5.5 }}>
          {aplicarFiltroCalidad
            ? 'Activado: solo se consideran válidos los predios que ya tienen aprobada la validación en los 6 aspectos del equipo (campo, SIG, física, jurídica, económica, identificación).'
            : 'Desactivado: se consideran válidos incluso predios pendientes de revisión por equipo. Útil para auditorías sobre datos sin revisar.'}
        </Typography>
      </Paper>

      <Box sx={{ mb: 4 }}>
        <Tooltip
          title={jobActivo
            ? 'Ya hay una validación en curso. Espera a que termine o cancélala antes de iniciar otra.'
            : ''}
        >
          <span>
            <Button
              variant="contained" size="large" startIcon={<PlayArrowIcon />}
              onClick={handleEjecutar}
              disabled={
                creando ||
                verificandoCalidad ||
                !!jobActivo ||
                (alcanceTipo !== 'todo' && valoresAlcance.length === 0)
              }
            >
              {verificandoCalidad
                ? 'Verificando calidad...'
                : creando
                  ? 'Iniciando...'
                  : 'Ejecutar validación'}
            </Button>
          </span>
        </Tooltip>
      </Box>

      <Divider sx={{ my: 3 }} />

      {/* Histórico */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Stack
          direction="row" alignItems="center" spacing={0.5}
          onClick={toggleHistorico}
          sx={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <ExpandMoreIcon
            sx={{
              transition: 'transform 0.2s',
              transform: historicoAbierto ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
          <Typography variant="h6">
            Ejecuciones anteriores{jobs.length > 0 && ` (${jobs.length})`}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={mostrarOcultos}
                onChange={e => setMostrarOcultos(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Mostrar ocultas</Typography>}
          />
          <Tooltip title="Refrescar">
            <IconButton onClick={cargarJobs} disabled={loadingJobs}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Collapse in={historicoAbierto} unmountOnExit>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Alcance</TableCell>
              <TableCell>Progreso</TableCell>
              <TableCell align="right">Predios</TableCell>
              <TableCell align="right">Válidos</TableCell>
              <TableCell align="right">Errores</TableCell>
              <TableCell>Inicio</TableCell>
              <TableCell>Por</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loadingJobs ? (
              <TableRow><TableCell colSpan={10} align="center"><CircularProgress size={20} /></TableCell></TableRow>
            ) : jobs.length === 0 ? (
              <TableRow><TableCell colSpan={10} align="center">Sin ejecuciones</TableCell></TableRow>
            ) : jobs.map(j => {
              const c = ESTADO_CHIP[j.estado] || { label: j.estado, color: 'default' }
              return (
                <TableRow key={j.id} hover sx={j.oculto ? { opacity: 0.55 } : {}}>
                  <TableCell>{j.id}</TableCell>
                  <TableCell><Chip size="small" label={c.label} color={c.color} /></TableCell>
                  <TableCell>{formatoAlcance(j)}</TableCell>
                  <TableCell sx={{ minWidth: 110 }}>
                    <LinearProgress variant="determinate" value={j.progreso || 0} sx={{ height: 6, borderRadius: 3 }} />
                    <Typography variant="caption" color="text.secondary">{j.progreso}%</Typography>
                  </TableCell>
                  <TableCell align="right">{j.predios_total ?? '—'}</TableCell>
                  <TableCell align="right">{j.predios_validos ?? '—'}</TableCell>
                  <TableCell align="right">{j.errores_total ?? '—'}</TableCell>
                  <TableCell>{j.iniciado_en ? new Date(j.iniciado_en).toLocaleString() : '—'}</TableCell>
                  <TableCell>{j.creado_por || '—'}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Ver detalle">
                      <IconButton size="small" onClick={() => navigate(`/validacion-calidad/jobs/${j.id}`)}>
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={j.oculto ? 'Mostrar' : 'Ocultar'}>
                      <IconButton size="small" onClick={() => toggleVisibilidad(j)}>
                        {j.oculto
                          ? <VisibilityIcon fontSize="small" />
                          : <VisibilityOffIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
      </Collapse>

      <Dialog
        open={!!dialogPreview}
        onClose={() => setDialogPreview(null)}
        maxWidth="sm" fullWidth
      >
        <DialogTitle>Revisión del alcance antes de ejecutar</DialogTitle>
        <DialogContent>
          {/* Sección 1: identificadores no encontrados en BD */}
          {(dialogPreview?.valores_no_encontrados?.length || 0) > 0 && (
            <>
              <Alert severity="error" sx={{ mb: 2 }}>
                <strong>{dialogPreview.valores_no_encontrados.length}</strong> de
                {' '}{dialogPreview.solicitados}{' '}identificadores que pegaste
                <strong> no existen en lc_predio_p</strong>. Esos no se procesarán.
                Verifica si son números prediales/id_operacion correctos.
              </Alert>
              <Box sx={{
                maxHeight: 180, overflow: 'auto',
                border: 1, borderColor: 'divider', borderRadius: 1, p: 1, mb: 2,
              }}>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {dialogPreview.valores_no_encontrados.map(v => (
                    <Chip key={v} size="small" label={v} color="error" variant="outlined"
                      sx={{ fontFamily: 'monospace' }} />
                  ))}
                </Stack>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                Encontrados en BD: <strong>{dialogPreview.total_alcance}</strong>
                {' '}de {dialogPreview.solicitados}.
              </Typography>
            </>
          )}

          {/* Sección 2: predios sin calidad (solo si gate activo) */}
          {(dialogPreview?.sin_calidad || 0) > 0 && (
            <>
              <Alert severity="warning" sx={{ mb: 2 }}>
                <strong>{dialogPreview.sin_calidad}</strong> de {dialogPreview.total_alcance}
                {' '}predios del alcance no tienen aprobada la validación del equipo.
                Las reglas se ejecutarán igual, pero estos predios
                <strong> no entrarán al esquema validado</strong> aunque pasen.
              </Alert>
              <Typography variant="body2" color="text.secondary" mb={1}>
                Aspectos pendientes por predio:
              </Typography>
              <Box sx={{
                maxHeight: 280, overflow: 'auto',
                border: 1, borderColor: 'divider', borderRadius: 1, p: 1,
              }}>
                {dialogPreview.items.map(p => (
                  <Stack
                    key={p.id_operacion}
                    direction="row" spacing={1} alignItems="flex-start"
                    sx={{ py: 0.5, flexWrap: 'wrap' }}
                  >
                    <Box sx={{ minWidth: 220 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {p.numero_predial}
                      </Typography>
                      {p.id_operacion && (
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                          id_operacion: {p.id_operacion}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ pt: 0.25 }}>
                      {p.columnas_pendientes.map(c => (
                        <Chip key={c} size="small" label={c} variant="outlined" color="warning" />
                      ))}
                    </Stack>
                  </Stack>
                ))}
                {dialogPreview.overflow && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    ...y {dialogPreview.sin_calidad - dialogPreview.items.length} predios más
                  </Typography>
                )}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogPreview(null)}>Cancelar</Button>
          <Button
            variant="contained" color="warning"
            onClick={() => { setDialogPreview(null); crearJobReal() }}
          >
            Continuar de todas formas
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
