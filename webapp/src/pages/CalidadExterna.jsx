import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box, Typography, Button, Chip, Alert, CircularProgress,
  Stack, Divider, TextField, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Tab, Tabs, Autocomplete, Drawer
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import AddIcon           from '@mui/icons-material/Add'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import VisibilityIcon    from '@mui/icons-material/Visibility'
import ShuffleIcon       from '@mui/icons-material/Shuffle'
import InfoOutlinedIcon  from '@mui/icons-material/InfoOutlined'
import EditIcon          from '@mui/icons-material/Edit'
import HomeWorkIcon      from '@mui/icons-material/HomeWork'
import LocationCityIcon  from '@mui/icons-material/LocationCity'
import UploadFileIcon    from '@mui/icons-material/UploadFile'
import ListIcon          from '@mui/icons-material/List'
import OlMap        from 'ol/Map'
import View         from 'ol/View'
import TileLayer    from 'ol/layer/Tile'
import VectorLayer  from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import OSM         from 'ol/source/OSM'
import Draw        from 'ol/interaction/Draw'
import Modify      from 'ol/interaction/Modify'
import GeoJSON     from 'ol/format/GeoJSON'
import { Style, Fill, Stroke } from 'ol/style'
import { fromLonLat } from 'ol/proj'
import 'ol/ol.css'
import { useNavigate } from 'react-router-dom'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'

const chipEstado = { activo: 'success', cerrado: 'default' }

function calcularMuestra(n) {
  if (n <= 0) return 0
  const Z = 1.96, p = 0.5, q = 0.5, e = 0.05
  return Math.max(1, Math.ceil((n * Z * Z * p * q) / (e * e * (n - 1) + Z * Z * p * q)))
}

const estiloArea = new Style({
  fill:   new Fill({ color: 'rgba(255,152,0,0.15)' }),
  stroke: new Stroke({ color: '#F57C00', width: 2, lineDash: [8, 4] })
})
const estiloPredio = new Style({
  fill:   new Fill({ color: 'rgba(200,200,200,0.4)' }),
  stroke: new Stroke({ color: '#888', width: 1.5 })
})

const METODOS = [
  { key: 'poligono',  label: 'Dibujar',   icon: <EditIcon /> },
  { key: 'manzanas',  label: 'Manzanas',  icon: <HomeWorkIcon /> },
  { key: 'barrio',    label: 'Barrio',    icon: <LocationCityIcon /> },
  { key: 'shapefile', label: 'Shapefile', icon: <UploadFileIcon /> }
]

// ── Modal de creación con mapa ────────────────────────────────────────────────
function ModalCrear({ open, onClose, onCreado }) {
  const navigate = useNavigate()
  const mapRef       = useRef(null)
  const mapInstance  = useRef(null)
  const areaLayer    = useRef(null)
  const prediosLayer = useRef(null)
  const drawRef      = useRef(null)
  const modifyRef    = useRef(null)

  const [metodo,         setMetodo]         = useState(0)
  const [resultado,      setResultado]      = useState(null)
  const [areaGeojson,    setAreaGeojson]    = useState(null)
  const [nombre,         setNombre]         = useState('')
  const [descripcion,    setDescripcion]    = useState('')
  const [creando,        setCreando]        = useState(false)
  const [buscando,       setBuscando]       = useState(false)
  const [error,          setError]          = useState('')
  const [drawerOpen,     setDrawerOpen]     = useState(false)
  const [opcionesManzana,  setOpcionesManzana]  = useState([])
  const [manzanasSelected, setManzanasSelected] = useState([])
  const [buscandoManzana,  setBuscandoManzana]  = useState(false)
  const [barrios,          setBarrios]          = useState([])

  // Reset al abrir/cerrar
  useEffect(() => {
    if (!open) {
      // Destruir mapa al cerrar
      if (mapInstance.current) {
        mapInstance.current.setTarget(null)
        mapInstance.current = null
      }
      setResultado(null)
      setAreaGeojson(null)
      setNombre('')
      setDescripcion('')
      setError('')
      setMetodo(0)
      setManzanasSelected([])
      return
    }
  }, [open])

  // Inicializar mapa cuando el modal está abierto y el div está disponible
  // Usamos TransitionProps.onEntered para esperar que el Dialog termine su animación
  const initMap = useCallback(() => {
    if (!mapRef.current || mapInstance.current) return

    areaLayer.current = new VectorLayer({
      source: new VectorSource(), style: estiloArea, zIndex: 2
    })
    prediosLayer.current = new VectorLayer({
      source: new VectorSource(), style: estiloPredio, zIndex: 1
    })

    mapInstance.current = new OlMap({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        areaLayer.current,
        prediosLayer.current
      ],
      view: new View({ center: fromLonLat([-74.09, 4.71]), zoom: 13 })
    })

    // Activar dibujo para el método inicial (polígono)
    activarDibujo()
  }, [])

  const activarDibujo = () => {
    if (!mapInstance.current) return
    if (drawRef.current)   mapInstance.current.removeInteraction(drawRef.current)
    if (modifyRef.current) mapInstance.current.removeInteraction(modifyRef.current)
    drawRef.current = modifyRef.current = null

    const draw = new Draw({
      source: areaLayer.current.getSource(),
      type:   'Polygon'
    })
    draw.on('drawend', async (e) => {
      areaLayer.current.getSource().clear()
      areaLayer.current.getSource().addFeature(e.feature)
      const gj = new GeoJSON().writeFeatureObject(e.feature, {
        featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326'
      })
      setAreaGeojson(gj.geometry)
      await buscarPorPoligono(gj.geometry)
    })
    drawRef.current = draw
    mapInstance.current.addInteraction(draw)
  }

  // Cambiar método
  useEffect(() => {
    if (!mapInstance.current) return
    if (drawRef.current)   mapInstance.current.removeInteraction(drawRef.current)
    if (modifyRef.current) mapInstance.current.removeInteraction(modifyRef.current)
    drawRef.current = modifyRef.current = null

    limpiarMapa()

    if (METODOS[metodo].key === 'poligono') activarDibujo()
    if (METODOS[metodo].key === 'barrio' && barrios.length === 0) {
      api.get('/calidad-externa/barrios').then(({ data }) => setBarrios(data)).catch(() => {})
    }
  }, [metodo])

  const limpiarMapa = () => {
    areaLayer.current?.getSource().clear()
    prediosLayer.current?.getSource().clear()
    setResultado(null)
    setAreaGeojson(null)
  }

  const mostrarPrediosEnMapa = (gj) => {
    if (!prediosLayer.current || !gj) return
    const source = prediosLayer.current.getSource()
    source.clear()
    const features = new GeoJSON().readFeatures(gj, {
      featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326'
    })
    source.addFeatures(features)
    if (features.length > 0) {
      mapInstance.current?.updateSize()
      mapInstance.current?.getView().fit(source.getExtent(), {
        padding: [40, 40, 40, 40], maxZoom: 18
      })
    }
  }

  const mostrarAreaEnMapa = (geom) => {
    if (!areaLayer.current || !geom) return
    const source = areaLayer.current.getSource()
    source.clear()
    const feature = new GeoJSON().readFeature(
      { type: 'Feature', geometry: geom },
      { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' }
    )
    source.addFeature(feature)
  }

  const buscarPorPoligono = async (geom) => {
    setBuscando(true)
    setError('')
    try {
      const { data } = await api.post('/calidad-externa/predios-por-poligono', { geojson: geom })
      setResultado(data)
      mostrarPrediosEnMapa(data.geojson_predios)
    } catch {
      setError('Error buscando predios en el área')
    } finally {
      setBuscando(false)
    }
  }

  const buscarManzanas = async (valor) => {
    if (valor.length < 4) return
    setBuscandoManzana(true)
    try {
      const { data } = await api.get(`/calidad-externa/manzanas/${valor}`)
      setOpcionesManzana(data)
    } catch {} finally { setBuscandoManzana(false) }
  }

  const calcularPorManzanas = async () => {
    if (!manzanasSelected.length) return
    setBuscando(true)
    try {
      const { data } = await api.post('/calidad-externa/predios-por-manzanas', {
        codigos_manzana: manzanasSelected.map(m => m.codigo)
      })
      setResultado(data)
      setAreaGeojson(data.hull_geojson)
      mostrarAreaEnMapa(data.hull_geojson)
      mostrarPrediosEnMapa(data.geojson_predios)
      if (!modifyRef.current) {
        const modify = new Modify({ source: areaLayer.current.getSource() })
        modifyRef.current = modify
        mapInstance.current?.addInteraction(modify)
      }
    } catch { setError('Error calculando área por manzanas') }
    finally { setBuscando(false) }
  }

  const calcularPorBarrio = async (barrio) => {
    if (!barrio) return
    setBuscando(true)
    try {
      const { data } = await api.post('/calidad-externa/predios-por-barrio', { barrio_cod: barrio })
      setResultado(data)
      setAreaGeojson(data.hull_geojson)
      mostrarAreaEnMapa(data.hull_geojson)
      mostrarPrediosEnMapa(data.geojson_predios)
      if (modifyRef.current) mapInstance.current?.removeInteraction(modifyRef.current)
      const modify = new Modify({ source: areaLayer.current.getSource() })
      modifyRef.current = modify
      mapInstance.current?.addInteraction(modify)
    } catch { setError('Error calculando área por barrio') }
    finally { setBuscando(false) }
  }

  const cargarShapefile = async (file) => {
    setBuscando(true)
    try {
      const shp = await import('shpjs')
      const gj  = await shp.default(await file.arrayBuffer())
      const geom = gj.features?.[0]?.geometry || gj.geometry
      if (geom) { setAreaGeojson(geom); mostrarAreaEnMapa(geom); await buscarPorPoligono(geom) }
    } catch { setError('Error leyendo el shapefile. El .zip debe contener .shp, .dbf y .shx') }
    finally { setBuscando(false) }
  }

  const handleCrear = async () => {
    if (!nombre.trim() || !resultado || !areaGeojson) return
    setCreando(true)
    try {
      const { data } = await api.post('/calidad-externa/', {
        nombre, descripcion,
        area_geojson:     areaGeojson,
        id_operaciones:   resultado.id_operaciones,
        muestra_calculada: resultado.muestra_calculada
      })
      onCreado()
      onClose()
      navigate(`/calidad-externa/${data.id}`)
    } catch (e) {
      setError(getErrorMessage(e, 'Error al crear el proyecto'))
    } finally {
      setCreando(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{ sx: { height: '90vh' } }}
      TransitionProps={{ onEntered: initMap }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TravelExploreIcon color="warning" />
          <Typography variant="h6" fontWeight={600}>
            Nuevo proyecto de calidad externa
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, display: 'flex', overflow: 'hidden' }}>

        {/* Panel izquierdo */}
        <Box sx={{
          width: 300, flexShrink: 0,
          borderRight: '1px solid', borderColor: 'divider',
          display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}>
          <Tabs value={metodo} onChange={(_, v) => setMetodo(v)}
            variant="scrollable"
            sx={{ borderBottom: '1px solid', borderColor: 'divider', minHeight: 40 }}
          >
            {METODOS.map(m => (
              <Tab key={m.key} icon={m.icon} iconPosition="start" label={m.label}
                sx={{ minWidth: 60, fontSize: '0.7rem', minHeight: 40 }} />
            ))}
          </Tabs>

          <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
            {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>{error}</Alert>}

            {/* Dibujar */}
            {METODOS[metodo].key === 'poligono' && (
              <Stack spacing={1}>
                <Alert severity="info" sx={{ fontSize: '0.75rem' }}>
                  Dibuja el área en el mapa. Doble clic para terminar.
                </Alert>
                {resultado && (
                  <Button size="small" variant="outlined" color="warning" onClick={limpiarMapa}>
                    Limpiar y redibujar
                  </Button>
                )}
              </Stack>
            )}

            {/* Manzanas */}
            {METODOS[metodo].key === 'manzanas' && (
              <Stack spacing={1}>
                <Autocomplete size="small" options={opcionesManzana}
                  getOptionLabel={o => o.codigo} loading={buscandoManzana}
                  onInputChange={(_, v) => buscarManzanas(v)}
                  onChange={(_, v) => {
                    if (v && !manzanasSelected.find(m => m.codigo === v.codigo))
                      setManzanasSelected(prev => [...prev, v])
                  }}
                  renderInput={params => <TextField {...params} label="Buscar manzana (mín 4)" size="small" />}
                />
                {manzanasSelected.length > 0 && (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap">
                    {manzanasSelected.map(m => (
                      <Chip key={m.codigo} label={m.codigo} size="small"
                        onDelete={() => setManzanasSelected(prev => prev.filter(x => x.codigo !== m.codigo))}
                      />
                    ))}
                  </Stack>
                )}
                <Button size="small" variant="outlined" color="warning"
                  disabled={!manzanasSelected.length || buscando}
                  onClick={calcularPorManzanas}
                >
                  Calcular área y predios
                </Button>
              </Stack>
            )}

            {/* Barrio */}
            {METODOS[metodo].key === 'barrio' && (
              <Stack spacing={1}>
                <Autocomplete size="small" options={barrios} getOptionLabel={b => b}
                  onChange={(_, v) => calcularPorBarrio(v)}
                  renderInput={params => <TextField {...params} label="Seleccionar barrio" size="small" />}
                />
                {resultado && (
                  <Alert severity="info" sx={{ fontSize: '0.75rem' }}>
                    Puedes editar el área en el mapa.
                  </Alert>
                )}
              </Stack>
            )}

            {/* Shapefile */}
            {METODOS[metodo].key === 'shapefile' && (
              <Stack spacing={1}>
                <Button variant="outlined" component="label" fullWidth size="small" disabled={buscando}>
                  {buscando ? <CircularProgress size={16} /> : 'Seleccionar .zip'}
                  <input type="file" accept=".zip" hidden
                    onChange={e => e.target.files[0] && cargarShapefile(e.target.files[0])}
                  />
                </Button>
                <Typography variant="caption" color="text.secondary">
                  El .zip debe contener .shp, .dbf y .shx
                </Typography>
              </Stack>
            )}

            {buscando && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <CircularProgress size={24} />
              </Box>
            )}

            {/* Resultado */}
            {!buscando && resultado && (
              <Box sx={{ mt: 1.5 }}>
                <Divider sx={{ mb: 1.5 }} />
                <Stack spacing={1}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" color="text.secondary">Predios</Typography>
                    <Typography variant="caption" fontWeight={700} color="warning.main">
                      {resultado.total_predios}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">Muestra</Typography>
                      <Tooltip title="IC 95%, e=5%">
                        <InfoOutlinedIcon sx={{ fontSize: 14, cursor: 'help' }} color="action" />
                      </Tooltip>
                    </Box>
                    <Chip label={resultado.muestra_calculada} size="small"
                      color="warning" icon={<ShuffleIcon />} />
                  </Box>
                  <Button size="small" variant="outlined" startIcon={<ListIcon />}
                    onClick={() => setDrawerOpen(true)}
                  >
                    Ver predios
                  </Button>
                  <Divider />
                  <TextField size="small" fullWidth label="Nombre *"
                    value={nombre} onChange={e => setNombre(e.target.value)}
                  />
                  <TextField size="small" fullWidth multiline rows={2}
                    label="Descripción"
                    value={descripcion} onChange={e => setDescripcion(e.target.value)}
                  />
                </Stack>
              </Box>
            )}
          </Box>
        </Box>

        {/* Mapa */}
        <Box sx={{ flex: 1, position: 'relative' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          {/* Leyenda */}
          <Box sx={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 1000,
            bgcolor: 'background.paper', borderRadius: 1, p: 1,
            border: '1px solid', borderColor: 'divider'
          }}>
            {[
              { label: 'Área',    fill: 'rgba(255,152,0,0.15)', stroke: '#F57C00', dash: true },
              { label: 'Predios', fill: 'rgba(200,200,200,0.4)', stroke: '#888',   dash: false }
            ].map(({ label, fill, stroke, dash }) => (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: 0.5,
                  bgcolor: fill, border: `2px ${dash ? 'dashed' : 'solid'} ${stroke}` }} />
                <Typography variant="caption">{label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>

      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={creando}>Cancelar</Button>
        <Button
          variant="contained" color="warning"
          onClick={handleCrear}
          disabled={creando || !nombre.trim() || !resultado}
          startIcon={creando
            ? <CircularProgress size={18} color="inherit" />
            : <TravelExploreIcon />
          }
        >
          {creando ? 'Creando...' : 'Crear proyecto de calidad'}
        </Button>
      </DialogActions>

      {/* Drawer lista predios */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>
            Predios ({resultado?.total_predios || 0})
          </Typography>
          <DataGrid
            rows={(resultado?.id_operaciones || []).map((id, i) => ({ id: i, id_operacion: id }))}
            columns={[{ field: 'id_operacion', headerName: 'ID Operación', flex: 1 }]}
            autoHeight
            pageSizeOptions={[25]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          />
        </Box>
      </Drawer>
    </Dialog>
  )
}

// ── Página principal ─────────────────────────────────────────────────────────
export default function CalidadExterna() {
  const navigate = useNavigate()
  const [proyectos,    setProyectos]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [modalAbierto, setModalAbierto] = useState(false)

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
          onClick={() => setModalAbierto(true)}
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

      <ModalCrear
        open={modalAbierto}
        onClose={() => setModalAbierto(false)}
        onCreado={cargar}
      />
    </Box>
  )
}
