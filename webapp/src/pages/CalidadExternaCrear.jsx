import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box, Typography, Button, Card, CardContent, Chip,
  Alert, CircularProgress, Stack, Divider, TextField,
  Tab, Tabs, Autocomplete, IconButton, Drawer,
  Tooltip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import ArrowBackIcon     from '@mui/icons-material/ArrowBack'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import EditIcon          from '@mui/icons-material/Edit'
import HomeWorkIcon      from '@mui/icons-material/HomeWork'
import LocationCityIcon  from '@mui/icons-material/LocationCity'
import UploadFileIcon    from '@mui/icons-material/UploadFile'
import ShuffleIcon       from '@mui/icons-material/Shuffle'
import InfoOutlinedIcon  from '@mui/icons-material/InfoOutlined'
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

const MAP_HEIGHT = 'calc(100vh - 200px)'

function calcularMuestra(n) {
  if (n <= 0) return 0
  const Z = 1.96, p = 0.5, q = 0.5, e = 0.05
  return Math.max(1, Math.ceil((n * Z * Z * p * q) / (e * e * (n - 1) + Z * Z * p * q)))
}

// Estilos capas
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

export default function CalidadExternaCrear() {
  const navigate = useNavigate()
  const mapRef      = useRef(null)
  const mapInstance = useRef(null)
  const areaLayer   = useRef(null)
  const prediosLayer= useRef(null)
  const drawRef     = useRef(null)
  const modifyRef   = useRef(null)

  const [metodo,          setMetodo]          = useState(0)
  const [resultado,       setResultado]       = useState(null)  // { total_predios, muestra_calculada, id_operaciones, geojson_predios, hull_geojson }
  const [areaGeojson,     setAreaGeojson]     = useState(null)  // geometría del área dibujada
  const [nombre,          setNombre]          = useState('')
  const [descripcion,     setDescripcion]     = useState('')
  const [creando,         setCreando]         = useState(false)
  const [buscando,        setBuscando]        = useState(false)
  const [error,           setError]           = useState('')
  const [drawerOpen,      setDrawerOpen]      = useState(false)

  // Manzanas
  const [opcionesManzana,   setOpcionesManzana]   = useState([])
  const [manzanasSelected,  setManzanasSelected]  = useState([])
  const [buscandoManzana,   setBuscandoManzana]   = useState(false)

  // Barrio
  const [barrios,        setBarrios]        = useState([])
  const [barrioSelected, setBarrioSelected] = useState(null)

  // ── Inicializar mapa ────────────────────────────────────────────────────────
  useEffect(() => {
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

    return () => {
      if (mapInstance.current) {
        mapInstance.current.setTarget(null)
        mapInstance.current = null
      }
    }
  }, [])

  // ── Activar/desactivar interacciones según método ────────────────────────
  useEffect(() => {
    if (!mapInstance.current) return

    // Limpiar interacciones previas
    if (drawRef.current)   mapInstance.current.removeInteraction(drawRef.current)
    if (modifyRef.current) mapInstance.current.removeInteraction(modifyRef.current)
    drawRef.current   = null
    modifyRef.current = null

    const metodoKey = METODOS[metodo].key

    if (metodoKey === 'poligono') {
      const draw = new Draw({
        source: areaLayer.current.getSource(),
        type:   'Polygon'
      })
      draw.on('drawend', async (e) => {
        areaLayer.current.getSource().clear()
        areaLayer.current.getSource().addFeature(e.feature)

        const gj = new GeoJSON().writeFeatureObject(e.feature, {
          featureProjection: 'EPSG:3857',
          dataProjection:    'EPSG:4326'
        })
        setAreaGeojson(gj.geometry)
        await buscarPorPoligono(gj.geometry)
      })
      drawRef.current = draw
      mapInstance.current.addInteraction(draw)
    }

    if (metodoKey === 'barrio') {
      // Modify se activará cuando haya hull dibujado
    }
  }, [metodo])

  // ── Cargar barrios al abrir ese tab ──────────────────────────────────────
  useEffect(() => {
    if (METODOS[metodo].key === 'barrio' && barrios.length === 0) {
      api.get('/calidad-externa/barrios').then(({ data }) => setBarrios(data)).catch(() => {})
    }
  }, [metodo])

  const limpiar = () => {
    setResultado(null)
    setAreaGeojson(null)
    areaLayer.current?.getSource().clear()
    prediosLayer.current?.getSource().clear()
    if (modifyRef.current) {
      mapInstance.current?.removeInteraction(modifyRef.current)
      modifyRef.current = null
    }
  }

  const mostrarPrediosEnMapa = (geojsonPredios) => {
    if (!prediosLayer.current || !geojsonPredios) return
    const source = prediosLayer.current.getSource()
    source.clear()
    const features = new GeoJSON().readFeatures(geojsonPredios, {
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

  // ── Búsquedas ─────────────────────────────────────────────────────────────
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
    } catch {} finally {
      setBuscandoManzana(false)
    }
  }

  const calcularPorManzanas = async () => {
    if (manzanasSelected.length === 0) return
    setBuscando(true)
    setError('')
    try {
      const { data } = await api.post('/calidad-externa/predios-por-manzanas', {
        codigos_manzana: manzanasSelected.map(m => m.codigo)
      })
      setResultado(data)
      setAreaGeojson(data.hull_geojson)
      mostrarAreaEnMapa(data.hull_geojson)
      mostrarPrediosEnMapa(data.geojson_predios)

      // Activar Modify sobre el hull para edición
      if (data.hull_geojson && modifyRef.current === null) {
        const modify = new Modify({ source: areaLayer.current.getSource() })
        modifyRef.current = modify
        mapInstance.current?.addInteraction(modify)
      }
    } catch {
      setError('Error calculando área por manzanas')
    } finally {
      setBuscando(false)
    }
  }

  const calcularPorBarrio = async (barrio) => {
    if (!barrio) return
    setBarrioSelected(barrio)
    setBuscando(true)
    setError('')
    try {
      const { data } = await api.post('/calidad-externa/predios-por-barrio', { barrio_cod: barrio })
      setResultado(data)
      setAreaGeojson(data.hull_geojson)
      mostrarAreaEnMapa(data.hull_geojson)
      mostrarPrediosEnMapa(data.geojson_predios)

      // Hull editable
      if (data.hull_geojson) {
        if (modifyRef.current) mapInstance.current?.removeInteraction(modifyRef.current)
        const modify = new Modify({ source: areaLayer.current.getSource() })
        modifyRef.current = modify
        mapInstance.current?.addInteraction(modify)
      }
    } catch {
      setError('Error calculando área por barrio')
    } finally {
      setBuscando(false)
    }
  }

  const cargarShapefile = async (file) => {
    setBuscando(true)
    setError('')
    try {
      const shp = await import('shpjs')
      const geojson = await shp.default(await file.arrayBuffer())
      const primerGeom = geojson.features?.[0]?.geometry || geojson.geometry
      if (primerGeom) {
        setAreaGeojson(primerGeom)
        mostrarAreaEnMapa(primerGeom)
        await buscarPorPoligono(primerGeom)
      }
    } catch {
      setError('Error leyendo el shapefile. El .zip debe contener .shp, .dbf y .shx')
    } finally {
      setBuscando(false)
    }
  }

  const handleCrear = async () => {
    if (!nombre.trim() || !resultado || !areaGeojson) return
    setCreando(true)
    try {
      const { data } = await api.post('/calidad-externa/', {
        nombre,
        descripcion,
        area_geojson:     areaGeojson,
        id_operaciones:   resultado.id_operaciones,
        muestra_calculada: resultado.muestra_calculada
      })
      navigate(`/calidad-externa/${data.id}`)
    } catch (e) {
      setError(getErrorMessage(e, 'Error al crear el proyecto'))
    } finally {
      setCreando(false)
    }
  }

  const columnasPredios = [
    { field: 'npn',          headerName: 'NPN',     width: 200 },
    { field: 'nombre_predio',headerName: 'Nombre',  flex: 1    },
    { field: 'municipio',    headerName: 'Municipio',width: 140 }
  ]

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* Panel izquierdo */}
      <Box sx={{
        width: 320, flexShrink: 0,
        borderRight: '1px solid', borderColor: 'divider',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header panel */}
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <IconButton size="small" onClick={() => navigate('/calidad-externa')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <TravelExploreIcon color="warning" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600}>Calidad Externa</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Define el área de evaluación
          </Typography>
        </Box>

        {/* Tabs método */}
        <Tabs
          value={metodo}
          onChange={(_, v) => { setMetodo(v); limpiar() }}
          variant="scrollable"
          sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
        >
          {METODOS.map((m, i) => (
            <Tab key={m.key} icon={m.icon} iconPosition="start" label={m.label}
              sx={{ minWidth: 70, fontSize: '0.75rem' }} />
          ))}
        </Tabs>

        {/* Contenido método */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

          {/* Dibujar */}
          {METODOS[metodo].key === 'poligono' && (
            <Stack spacing={1.5}>
              <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
                Haz clic en el mapa para dibujar el área. Doble clic para terminar.
              </Alert>
              {resultado && (
                <Button size="small" variant="outlined" color="warning" onClick={limpiar}>
                  Limpiar y redibujar
                </Button>
              )}
            </Stack>
          )}

          {/* Manzanas */}
          {METODOS[metodo].key === 'manzanas' && (
            <Stack spacing={1.5}>
              <Autocomplete
                size="small"
                options={opcionesManzana}
                getOptionLabel={o => o.codigo}
                loading={buscandoManzana}
                onInputChange={(_, v) => buscarManzanas(v)}
                onChange={(_, v) => {
                  if (v && !manzanasSelected.find(m => m.codigo === v.codigo)) {
                    setManzanasSelected(prev => [...prev, v])
                  }
                }}
                renderInput={params => (
                  <TextField {...params} label="Buscar manzana (mín 4 chars)" />
                )}
              />
              {manzanasSelected.length > 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    Seleccionadas:
                  </Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap">
                    {manzanasSelected.map(m => (
                      <Chip key={m.codigo} label={m.codigo} size="small"
                        onDelete={() => setManzanasSelected(prev => prev.filter(x => x.codigo !== m.codigo))}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
              <Button
                variant="outlined" color="warning" size="small"
                disabled={manzanasSelected.length === 0 || buscando}
                onClick={calcularPorManzanas}
                startIcon={buscando ? <CircularProgress size={14} /> : null}
              >
                Calcular área y predios
              </Button>
            </Stack>
          )}

          {/* Barrio */}
          {METODOS[metodo].key === 'barrio' && (
            <Stack spacing={1.5}>
              <Autocomplete
                size="small"
                options={barrios}
                getOptionLabel={b => b}
                onChange={(_, v) => calcularPorBarrio(v)}
                renderInput={params => <TextField {...params} label="Seleccionar barrio" />}
              />
              {resultado && (
                <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
                  Puedes editar el área resultante directamente en el mapa.
                </Alert>
              )}
            </Stack>
          )}

          {/* Shapefile */}
          {METODOS[metodo].key === 'shapefile' && (
            <Stack spacing={1.5}>
              <Button variant="outlined" component="label" fullWidth disabled={buscando}>
                {buscando ? <CircularProgress size={18} /> : 'Seleccionar archivo .zip'}
                <input type="file" accept=".zip" hidden
                  onChange={e => e.target.files[0] && cargarShapefile(e.target.files[0])}
                />
              </Button>
              <Typography variant="caption" color="text.secondary">
                El .zip debe contener .shp, .dbf y .shx
              </Typography>
            </Stack>
          )}

          {/* Loading */}
          {buscando && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <CircularProgress size={28} />
            </Box>
          )}

          {/* Resultado */}
          {!buscando && resultado && (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1.5}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">Predios encontrados</Typography>
                  <Typography variant="body2" fontWeight={700} color="warning.main">
                    {resultado.total_predios}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Muestra mínima</Typography>
                    <Tooltip title="n = (N·Z²·p·q) / (e²·(N-1) + Z²·p·q) — IC 95%, e=5%">
                      <InfoOutlinedIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
                    </Tooltip>
                  </Box>
                  <Chip label={resultado.muestra_calculada} size="small"
                    color="warning" icon={<ShuffleIcon />} />
                </Box>

                <Button size="small" variant="outlined" startIcon={<ListIcon />}
                  onClick={() => setDrawerOpen(true)}
                >
                  Ver lista de predios
                </Button>

                <Divider />

                <TextField size="small" fullWidth label="Nombre del proyecto *"
                  value={nombre} onChange={e => setNombre(e.target.value)}
                />
                <TextField size="small" fullWidth multiline rows={2}
                  label="Descripción (opcional)"
                  value={descripcion} onChange={e => setDescripcion(e.target.value)}
                />
                <Button
                  fullWidth variant="contained" color="warning"
                  onClick={handleCrear}
                  disabled={creando || !nombre.trim()}
                  startIcon={creando
                    ? <CircularProgress size={16} color="inherit" />
                    : <TravelExploreIcon />
                  }
                >
                  {creando ? 'Creando...' : 'Crear proyecto de calidad'}
                </Button>
              </Stack>
            </Box>
          )}
        </Box>
      </Box>

      {/* Mapa */}
      <Box sx={{ flex: 1, position: 'relative' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

        {/* Leyenda */}
        <Card sx={{ position: 'absolute', bottom: 16, left: 16, zIndex: 1000, p: 1.5 }}>
          <Typography variant="caption" fontWeight={600} display="block" mb={1}>Leyenda</Typography>
          {[
            { label: 'Área seleccionada', fill: 'rgba(255,152,0,0.15)', stroke: '#F57C00', dash: true },
            { label: 'Predios encontrados', fill: 'rgba(200,200,200,0.4)', stroke: '#888', dash: false }
          ].map(({ label, fill, stroke, dash }) => (
            <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Box sx={{
                width: 14, height: 14, borderRadius: 0.5,
                bgcolor: fill,
                border: `2px ${dash ? 'dashed' : 'solid'} ${stroke}`
              }} />
              <Typography variant="caption">{label}</Typography>
            </Box>
          ))}
        </Card>
      </Box>

      {/* Drawer lista predios */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 500, p: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>
            Predios encontrados ({resultado?.total_predios || 0})
          </Typography>
          <DataGrid
            rows={(resultado?.id_operaciones || []).map((id, i) => ({ id: i, id_operacion: id }))}
            columns={[{ field: 'id_operacion', headerName: 'ID Operación', flex: 1 }]}
            autoHeight
            pageSizeOptions={[25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          />
        </Box>
      </Drawer>

    </Box>
  )
}
