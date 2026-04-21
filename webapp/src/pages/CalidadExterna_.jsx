import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Button, Chip, Alert,
  CircularProgress, Stack, IconButton, Tooltip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import AddIcon           from '@mui/icons-material/Add'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import VisibilityIcon    from '@mui/icons-material/Visibility'
import { useNavigate } from 'react-router-dom'
import api from '../api/axios'

const chipEstado = { activo: 'success', cerrado: 'default' }

export default function CalidadExterna() {
  console.log("Calidad externa.....")
  const navigate = useNavigate()
  const [proyectos, setProyectos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/calidad-externa/')
      setProyectos(data)
    } catch {
      setError('Error cargando proyectos de calidad externa')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

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
      field: 'total_predios', headerName: 'Predios', width: 100,
      renderCell: ({ value }) => <Chip label={value} size="small" variant="outlined" />
    },
    {
      field: 'muestra_calculada', headerName: 'Muestra', width: 100,
      renderCell: ({ value }) => (
        <Chip label={value} size="small" color="warning" variant="outlined" />
      )
    },
    {
      field: 'fecha_creacion', headerName: 'Creación', width: 130,
      valueFormatter: ({ value }) =>
        value ? new Date(value).toLocaleDateString('es-CO') : '—'
    },
    {
      field: 'acciones', headerName: '', width: 70, sortable: false,
      renderCell: ({ row }) => (
        <Tooltip title="Ver detalle">
          <IconButton size="small" color="warning"
            onClick={() => navigate(`/calidad-externa/${row.id}`)}
          >
            <VisibilityIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )
    }
  ]

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TravelExploreIcon color="warning" />
          <Typography variant="h5" fontWeight={600}>Calidad Externa</Typography>
          <Chip label="Externa" size="small" color="warning" />
        </Box>
        <Button
          variant="contained" color="warning"
          startIcon={<AddIcon />}
          onClick={() => navigate('/calidad-externa/crear')}
        >
          Nuevo proyecto
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

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
    </Box>
  )
}
