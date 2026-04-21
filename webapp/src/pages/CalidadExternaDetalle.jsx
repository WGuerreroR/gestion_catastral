import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Button, Card, CardContent, Chip,
  Alert, CircularProgress, Stack, Divider, Grid,
  IconButton, Tab, Tabs, Dialog, DialogTitle,
  DialogContent, DialogActions
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import ArrowBackIcon     from '@mui/icons-material/ArrowBack'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import ShuffleIcon       from '@mui/icons-material/Shuffle'
import TableChartIcon    from '@mui/icons-material/TableChart'
import MapIcon           from '@mui/icons-material/Map'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api/axios'
import MapaCalidad, { COLORES } from '../components/MapaCalidad'
import useRerandomizar from '../hooks/useRerandomizar'

export default function CalidadExternaDetalle() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [proyecto,     setProyecto]     = useState(null)
  const [predios,      setPredios]      = useState([])
  const [geojson,      setGeojson]      = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [tab,          setTab]          = useState(0)
  const [filtro,       setFiltro]       = useState('todos')
  const [error,        setError]        = useState('')
  const [success,      setSuccess]      = useState('')
  const [predioActivo, setPredioActivo] = useState(null)

  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }
  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   4000) }

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const [prRes, pdRes] = await Promise.all([
        api.get(`/calidad-externa/${id}`),
        api.get(`/calidad-externa/${id}/predios`)
      ])
      setProyecto(prRes.data)
      setPredios(pdRes.data)
    } catch {
      mostrarError('Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    if (tab !== 1 || geojson) return
    api.get(`/calidad-externa/${id}/geojson`)
      .then(({ data }) => setGeojson(data))
      .catch(() => {})
  }, [tab, id, geojson])

  const { confirmar, dialogProps } = useRerandomizar({
    tipo: 'externa',
    id:   parseInt(id),
    onExito: () => {
      mostrarSuccess('Muestra rerandomizada exitosamente')
      setGeojson(null)
      cargar()
    },
    onError: mostrarError
  })

  const prediosFiltrados = predios.filter(p => {
    if (filtro === 'muestra')    return p.en_muestra
    if (filtro === 'no_muestra') return !p.en_muestra
    return true
  })

  const columnas = [
    { field: 'npn_etiqueta',  headerName: 'NPN',       width: 200 },
    { field: 'nombre_predio', headerName: 'Nombre',    flex: 1    },
    { field: 'municipio',     headerName: 'Municipio', width: 140 },
    {
      field: 'en_muestra', headerName: 'Muestra', width: 110,
      renderCell: ({ value }) => value
        ? <Chip label="Muestra" size="small" color="warning" icon={<ShuffleIcon />} />
        : <Chip label="—" size="small" />
    }
  ]

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <CircularProgress />
    </Box>
  )

  const totalMuestra = predios.filter(p => p.en_muestra).length

  // El área del proyecto viene en geojson.area_proyecto
  const areaGeojson = geojson?.area_proyecto || null

  return (
    <Box sx={{ p: 3 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/calidad-externa')}>
          <ArrowBackIcon />
        </IconButton>
        <TravelExploreIcon color="warning" />
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h5" fontWeight={600}>{proyecto?.nombre}</Typography>
            <Chip label="Externa" size="small" color="warning" />
            <Chip
              label={proyecto?.estado}
              size="small"
              color={proyecto?.estado === 'activo' ? 'success' : 'default'}
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {proyecto?.descripcion || 'Sin descripción'}
          </Typography>
        </Box>
        <Button
          variant="outlined" color="warning"
          startIcon={<ShuffleIcon />}
          onClick={confirmar}
        >
          Re-randomizar muestra
        </Button>
      </Box>

      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Cards resumen */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Total predios',     value: proyecto?.total_predios,     color: 'text.primary'  },
          { label: 'Muestra calculada', value: proyecto?.muestra_calculada, color: 'warning.main'  },
          { label: 'En muestra',        value: totalMuestra,                color: 'warning.main'  },
        ].map(({ label, value, color }) => (
          <Grid item xs={6} sm={4} key={label}>
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="h4" fontWeight={700} color={color}>{value}</Typography>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab icon={<TableChartIcon />} iconPosition="start" label="Tabla" />
        <Tab icon={<MapIcon />}        iconPosition="start" label="Mapa"  />
      </Tabs>

      {/* Tab Tabla */}
      {tab === 0 && (
        <Box>
          <Stack direction="row" spacing={1} mb={2}>
            {[
              { key: 'todos',      label: 'Todos'            },
              { key: 'muestra',    label: 'Solo muestra'     },
              { key: 'no_muestra', label: 'No seleccionados' }
            ].map(f => (
              <Chip key={f.key} label={f.label}
                onClick={() => setFiltro(f.key)}
                color={filtro === f.key ? 'warning' : 'default'}
                variant={filtro === f.key ? 'filled' : 'outlined'}
              />
            ))}
          </Stack>
          <DataGrid
            rows={prediosFiltrados}
            getRowId={(row) => row.id_operacion}
            columns={columnas}
            autoHeight
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            disableRowSelectionOnClick
            sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
          />
        </Box>
      )}

      {/* Tab Mapa — SIEMPRE en DOM */}
      <Box sx={{ display: tab === 1 ? 'flex' : 'none', gap: 2 }}>
        <Box sx={{
          flexGrow: 1, borderRadius: 2, overflow: 'hidden',
          position: 'relative', border: '1px solid', borderColor: 'divider'
        }}>
          {/* MapaCalidad incluye el área del proyecto como capa adicional */}
          <MapaCalidad
            geojson={geojson}
            areaGeojson={areaGeojson}
            height={550}
            onClickPredioo={setPredioActivo}
          />

          {/* Leyenda */}
          <Card sx={{ position: 'absolute', bottom: 16, left: 16, zIndex: 1000, p: 1.5 }}>
            <Typography variant="caption" fontWeight={600} display="block" mb={1}>
              Leyenda
            </Typography>
            {[
              { label: 'Universo', c: COLORES.universo, dash: false },
              { label: 'Muestra',  c: COLORES.muestra,  dash: false },
              { label: 'Área evaluada', c: COLORES.area, dash: true }
            ].map(({ label, c, dash }) => (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Box sx={{
                  width: 14, height: 14, borderRadius: 0.5,
                  bgcolor: c.fill,
                  border: `2px ${dash ? 'dashed' : 'solid'} ${c.stroke}`
                }} />
                <Typography variant="caption">{label}</Typography>
              </Box>
            ))}
          </Card>
        </Box>

        {/* Panel detalle predio */}
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
                      ? <Chip label="Muestra" size="small" color="warning" icon={<ShuffleIcon />} />
                      : <Chip label="No seleccionado" size="small" />
                    }
                  </Box>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Box>

      {/* Dialog rerandomizar */}
      <Dialog open={dialogProps.open} onClose={dialogProps.onClose} maxWidth="xs" fullWidth>
        <DialogTitle>Re-randomizar muestra</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Se seleccionarán <strong>{proyecto?.muestra_calculada}</strong> predios
            nuevos de forma aleatoria reemplazando la muestra actual. ¿Continuar?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={dialogProps.onCancelar} disabled={dialogProps.cargando}>
            Cancelar
          </Button>
          <Button
            variant="contained" color="warning"
            onClick={dialogProps.onConfirmar}
            disabled={dialogProps.cargando}
            startIcon={dialogProps.cargando
              ? <CircularProgress size={16} color="inherit" />
              : <ShuffleIcon />
            }
          >
            {dialogProps.cargando ? 'Procesando...' : 'Re-randomizar'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}
