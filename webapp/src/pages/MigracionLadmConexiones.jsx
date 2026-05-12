import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Paper, Button, Stack, TextField, Alert, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
} from '@mui/material'
import AddIcon       from '@mui/icons-material/Add'
import EditIcon      from '@mui/icons-material/Edit'
import DeleteIcon    from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import api from '../api/migracionLadm'

const FORM_INICIAL = {
  id: null, nombre: '', host: '', port: 5432, dbname: '', usuario: '',
  password: '', notas: '',
}

export default function MigracionLadmConexiones() {
  const navigate = useNavigate()
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [info, setInfo]       = useState('')
  const [dialog, setDialog]   = useState(null)  // form data | null
  const [saving, setSaving]   = useState(false)
  const [probandoId, setProbandoId] = useState(null)

  const cargar = async () => {
    setLoading(true)
    try {
      setItems(await api.listarConexiones())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const abrirCrear = () => setDialog({ ...FORM_INICIAL })

  const abrirEditar = async (item) => {
    const full = await api.obtenerConexion(item.id)
    setDialog({ ...full, password: '' })  // password en blanco = no cambiar
  }

  const guardar = async () => {
    setError(''); setSaving(true)
    try {
      const payload = { ...dialog }
      if (dialog.id) {
        if (!payload.password) delete payload.password
        delete payload.id
        await api.actualizarConexion(dialog.id, payload)
      } else {
        await api.crearConexion(payload)
      }
      setDialog(null)
      cargar()
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const borrar = async (item) => {
    if (!window.confirm(`¿Eliminar el perfil "${item.nombre}"?`)) return
    try {
      await api.borrarConexion(item.id)
      cargar()
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al eliminar')
    }
  }

  const probar = async (item) => {
    setError(''); setInfo(''); setProbandoId(item.id)
    try {
      const res = await api.probarConexionPerfil(item.id)
      if (res.ok) setInfo(`✅ Perfil "${item.nombre}": ${res.mensaje}`)
      else        setError(`❌ Perfil "${item.nombre}": ${res.error}`)
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al probar conexión')
    } finally {
      setProbandoId(null)
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        <IconButton onClick={() => navigate('/migracion-ladm')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={600}>Perfiles de conexión</Typography>
        <Box flex={1} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={abrirCrear}>
          Nuevo perfil
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" mb={3}>
        Conexiones reutilizables a bases de datos PostGIS donde se ejecutará
        la migración LADM. Las contraseñas se cifran antes de guardarse.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {info  && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setInfo('')}>{info}</Alert>}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nombre</TableCell>
              <TableCell>Host</TableCell>
              <TableCell>Puerto</TableCell>
              <TableCell>Base</TableCell>
              <TableCell>Usuario</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={20} /></TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={6} align="center">Sin perfiles</TableCell></TableRow>
            ) : items.map(it => (
              <TableRow key={it.id} hover>
                <TableCell>{it.nombre}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{it.host}</TableCell>
                <TableCell>{it.port}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{it.dbname}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{it.usuario}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Probar conexión">
                    <IconButton size="small" onClick={() => probar(it)} disabled={probandoId === it.id}>
                      {probandoId === it.id ? <CircularProgress size={16} /> : <PlayArrowIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Editar">
                    <IconButton size="small" onClick={() => abrirEditar(it)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Eliminar">
                    <IconButton size="small" onClick={() => borrar(it)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!dialog} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{dialog?.id ? 'Editar perfil' : 'Nuevo perfil de conexión'}</DialogTitle>
        <DialogContent>
          {dialog && (
            <Stack spacing={2} mt={1}>
              <TextField
                fullWidth size="small" label="Nombre" required
                value={dialog.nombre} onChange={e => setDialog({ ...dialog, nombre: e.target.value })}
              />
              <Stack direction="row" spacing={2}>
                <TextField fullWidth size="small" label="Host" required
                  value={dialog.host} onChange={e => setDialog({ ...dialog, host: e.target.value })} />
                <TextField sx={{ width: 120 }} size="small" type="number" label="Puerto"
                  value={dialog.port} onChange={e => setDialog({ ...dialog, port: Number(e.target.value) })} />
              </Stack>
              <TextField fullWidth size="small" label="Base de datos" required
                value={dialog.dbname} onChange={e => setDialog({ ...dialog, dbname: e.target.value })} />
              <Stack direction="row" spacing={2}>
                <TextField fullWidth size="small" label="Usuario" required
                  value={dialog.usuario} onChange={e => setDialog({ ...dialog, usuario: e.target.value })} />
                <TextField
                  fullWidth size="small" type="password"
                  label={dialog.id ? 'Password (vacío = no cambiar)' : 'Password'}
                  required={!dialog.id}
                  value={dialog.password}
                  onChange={e => setDialog({ ...dialog, password: e.target.value })}
                />
              </Stack>
              <TextField
                fullWidth size="small" label="Notas" multiline rows={2}
                value={dialog.notas || ''}
                onChange={e => setDialog({ ...dialog, notas: e.target.value })}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancelar</Button>
          <Button
            variant="contained" onClick={guardar}
            disabled={saving || !dialog?.nombre || !dialog?.host || !dialog?.dbname
                       || !dialog?.usuario || (!dialog?.id && !dialog?.password)}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
