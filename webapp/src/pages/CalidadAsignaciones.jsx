import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Button, Chip, Alert, CircularProgress,
  Stack, IconButton, Tooltip, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import AddIcon        from '@mui/icons-material/Add'
import FactCheckIcon  from '@mui/icons-material/FactCheck'
import VisibilityIcon from '@mui/icons-material/Visibility'
import EditIcon       from '@mui/icons-material/Edit'
import DeleteIcon     from '@mui/icons-material/Delete'
import { useNavigate } from 'react-router-dom'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'

const chipEstado = { activo: 'success', cerrado: 'default' }

export default function CalidadAsignaciones() {
  const navigate = useNavigate()
  const [proyectos,        setProyectos]        = useState([])
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState('')
  const [success,          setSuccess]          = useState('')
  const [proyectoEliminar, setProyectoEliminar] = useState(null)
  const [eliminando,       setEliminando]       = useState(false)
  const [proyectoEditar,   setProyectoEditar]   = useState(null)
  const [editNombre,       setEditNombre]       = useState('')
  const [editDescripcion,  setEditDescripcion]  = useState('')
  const [guardando,        setGuardando]        = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/calidad-muestreo/')
      setProyectos(data)
    } catch {
      setError('Error cargando proyectos de calidad por asignación')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const abrirEditar = (proy) => {
    setProyectoEditar(proy)
    setEditNombre(proy?.nombre ?? '')
    setEditDescripcion(proy?.descripcion ?? '')
  }
  const cerrarEditar = () => {
    if (guardando) return
    setProyectoEditar(null)
  }
  const guardarEdicion = async () => {
    if (!proyectoEditar || !editNombre.trim()) return
    setGuardando(true)
    try {
      await api.put(`/calidad-muestreo/${proyectoEditar.id}`, {
        nombre:      editNombre.trim(),
        descripcion: editDescripcion.trim() || null,
      })
      setSuccess(`Proyecto "${editNombre.trim()}" actualizado`)
      setTimeout(() => setSuccess(''), 4000)
      setProyectoEditar(null)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e, 'Error al actualizar el proyecto'))
    } finally {
      setGuardando(false)
    }
  }

  const handleEliminar = async () => {
    if (!proyectoEliminar) return
    setEliminando(true)
    try {
      await api.delete(`/calidad-muestreo/${proyectoEliminar.id}`)
      setSuccess(`Proyecto "${proyectoEliminar.nombre}" eliminado`)
      setTimeout(() => setSuccess(''), 4000)
      setProyectoEliminar(null)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e, 'Error al eliminar el proyecto'))
    } finally {
      setEliminando(false)
    }
  }

  const columnas = [
    {
      field: 'nombre', headerName: 'Nombre', flex: 1,
      renderCell: ({ value }) => (
        <Typography variant="body2" fontWeight={600}>{value}</Typography>
      )
    },
    {
      field: 'estado', headerName: 'Estado', width: 110,
      renderCell: ({ value }) => (
        <Chip label={value} size="small" color={chipEstado[value] || 'default'} />
      )
    },
    {
      field: 'asignaciones_count', headerName: 'Asignaciones', width: 120,
      renderCell: ({ value }) => (
        <Chip label={value ?? 0} size="small" variant="outlined" />
      )
    },
    {
      field: 'total_predios', headerName: 'Predios', width: 100,
      renderCell: ({ value }) => <Chip label={value} size="small" variant="outlined" />
    },
    {
      field: 'muestra_calculada', headerName: 'Muestra', width: 100,
      renderCell: ({ value }) => (
        <Chip label={value} size="small" color="primary" variant="outlined" />
      )
    },
    {
      field: 'fecha_creacion', headerName: 'Creación', width: 130,
      valueFormatter: ({ value }) =>
        value ? new Date(value).toLocaleDateString('es-CO') : '—'
    },
    { field: 'creado_por_nombre', headerName: 'Creado por', width: 180 },
    {
      field: 'acciones', headerName: '', width: 140, sortable: false,
      renderCell: ({ row }) => {
        const cerrado = row.estado === 'cerrado'
        return (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Ver detalle">
              <IconButton size="small" color="primary"
                onClick={() => navigate(`/calidad-asignaciones/${row.id}`)}
              >
                <VisibilityIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={cerrado
              ? 'No se puede editar un proyecto cerrado'
              : 'Editar nombre y descripción'}>
              <span>
                <IconButton size="small"
                  disabled={cerrado}
                  onClick={() => abrirEditar(row)}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Eliminar proyecto">
              <IconButton size="small" color="error"
                onClick={() => setProyectoEliminar(row)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        )
      }
    }
  ]

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FactCheckIcon color="primary" />
          <Typography variant="h5" fontWeight={600}>Calidad por asignación</Typography>
          <Chip label="Asignación" size="small" color="primary" />
        </Box>
        <Button
          variant="contained" color="primary"
          startIcon={<AddIcon />}
          onClick={() => navigate('/calidad-asignaciones/crear')}
        >
          Nuevo proyecto
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
          rows={proyectos}
          columns={columnas}
          autoHeight
          pageSizeOptions={[10, 25]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          disableRowSelectionOnClick
          sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
        />
      )}

      <Dialog
        open={Boolean(proyectoEditar)}
        onClose={cerrarEditar}
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
          <Button onClick={cerrarEditar} disabled={guardando}>
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

      <Dialog
        open={Boolean(proyectoEliminar)}
        onClose={() => !eliminando && setProyectoEliminar(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Eliminar proyecto de calidad por asignación</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            ¿Seguro que deseas eliminar el proyecto{' '}
            <strong>{proyectoEliminar?.nombre}</strong>? Esta acción no se puede
            deshacer y se eliminarán también el universo y la muestra asociados.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setProyectoEliminar(null)} disabled={eliminando}>
            Cancelar
          </Button>
          <Button
            variant="contained" color="error"
            onClick={handleEliminar}
            disabled={eliminando}
            startIcon={eliminando
              ? <CircularProgress size={16} color="inherit" />
              : <DeleteIcon />
            }
          >
            {eliminando ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
