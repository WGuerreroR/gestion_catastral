import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Box, Typography, Paper, Button, Stack, Chip, Alert, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress, IconButton, Tooltip, Divider,
} from '@mui/material'
import ArrowBackIcon  from '@mui/icons-material/ArrowBack'
import StopIcon       from '@mui/icons-material/Stop'
import DownloadIcon   from '@mui/icons-material/Download'
import RefreshIcon    from '@mui/icons-material/Refresh'
import api from '../api/migracionLadm'

const ESTADOS_ACTIVOS = new Set(['pending', 'running'])
const POLL_MS = 2000

const ESTADO_CHIP = {
  pending:   { label: 'Pendiente', color: 'default' },
  running:   { label: 'En curso',  color: 'info' },
  done:      { label: 'Terminada', color: 'success' },
  error:     { label: 'Error',     color: 'error' },
  cancelled: { label: 'Cancelada', color: 'warning' },
}

export default function MigracionLadmJob() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [job, setJob]           = useState(null)
  const [errores, setErrores]   = useState({ total: 0, items: [] })
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const pollRef = useRef(null)

  const cargar = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const j = await api.obtenerJob(id)
      setJob(j)
      if (!ESTADOS_ACTIVOS.has(j.estado)) {
        const errs = await api.listarErrores(id, { limit: 200 })
        setErrores(errs)
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al cargar el job')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    cargar()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!job) return
    const activo = ESTADOS_ACTIVOS.has(job.estado)
    if (activo && !pollRef.current) {
      pollRef.current = setInterval(() => cargar({ silent: true }), POLL_MS)
    } else if (!activo && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [job])

  const cancelar = async () => {
    try {
      await api.cancelarJob(id)
      cargar()
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo cancelar')
    }
  }

  if (loading || !job) {
    return <Box sx={{ p: 3 }}><CircularProgress /></Box>
  }

  const c = ESTADO_CHIP[job.estado] || { label: job.estado, color: 'default' }
  const activo = ESTADOS_ACTIVOS.has(job.estado)

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        <IconButton onClick={() => navigate('/migracion-ladm')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={600}>Migración LADM #{job.id}</Typography>
        <Chip size="small" label={c.label} color={c.color} />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
          <Box flex={1}>
            <Typography variant="caption" color="text.secondary">Conexión</Typography>
            <Typography>{job.conexion_nombre || 'BD del proyecto'}</Typography>
          </Box>
          <Box flex={1}>
            <Typography variant="caption" color="text.secondary">Esquemas</Typography>
            <Typography sx={{ fontFamily: 'monospace' }}>
              {job.esquema_origen} → {job.esquema_destino}
            </Typography>
          </Box>
          <Box flex={1}>
            <Typography variant="caption" color="text.secondary">Tabla de dominios</Typography>
            <Typography sx={{ fontFamily: 'monospace' }}>{job.tabla_dominios}</Typography>
          </Box>
          <Box flex={1}>
            <Typography variant="caption" color="text.secondary">Iniciado por</Typography>
            <Typography>{job.creado_por || '—'}</Typography>
          </Box>
        </Stack>

        <Box mt={2}>
          <LinearProgress
            variant="determinate" value={job.progreso || 0}
            sx={{ height: 8, borderRadius: 4 }}
          />
          <Stack direction="row" justifyContent="space-between" mt={0.5}>
            <Typography variant="body2" color="text.secondary">
              {job.tabla_actual
                ? `Migrando ${job.tabla_actual} (${job.tabla_actual_idx}/${job.total_tablas})`
                : (activo ? 'Preparando...' : 'Sin actividad')}
            </Typography>
            <Typography variant="body2" color="text.secondary">{job.progreso || 0}%</Typography>
          </Stack>
        </Box>

        {job.error_message && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {job.error_message}
          </Alert>
        )}

        <Stack direction="row" spacing={1} mt={2}>
          {activo && (
            <Button
              variant="outlined" color="warning" startIcon={<StopIcon />}
              onClick={cancelar} disabled={job.cancelar_solicitado}
            >
              {job.cancelar_solicitado ? 'Cancelando...' : 'Cancelar'}
            </Button>
          )}
          {!activo && (
            <Button
              variant="outlined" startIcon={<DownloadIcon />}
              onClick={() => api.descargarReporte(id)}
            >
              Descargar reporte
            </Button>
          )}
          <Tooltip title="Refrescar">
            <IconButton onClick={() => cargar()}><RefreshIcon /></IconButton>
          </Tooltip>
        </Stack>
      </Paper>

      <Divider sx={{ my: 2 }} />

      <Typography variant="h6" mb={1}>
        Errores fila por fila ({errores.total})
      </Typography>

      {errores.total === 0 && !activo ? (
        <Alert severity="success">No se registraron errores.</Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Tabla</TableCell>
                <TableCell>Error</TableCell>
                <TableCell>Fila (resumen)</TableCell>
                <TableCell>Fecha</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {errores.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    {activo ? 'En curso — los errores aparecen al terminar' : 'Sin errores'}
                  </TableCell>
                </TableRow>
              ) : errores.items.map(e => (
                <TableRow key={e.id} hover>
                  <TableCell>{e.id}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{e.tabla}</TableCell>
                  <TableCell>
                    <Typography variant="caption" color="error">{e.error_reason}</Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 380 }}>
                    <Typography variant="caption" sx={{
                      fontFamily: 'monospace', display: 'block',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {e.fila_json ? JSON.stringify(e.fila_json) : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {e.fecha_registro ? new Date(e.fecha_registro).toLocaleString() : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}
