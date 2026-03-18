import { useState, useEffect, useCallback } from 'react'
import {
  Box, Button, Typography, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Alert, CircularProgress, Tooltip,
  Card, CardContent, Chip, Grid
} from '@mui/material'
import AddIcon    from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import GroupIcon  from '@mui/icons-material/Group'
import { useSelector } from 'react-redux'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'

const coloresRol = {
  administrador: 'error',
  gerente:       'warning',
  lider:         'info',
  ejecutor:      'success'
}

export default function Roles() {
  const { user } = useSelector(state => state.auth)
  const esAdmin  = user?.roles?.includes('administrador')

  const [roles,     setRoles]     = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState('')

  // Modal crear
  const [modalOpen, setModalOpen] = useState(false)
  const [nombre,    setNombre]    = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargarRoles = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/roles/')
      setRoles(data)
    } catch {
      setError('Error cargando roles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargarRoles() }, [cargarRoles])

  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   4000) }
  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }

  const handleCrear = async () => {
    setGuardando(true)
    try {
      await api.post('/roles/', { nombre })
      mostrarSuccess('Rol creado exitosamente')
      setModalOpen(false)
      setNombre('')
      cargarRoles()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al crear rol'))
    } finally {
      setGuardando(false)
    }
  }

  const handleEliminar = async (rol) => {
    if (!window.confirm(`¿Eliminar el rol "${rol.nombre}"?`)) return
    try {
      await api.delete(`/roles/${rol.id}`)
      mostrarSuccess('Rol eliminado')
      cargarRoles()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al eliminar rol'))
    }
  }

  return (
    <Box sx={{ p: 3 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          Administración de roles
        </Typography>
        {esAdmin && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setModalOpen(true)}
          >
            Nuevo rol
          </Button>
        )}
      </Box>

      {/* Alertas */}
      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Loading */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          {roles.map(rol => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={rol.id}>
              <Card sx={{
                height: '100%',
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: 4 }
              }}>
                <CardContent>
                  <Box sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start'
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{
                        bgcolor: 'primary.main',
                        color: '#fff',
                        borderRadius: 2,
                        p: 1,
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        <GroupIcon fontSize="small" />
                      </Box>
                      <Box>
                        <Chip
                          label={rol.nombre}
                          color={coloresRol[rol.nombre] || 'default'}
                          size="small"
                          sx={{ fontWeight: 600, mb: 0.5 }}
                        />
                        <Typography variant="caption" color="text.secondary" display="block">
                          ID: {rol.id}
                        </Typography>
                      </Box>
                    </Box>

                    {esAdmin && (
                      <Tooltip title="Eliminar rol">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleEliminar(rol)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}

          {/* Sin roles */}
          {roles.length === 0 && (
            <Grid item xs={12}>
              <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                <GroupIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                <Typography>No hay roles registrados</Typography>
              </Box>
            </Grid>
          )}
        </Grid>
      )}

      {/* Modal crear rol */}
      <Dialog
        open={modalOpen}
        onClose={() => { setModalOpen(false); setNombre('') }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Nuevo rol</DialogTitle>
        <DialogContent>
          <TextField
            label="Nombre del rol"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            fullWidth
            required
            autoFocus
            sx={{ mt: 1 }}
            helperText="Ejemplos: administrador, gerente, lider, ejecutor"
            onKeyDown={e => e.key === 'Enter' && nombre.trim() && handleCrear()}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setModalOpen(false); setNombre('') }}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={handleCrear}
            disabled={guardando || !nombre.trim()}
          >
            {guardando ? <CircularProgress size={20} /> : 'Crear'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}