import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Paper, Button, Stack, Chip, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress, LinearProgress,
} from '@mui/material'
import AddIcon       from '@mui/icons-material/Add'
import RefreshIcon   from '@mui/icons-material/Refresh'
import VisibilityIcon from '@mui/icons-material/Visibility'
import StorageIcon   from '@mui/icons-material/Storage'
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

export default function MigracionLadm() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const pollRef = useRef(null)

  const cargar = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      setJobs(await api.listarJobs({ limit: 50 }))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    cargar()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  useEffect(() => {
    const hayActivos = jobs.some(j => ESTADOS_ACTIVOS.has(j.estado))
    if (hayActivos && !pollRef.current) {
      pollRef.current = setInterval(() => cargar({ silent: true }), POLL_MS)
    } else if (!hayActivos && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [jobs])

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={600}>Migración LADM</Typography>
        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<StorageIcon />}
            variant="outlined"
            onClick={() => navigate('/migracion-ladm/conexiones')}
          >
            Perfiles de conexión
          </Button>
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            onClick={() => navigate('/migracion-ladm/crear')}
          >
            Nueva migración
          </Button>
        </Stack>
      </Stack>

      <Typography variant="body2" color="text.secondary" mb={3}>
        Migra el esquema <code>validado</code> al modelo LADM oficial. Cada
        ejecución corre en segundo plano y reporta progreso por tabla.
        Solo administradores pueden ejecutar.
      </Typography>

      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="h6">Histórico</Typography>
        <Tooltip title="Refrescar">
          <IconButton onClick={() => cargar()} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Conexión</TableCell>
              <TableCell>Esquemas</TableCell>
              <TableCell>Progreso</TableCell>
              <TableCell>Tabla actual</TableCell>
              <TableCell>Inicio</TableCell>
              <TableCell>Por</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} align="center"><CircularProgress size={20} /></TableCell></TableRow>
            ) : jobs.length === 0 ? (
              <TableRow><TableCell colSpan={9} align="center">Sin migraciones</TableCell></TableRow>
            ) : jobs.map(j => {
              const c = ESTADO_CHIP[j.estado] || { label: j.estado, color: 'default' }
              return (
                <TableRow key={j.id} hover>
                  <TableCell>{j.id}</TableCell>
                  <TableCell><Chip size="small" label={c.label} color={c.color} /></TableCell>
                  <TableCell>{j.conexion_nombre || 'BD del proyecto'}</TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {j.esquema_origen} → {j.esquema_destino}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 130 }}>
                    <LinearProgress
                      variant="determinate"
                      value={j.progreso || 0}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {j.progreso || 0}%
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {j.tabla_actual
                      ? `${j.tabla_actual} (${j.tabla_actual_idx}/${j.total_tablas})`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {j.iniciado_en ? new Date(j.iniciado_en).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>{j.creado_por || '—'}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Ver detalle">
                      <IconButton size="small" onClick={() => navigate(`/migracion-ladm/${j.id}`)}>
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
