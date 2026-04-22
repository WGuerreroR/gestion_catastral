import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Alert, CircularProgress,
  Stack, TextField, Autocomplete, Divider
} from '@mui/material'
import Map          from 'ol/Map'
import View         from 'ol/View'
import TileLayer    from 'ol/layer/Tile'
import VectorLayer  from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import OSM         from 'ol/source/OSM'
import Draw        from 'ol/interaction/Draw'
import { defaults as defaultInteractions } from 'ol/interaction'
import GeoJSON     from 'ol/format/GeoJSON'
import { Style, Fill, Stroke } from 'ol/style'
import { fromLonLat } from 'ol/proj'
import 'ol/ol.css'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'

const estiloPoligono = new Style({
  fill:   new Fill({ color: 'rgba(33,150,243,0.15)' }),
  stroke: new Stroke({ color: '#1565C0', width: 2, lineDash: [6, 3] })
})

const estiloManzana = new Style({
  fill:   new Fill({ color: 'rgba(255,152,0,0.15)' }),
  stroke: new Stroke({ color: '#F57C00', width: 2, lineDash: [6, 3] })
})

const estiloPredio = new Style({
  fill:   new Fill({ color: 'rgba(76,175,80,0.35)' }),
  stroke: new Stroke({ color: '#2E7D32', width: 1.5 })
})

export default function ModalMapaAsignacion({
  open, onClose, metodo, proyecto, onAsignar
}) {
  const mapRef          = useRef(null)
  const mapInstance     = useRef(null)
  const areaLayer       = useRef(null)
  const prediosLayer    = useRef(null)
  const drawInteraction = useRef(null)

  const [predios,         setPredios]         = useState([])
  const [loadingPreview,  setLoadingPreview]  = useState(false)
  const [loadingAsignar,  setLoadingAsignar]  = useState(false)
  const [error,           setError]           = useState('')
  const [geojsonDibujado, setGeojsonDibujado] = useState(null)
  const [drawActivo,      setDrawActivo]      = useState(false)

  // Manzana
  const [opciones,            setOpciones]            = useState([])
  const [manzanaSeleccionada, setManzanaSeleccionada] = useState(null)
  const [buscando,            setBuscando]            = useState(false)

  // ── Crear una instancia FRESCA de Draw cada vez ──────────────────────────
  // Reciclar la misma Draw entre sesiones dejaba estado residual de eventos
  // que causaba que el mapa siguiera el cursor tras terminar un polígono.
  // Ahora: cada vez que se empieza una sesión nueva se crea una Draw nueva;
  // cuando se termina/cancela se remueve + dispose.
  const crearNuevaDraw = () => {
    if (!mapInstance.current || !areaLayer.current) return

    const draw = new Draw({
      source: areaLayer.current.getSource(),
      type:   'Polygon',
    })

    draw.on('drawend', async (e) => {
      areaLayer.current.getSource().clear()
      areaLayer.current.getSource().addFeature(e.feature)

      const gj = new GeoJSON().writeFeatureObject(e.feature, {
        featureProjection: 'EPSG:3857',
        dataProjection:    'EPSG:4326'
      })
      setGeojsonDibujado(gj.geometry)

      // Remover la Draw, descartarla y liberar listeners
      setTimeout(() => {
        mapInstance.current?.removeInteraction(draw)
        draw.dispose()
        if (drawInteraction.current === draw) drawInteraction.current = null
        setDrawActivo(false)
      }, 0)

      await buscarPorPoligono(gj.geometry)
    })

    mapInstance.current.addInteraction(draw)
    drawInteraction.current = draw
    setDrawActivo(true)
  }

  // ── Inicializar mapa ─────────────────────────────────────────────────────
  // KEY FIX: El Dialog de MUI tiene una animación de entrada. Aunque `open`
  // sea true, el div del mapa puede tener height:0 durante la animación.
  // Usamos TransitionProps.onEntered (que se llama cuando el dialog terminó
  // de abrirse y el contenido ya tiene dimensiones reales) para inicializar OL.
  const initMap = useCallback(() => {
    if (!mapRef.current || mapInstance.current) return

    const areaSource    = new VectorSource()
    const prediosSource = new VectorSource()

    areaLayer.current = new VectorLayer({
      source: areaSource,
      style:  estiloPoligono
    })

    prediosLayer.current = new VectorLayer({
      source: prediosSource,
      style:  estiloPredio
    })

    mapInstance.current = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        areaLayer.current,
        prediosLayer.current
      ],
      // Desactivamos DoubleClickZoom para que el doble-click que cierra el
      // polígono no haga zoom al mismo tiempo.
      interactions: defaultInteractions({ doubleClickZoom: false }),
      view: new View({
        center: fromLonLat([-73.8176, 5.6044]),
        zoom:   14
      })
    })

    mapInstance.current.updateSize()

    if (metodo === 'poligono') {
      crearNuevaDraw()
    }
  }, [metodo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reactivar el dibujo: crear una Draw fresca
  const reactivarDibujo = () => {
    if (!mapInstance.current) return
    areaLayer.current?.getSource().clear()
    prediosLayer.current?.getSource().clear()
    setPredios([])
    setGeojsonDibujado(null)
    crearNuevaDraw()
  }

  // Destruir mapa al cerrar
  useEffect(() => {
    if (!open) {
      if (mapInstance.current) {
        mapInstance.current.setTarget(null)
        mapInstance.current = null
      }
      drawInteraction.current = null
    }
  }, [open])

  const buscarPorPoligono = async (geojson) => {
    setLoadingPreview(true)
    setError('')
    try {
      const { data } = await api.post('/spatial/buscar-por-poligono', { geojson })
      setPredios(data.predios)
      mostrarPrediosEnMapa(data.predios)
    } catch (e) {
      setError(getErrorMessage(e, 'Error buscando predios'))
    } finally {
      setLoadingPreview(false)
    }
  }

  const buscarManzanas = async (valor) => {
    if (valor.length < 6) return
    setBuscando(true)
    try {
      const { data } = await api.get(`/spatial/manzanas/${valor}`)
      setOpciones(data)
    } catch {
      setError('Error buscando manzanas')
    } finally {
      setBuscando(false)
    }
  }

  const seleccionarManzana = async (manzana) => {
    if (!manzana) return
    setManzanaSeleccionada(manzana)
    setLoadingPreview(true)
    setError('')
    try {
      const { data } = await api.get(`/spatial/buscar-por-manzana/${manzana.codigo}`)
      setPredios(data.predios)
      mostrarPrediosEnMapa(data.predios)

      if (data.manzana?.geom) {
        const f = new GeoJSON().readFeature(
          { type: 'Feature', geometry: data.manzana.geom },
          { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' }
        )
        f.setStyle(estiloManzana)
        areaLayer.current.getSource().clear()
        areaLayer.current.getSource().addFeature(f)

        mapInstance.current?.getView().fit(
          areaLayer.current.getSource().getExtent(),
          { padding: [60, 60, 60, 60], maxZoom: 18 }
        )
      }
    } catch (e) {
      setError(getErrorMessage(e, 'Error cargando manzana'))
    } finally {
      setLoadingPreview(false)
    }
  }

  const cargarShapefile = async (file) => {
    setLoadingPreview(true)
    setError('')
    try {
      const shp = await import('shpjs')
      const geojson = await shp.default(await file.arrayBuffer())

      const features = new GeoJSON().readFeatures(geojson, {
        featureProjection: 'EPSG:3857',
        dataProjection:    'EPSG:4326'
      })
      areaLayer.current.getSource().clear()
      areaLayer.current.getSource().addFeatures(features)

      const primerGeom = geojson.features?.[0]?.geometry || geojson.geometry
      if (primerGeom) {
        setGeojsonDibujado(primerGeom)
        await buscarPorPoligono(primerGeom)
      }

      mapInstance.current?.getView().fit(
        areaLayer.current.getSource().getExtent(),
        { padding: [40, 40, 40, 40], maxZoom: 16 }
      )
    } catch {
      setError('Error leyendo el shapefile. Sube un .zip con .shp, .dbf y .shx')
    } finally {
      setLoadingPreview(false)
    }
  }

  const mostrarPrediosEnMapa = (lista) => {
    if (!prediosLayer.current) return
    const source = prediosLayer.current.getSource()
    source.clear()
    lista.forEach(p => {
      if (!p.geom) return
      const f = new GeoJSON().readFeature(
        { type: 'Feature', geometry: p.geom, properties: p },
        { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' }
      )
      source.addFeature(f)
    })
    if (source.getFeatures().length > 0) {
      mapInstance.current?.getView().fit(source.getExtent(), {
        padding: [40, 40, 40, 40], maxZoom: 18
      })
    }
  }

  const handleAsignar = async () => {
    if (predios.length === 0) return
    setLoadingAsignar(true)
    setError('')
    try {
      const body = {
        proyecto_id:     proyecto.id,
        persona_id:      proyecto.responsable_id,
        id_operaciones:  predios.map(p => p.id_operacion),
        tipo_asignacion: metodo === 'manzana' ? 'alfanumerica' : 'espacial',
        geojson:         geojsonDibujado || null,
        codigo_manzana:  manzanaSeleccionada?.codigo || null
      }
      const { data } = await api.post('/proyectos/confirmar-asignacion', body)
      onAsignar(data.insertados)
      handleCerrar()
    } catch (e) {
      setError(getErrorMessage(e, 'Error al asignar predios'))
    } finally {
      setLoadingAsignar(false)
    }
  }

  const handleCerrar = () => {
    setPredios([])
    setGeojsonDibujado(null)
    setManzanaSeleccionada(null)
    setOpciones([])
    setError('')
    setDrawActivo(false)
    onClose()
  }

  const titulo = {
    poligono:  'Dibujar polígono',
    shapefile: 'Cargar shapefile',
    manzana:   'Código de manzana'
  }

  return (
    // TransitionProps.onEntered se dispara cuando el dialog terminó su
    // animación de apertura y el contenido tiene dimensiones reales.
    // Es el momento seguro para inicializar OpenLayers.
    <Dialog
      open={open}
      onClose={handleCerrar}
      maxWidth="lg"
      fullWidth
      TransitionProps={{ onEntered: initMap }}
    >
      <DialogTitle>
        Asignar predios — {proyecto?.clave_proyecto} ({titulo[metodo]})
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ display: 'flex', height: 580 }}>

          {/* Panel izquierdo */}
          <Box sx={{
            width: 300, p: 2,
            borderRight: '1px solid',
            borderColor: 'divider',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}>

            {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

            {/* Método manzana */}
            {metodo === 'manzana' && (
              <Box>
                <Typography variant="subtitle2" fontWeight={600} mb={1}>
                  Buscar manzana
                </Typography>
                <Autocomplete
                  options={opciones}
                  getOptionLabel={o => o.codigo}
                  loading={buscando}
                  onInputChange={(_, v) => buscarManzanas(v)}
                  onChange={(_, v) => seleccionarManzana(v)}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label="Código de manzana"
                      size="small"
                      helperText="Mínimo 6 caracteres"
                    />
                  )}
                  renderOption={(props, o) => (
                    <Box component="li" {...props}>
                      <Box>
                        <Typography variant="body2">{o.codigo}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Barrio: {o.barrio_cod}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                />
              </Box>
            )}

            {/* Método shapefile */}
            {metodo === 'shapefile' && (
              <Box>
                <Typography variant="subtitle2" fontWeight={600} mb={1}>
                  Cargar shapefile
                </Typography>
                <Button
                  variant="outlined"
                  component="label"
                  fullWidth
                  disabled={loadingPreview}
                >
                  {loadingPreview ? <CircularProgress size={18} /> : 'Seleccionar archivo .zip'}
                  <input
                    type="file"
                    accept=".zip"
                    hidden
                    onChange={e => e.target.files[0] && cargarShapefile(e.target.files[0])}
                  />
                </Button>
                <Typography variant="caption" color="text.secondary">
                  El .zip debe contener .shp, .dbf y .shx
                </Typography>
              </Box>
            )}

            {/* Método polígono */}
            {metodo === 'poligono' && (
              <>
                <Alert severity="info">
                  Haz clic para agregar puntos y luego pulsá <strong>Terminar polígono</strong>
                  (o <strong>doble clic</strong> en el último punto). Clic derecho cancela.
                </Alert>
                {drawActivo && (
                  <Button
                    variant="contained"
                    color="success"
                    onClick={() => drawInteraction.current?.finishDrawing()}
                  >
                    Terminar polígono
                  </Button>
                )}
                {!drawActivo && (
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={reactivarDibujo}
                  >
                    Dibujar nuevo polígono
                  </Button>
                )}
              </>
            )}

            {/* Loading */}
            {loadingPreview && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <CircularProgress size={28} />
              </Box>
            )}

            {/* Resultado */}
            {!loadingPreview && predios.length > 0 && (
              <Box>
                <Divider sx={{ my: 1 }} />
                <Alert severity="success" sx={{ mb: 1.5 }}>
                  <strong>{predios.length}</strong> predios encontrados
                </Alert>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Responsable
                </Typography>
                <Typography variant="body2" fontWeight={500} mb={1.5}>
                  {proyecto?.responsable}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Primeros predios
                </Typography>
                <Stack spacing={0.5} sx={{ maxHeight: 220, overflow: 'auto' }}>
                  {predios.slice(0, 15).map(p => (
                    <Box
                      key={p.id_operacion}
                      sx={{ p: 0.75, bgcolor: 'background.default', borderRadius: 1 }}
                    >
                      <Typography variant="caption" fontWeight={600} display="block">
                        {p.npn_etiqueta || p.npn}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {p.nombre_predio || 'Sin nombre'}
                      </Typography>
                    </Box>
                  ))}
                  {predios.length > 15 && (
                    <Typography variant="caption" color="text.secondary" textAlign="center">
                      ... y {predios.length - 15} predios más
                    </Typography>
                  )}
                </Stack>

                <Button
                  size="small"
                  color="warning"
                  variant="outlined"
                  fullWidth
                  sx={{ mt: 1 }}
                  onClick={() => {
                    setPredios([])
                    setGeojsonDibujado(null)
                    setManzanaSeleccionada(null)
                    areaLayer.current?.getSource().clear()
                    prediosLayer.current?.getSource().clear()
                  }}
                >
                  Limpiar y volver a buscar
                </Button>
              </Box>
            )}
          </Box>

          {/* Mapa */}
          <Box sx={{ flexGrow: 1 }}>
            <div
              ref={mapRef}
              style={{ width: '100%', height: '100%' }}
              onContextMenu={(e) => {
                // Click derecho: cancela el dibujo actual, descarta la
                // instancia completa (remove + dispose) y limpia estado.
                // Para dibujar de nuevo pulsar "Dibujar nuevo polígono".
                if (drawInteraction.current && drawActivo) {
                  e.preventDefault()
                  const draw = drawInteraction.current
                  draw.abortDrawing()
                  mapInstance.current?.removeInteraction(draw)
                  draw.dispose()
                  drawInteraction.current = null
                  setDrawActivo(false)
                  areaLayer.current?.getSource().clear()
                  prediosLayer.current?.getSource().clear()
                  setPredios([])
                  setGeojsonDibujado(null)
                }
              }}
            />
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleCerrar} disabled={loadingAsignar}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={handleAsignar}
          disabled={predios.length === 0 || loadingAsignar}
        >
          {loadingAsignar
            ? <CircularProgress size={20} color="inherit" />
            : `Asignar ${predios.length} predios`
          }
        </Button>
      </DialogActions>
    </Dialog>
  )
}
