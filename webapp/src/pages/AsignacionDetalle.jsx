import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box, Typography, Chip, Button, Alert,
  CircularProgress, Stack, Divider, Grid,
  Card, CardContent, IconButton, Tab, Tabs
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import ArrowBackIcon  from '@mui/icons-material/ArrowBack'
import MapIcon        from '@mui/icons-material/Map'
import TableChartIcon from '@mui/icons-material/TableChart'
import AssignmentIcon from '@mui/icons-material/Assignment'
import PersonIcon     from '@mui/icons-material/Person'
import FolderIcon     from '@mui/icons-material/Folder'
import Map          from 'ol/Map'
import View         from 'ol/View'
import TileLayer    from 'ol/layer/Tile'
import VectorLayer  from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import OSM         from 'ol/source/OSM'
import GeoJSON     from 'ol/format/GeoJSON'
import { Style, Fill, Stroke } from 'ol/style'
import { fromLonLat } from 'ol/proj'
import Select      from 'ol/interaction/Select'
import { click }   from 'ol/events/condition'
import 'ol/ol.css'
import { useParams, useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import api from '../api/axios'
import ModalMetodoAsignacion from '../components/ModalMetodoAsignacion'
import ModalMapaAsignacion   from '../components/ModalMapaAsignacion'

const MAP_HEIGHT = 550

const coloresEstado = {
  campo:      { fill: 'rgba(255,0,200,0.4)',  stroke: '#F57C00' },
  validado:   { fill: 'rgba(33,150,243,0.4)', stroke: '#1565C0' },
  finalizado: { fill: 'rgba(76,175,80,0.4)',  stroke: '#2E7D32' },
  sin_asignar:{ fill: 'rgba(255,152,0,0.4)',stroke:'#F57C00' }
}

const chipEstado = {
  campo:      'warning',
  validado:   'info',
  finalizado: 'success',
}

// Estilo del área del proyecto: borde azul punteado, relleno muy tenue
const estiloArea = new Style({
  fill:   new Fill({ color: 'rgba(25, 118, 210, 0.08)' }),
  stroke: new Stroke({ color: '#1976D2', width: 2.5, lineDash: [8, 4] })
})

function estiloPredioPorEstado(estado) {
  const c = coloresEstado[estado] || coloresEstado.sin_asignar
  return new Style({
    fill:   new Fill({ color: c.fill }),
    stroke: new Stroke({ color: c.stroke, width: 1.5 })
  })
}

export default function AsignacionDetalle() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const { user }   = useSelector(state => state.auth)
  const puedeAdmin = user?.roles?.some(r => ['administrador', 'supervisor'].includes(r))

  const mapRef          = useRef(null)
  const mapInstance     = useRef(null)
  const prediosLayerRef = useRef(null)
  const areaLayerRef    = useRef(null)    // ← capa área proyecto
  const geojsonCargado  = useRef(false)
  const areaCargada     = useRef(false)   // ← evitar recargar área

  const [tab,          setTab]          = useState(0)
  const [proyecto,     setProyecto]     = useState(null)
  const [predios,      setPredios]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [success,      setSuccess]      = useState('')
  const [predioActivo, setPredioActivo] = useState(null)
  const [tieneArea,    setTieneArea]    = useState(false)

  const [modalMetodo,    setModalMetodo]    = useState(false)
  const [modalMapa,      setModalMapa]      = useState(false)
  const [metodoSelected, setMetodoSelected] = useState(null)

  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   4000) }
  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }

  // ── Cargar datos ─────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    geojsonCargado.current = false
    areaCargada.current    = false
    try {
      const [prRes, pdRes] = await Promise.all([
        api.get(`/proyectos/${id}`),
        api.get(`/proyectos/${id}/predios`)
      ])
      setProyecto(prRes.data)
      setPredios(pdRes.data)
    } catch {
      mostrarError('Error cargando datos del proyecto')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // ── Inicializar mapa la PRIMERA vez que se abre el tab ───
  useEffect(() => {
    if (tab !== 1) return
    if (!mapRef.current) return

    if (!mapInstance.current) {
      // Capa área del proyecto (debajo de los predios)
      areaLayerRef.current = new VectorLayer({
        source: new VectorSource(),
        style:  estiloArea,
        zIndex: 1
      })

      // Capa predios (encima)
      prediosLayerRef.current = new VectorLayer({
        source: new VectorSource(),
        style:  (feature) => estiloPredioPorEstado(feature.get('estado')),
        zIndex: 2
      })

      mapInstance.current = new Map({
        target: mapRef.current,
        layers: [
          new TileLayer({ source: new OSM() }),
          areaLayerRef.current,
          prediosLayerRef.current
        ],
        view: new View({
          center: fromLonLat([-74.09, 4.71]),
          zoom:   13
        })
      })

      const selectInteraction = new Select({ condition: click })
      selectInteraction.on('select', (e) => {
        // Solo activar panel si el feature es un predio (tiene npn)
        if (e.selected.length > 0) {
          const props = e.selected[0].getProperties()
          setPredioActivo(props?.npn ? props : null)
        } else {
          setPredioActivo(null)
        }
      })
      mapInstance.current.addInteraction(selectInteraction)

      mapInstance.current.on('pointermove', (e) => {
        const hit = mapInstance.current.hasFeatureAtPixel(e.pixel)
        mapInstance.current.getTargetElement().style.cursor = hit ? 'pointer' : ''
      })

      if (predios.length > 0 && !geojsonCargado.current) {
        cargarGeojson()
        cargarArea()
      }
    }

    // Cada vez que volvemos al tab: recalcular tamaño
    setTimeout(() => {
      mapInstance.current?.updateSize()
      const source = prediosLayerRef.current?.getSource()
      if (source && source.getFeatures().length > 0) {
        mapInstance.current.getView().fit(source.getExtent(), {
          padding: [5, 5, 5, 50]
        })
      }
    }, 50)
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cargar GeoJSON de predios ────────────────────────────
  const cargarGeojson = useCallback(async () => {
    if (geojsonCargado.current) return
    try {
      const { data } = await api.get(`/proyectos/${id}/geojson`)
      if (!data?.features?.length) return

      const source = prediosLayerRef.current.getSource()
      source.clear()
      const features = new GeoJSON().readFeatures(data, {
        featureProjection: 'EPSG:3857',
        dataProjection:    'EPSG:4326'
      })
      source.addFeatures(features)
      geojsonCargado.current = true

      mapInstance.current?.updateSize()
      mapInstance.current?.getView().fit(source.getExtent(), {
        padding: [5, 5, 5, 5]
      })
    } catch {
      // sin geojson — no crítico
    }
  }, [id])

  // ── Cargar área del proyecto ─────────────────────────────
  const cargarArea = useCallback(async () => {
    if (areaCargada.current) return
    try {
      const { data } = await api.get(`/proyectos/${id}/area`)
      const source = areaLayerRef.current.getSource()
      source.clear()
      // El endpoint devuelve un GeoJSON Feature
      const features = new GeoJSON().readFeatures(data, {
        featureProjection: 'EPSG:3857',
        dataProjection:    'EPSG:4326'
      })
      source.addFeatures(features)
      areaCargada.current = true
      setTieneArea(true)
    } catch {
      // El proyecto puede no tener área definida aún — no es error crítico
      setTieneArea(false)
    }
  }, [id])

  // Si los predios llegan después de que el mapa ya está abierto
  useEffect(() => {
    if (tab === 1 && mapInstance.current && predios.length > 0 && !geojsonCargado.current) {
      cargarGeojson()
      cargarArea()
    }
  }, [predios, tab, cargarGeojson, cargarArea])

  // ── Destruir al desmontar ────────────────────────────────
  useEffect(() => {
    return () => {
      if (mapInstance.current) {
        mapInstance.current.setTarget(null)
        mapInstance.current = null
      }
    }
  }, [])

  // ── Columnas tabla ───────────────────────────────────────
  const columnas = [
    { field: 'npn',           headerName: 'NPN',       width: 200 },
    { field: 'nombre_predio', headerName: 'Indentficación',     width: 200  },
    { field: 'municipio',     headerName: 'Municipio', width: 140 },
    { field: 'responsable', headerName: 'Responsable', width: 180 },
    {
      field: 'estado', headerName: 'Estado', width: 120,
      renderCell: ({ value }) => (
        <Chip label={value} size="small" color={chipEstado[value] || 'default'} />
      )
    }
  ]

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/asignaciones')}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FolderIcon color="primary" />
            <Typography variant="h5" fontWeight={600}>
              {proyecto?.clave_proyecto}
            </Typography>
            <Chip
              label={proyecto?.estado}
              size="small"
              color={
                proyecto?.estado === 'campo'      ? 'warning'  :
                proyecto?.estado === 'validado'   ? 'info'     :
                proyecto?.estado === 'finalizado' ? 'success'  : 'default'
              }
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {proyecto?.descripcion || 'Sin descripción'}
          </Typography>
        </Box>
        {puedeAdmin && (
          <Button
            variant="contained"
            startIcon={<AssignmentIcon />}
            onClick={() => setModalMetodo(true)}
          >
            Asignar predios
          </Button>
        )}
      </Box>

      {/* Alertas */}
      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Resumen */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={3}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PersonIcon color="action" fontSize="small" />
                <Box>
                  <Typography variant="caption" color="text.secondary">Responsable</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {proyecto?.responsable || 'Sin asignar'}
                  </Typography>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">Total predios</Typography>
                <Typography variant="body2" fontWeight={500}>{predios.length}</Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">En campo</Typography>
                <Typography variant="body2" fontWeight={500} color="warning.main">
                  {predios.filter(p => p.estado === 'campo').length}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">Finalizados</Typography>
                <Typography variant="body2" fontWeight={500} color="success.main">
                  {predios.filter(p => p.estado === 'finalizado').length}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab icon={<TableChartIcon />} iconPosition="start" label="Tabla" />
        <Tab icon={<MapIcon />}        iconPosition="start" label="Mapa"  />
      </Tabs>

      {/* ── Tab Tabla ── */}
      {tab === 0 && (
        <DataGrid
          rows={predios}
          columns={columnas}
          autoHeight
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          disableRowSelectionOnClick
          sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
        />
      )}

      {/* ── Tab Mapa — siempre en DOM, visibilidad por CSS ── */}
      <Box sx={{ display: tab === 1 ? 'flex' : 'none', gap: 2 }}>

        <Box sx={{
          flexGrow: 1,
          height:   MAP_HEIGHT,
          borderRadius: 2,
          overflow: 'hidden',
          position: 'relative',
          border: '1px solid',
          borderColor: 'divider'
        }}>
          <div
            ref={mapRef}
            style={{ width: '100%', height: `${MAP_HEIGHT}px` }}
          />

          {/* Leyenda */}
          <Card sx={{
            position: 'absolute', bottom: 16, left: 16,
            zIndex: 1000, p: 1.5, minWidth: 150
          }}>
            
            {tieneArea && (
              <>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{
                    width: 14, height: 14, borderRadius: 0.5,
                    bgcolor: 'rgba(25,118,210,0.08)',
                    border: '2.5px dashed #1976D2'
                  }} />
                  <Typography variant="caption">Área proyecto</Typography>
                </Box>
              </>
            )}
          </Card>
        </Box>

        {/* Panel detalle predio */}
        {predioActivo && (
          <Card sx={{ width: 260, overflow: 'auto', height: MAP_HEIGHT }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={600} mb={1}>
                Detalle del predio
              </Typography>
              <Divider sx={{ mb: 1.5 }} />
              <Stack spacing={1.5}>
                {[
                  { label: 'NPN',        value: predioActivo.npn },
                  { label: 'Nombre',     value: predioActivo.nombre_predio },
                  { label: 'Municipio',  value: predioActivo.municipio },
                  { label: 'Área (m²)',  value: predioActivo.area_terreno
                      ? Number(predioActivo.area_terreno).toFixed(2) : null },
                  { label: 'Avalúo',     value: predioActivo.avaluo_catastral
                      ? `$${Number(predioActivo.avaluo_catastral).toLocaleString('es-CO')}` : null },
                  { label: 'Responsable',value: predioActivo.responsable },
                ].map(({ label, value }) => (
                  <Box key={label}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="body2" fontWeight={500}>{value || '—'}</Typography>
                  </Box>
                ))}
                <Box>
                  <Typography variant="caption" color="text.secondary">Estado</Typography>
                  <Box mt={0.5}>
                    <Chip
                      label={predioActivo.estado}
                      size="small"
                      color={chipEstado[predioActivo.estado] || 'default'}
                    />
                  </Box>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Box>

      {/* Modales */}
      <ModalMetodoAsignacion
        open={modalMetodo}
        onClose={() => setModalMetodo(false)}
        onSelect={(metodo) => {
          setMetodoSelected(metodo)
          setModalMetodo(false)
          setModalMapa(true)
        }}
      />

      <ModalMapaAsignacion
        open={modalMapa}
        onClose={() => setModalMapa(false)}
        metodo={metodoSelected}
        proyecto={proyecto}
        onAsignar={(total) => {
          mostrarSuccess(`${total} predios asignados exitosamente`)
          cargarDatos()
        }}
      />

    </Box>
  )
}
