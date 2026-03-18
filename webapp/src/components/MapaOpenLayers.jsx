import { useEffect, useRef } from 'react'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import OSM from 'ol/source/OSM'
import GeoJSON from 'ol/format/GeoJSON'
import { Style, Fill, Stroke } from 'ol/style'
import { fromLonLat } from 'ol/proj'
import 'ol/ol.css'

// Colores por estado del predio
const estilosPorEstado = {
  sin_asignar: new Style({
    fill:   new Fill({ color: 'rgba(200,200,200,0.4)' }),
    stroke: new Stroke({ color: '#888', width: 1 })
  }),
  campo: new Style({
    fill:   new Fill({ color: 'rgba(255,152,0,0.4)' }),
    stroke: new Stroke({ color: '#F57C00', width: 1.5 })
  }),
  validacion: new Style({
    fill:   new Fill({ color: 'rgba(33,150,243,0.4)' }),
    stroke: new Stroke({ color: '#1565C0', width: 1.5 })
  }),
  completado: new Style({
    fill:   new Fill({ color: 'rgba(76,175,80,0.4)' }),
    stroke: new Stroke({ color: '#2E7D32', width: 1.5 })
  }),
  rechazado: new Style({
    fill:   new Fill({ color: 'rgba(244,67,54,0.4)' }),
    stroke: new Stroke({ color: '#C62828', width: 1.5 })
  }),
  seleccionado: new Style({
    fill:   new Fill({ color: 'rgba(156,39,176,0.5)' }),
    stroke: new Stroke({ color: '#6A1B9A', width: 3 })
  })
}

export default function MapaOpenLayers({
  geojsonData,
  onSelectFeature,
  prediosSeleccionados = [],
  height = '500px'
}) {
  const mapRef      = useRef(null)
  const mapInstance = useRef(null)
  const vectorLayer = useRef(null)

  // Inicializar mapa
  useEffect(() => {
    const source = new VectorSource()

    vectorLayer.current = new VectorLayer({
      source,
      style: (feature) => {
        const id     = feature.get('id_operacion')
        const estado = feature.get('estado') || 'sin_asignar'
        if (prediosSeleccionados.includes(id)) {
          return estilosPorEstado.seleccionado
        }
        return estilosPorEstado[estado] || estilosPorEstado.sin_asignar
      }
    })

    mapInstance.current = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        vectorLayer.current
      ],
      view: new View({
        center: fromLonLat([-74.09, 4.71]), // Colombia por defecto
        zoom: 12
      })
    })

    // Click en feature
    mapInstance.current.on('click', (event) => {
      const features = []
      mapInstance.current.forEachFeatureAtPixel(event.pixel, (f) => features.push(f))
      if (features.length > 0 && onSelectFeature) {
        onSelectFeature(features[0].getProperties())
      }
    })

    // Cursor pointer al pasar por feature
    mapInstance.current.on('pointermove', (event) => {
      const hit = mapInstance.current.hasFeatureAtPixel(event.pixel)
      mapInstance.current.getTargetElement().style.cursor = hit ? 'pointer' : ''
    })

    return () => mapInstance.current.setTarget(null)
  }, [])

  // Cargar GeoJSON cuando cambian los datos
  useEffect(() => {
    if (!geojsonData || !vectorLayer.current) return
    const source = vectorLayer.current.getSource()
    source.clear()

    const features = new GeoJSON().readFeatures(geojsonData, {
      featureProjection: 'EPSG:3857'
    })
    source.addFeatures(features)

    // Zoom automático a los features
    if (features.length > 0) {
      mapInstance.current.getView().fit(source.getExtent(), {
        padding: [40, 40, 40, 40],
        maxZoom: 16
      })
    }
  }, [geojsonData])

  // Actualizar estilos cuando cambia selección
  useEffect(() => {
    if (vectorLayer.current) {
      vectorLayer.current.changed()
    }
  }, [prediosSeleccionados])

  return (
    <div style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}