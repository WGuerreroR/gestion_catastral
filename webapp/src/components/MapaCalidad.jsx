/**
 * MapaCalidad.jsx
 * Componente reutilizable para mostrar predios de calidad en OpenLayers.
 * Maneja dos capas: universo (gris) y muestra (azul).
 * Opcionalmente muestra el área del proyecto (naranja punteado).
 *
 * Props:
 *   geojson      : GeoJSON FeatureCollection con propiedad en_muestra
 *   areaGeojson  : GeoJSON Geometry del área del proyecto (opcional)
 *   height       : altura del mapa en px (default 500)
 *   onClickPredioo: callback(properties) al hacer click en un predio
 */
import { useEffect, useRef } from 'react'
import OlMap        from 'ol/Map'
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

// ── Colores estándar del módulo de calidad ────────────────────────────────────
const COLORES = {
  universo: { fill: 'rgba(200,200,200,0.4)', stroke: '#888',    width: 1.5 },
  muestra:  { fill: 'rgba(33,150,243,0.7)',  stroke: '#1565C0', width: 2.5 },
  area:     { fill: 'rgba(255,152,0,0.08)',  stroke: '#F57C00', width: 2,
              lineDash: [8, 4] }
}

function estiloPredioPorMuestra(enMuestra) {
  const c = enMuestra ? COLORES.muestra : COLORES.universo
  return new Style({
    fill:   new Fill({ color: c.fill }),
    stroke: new Stroke({ color: c.stroke, width: c.width })
  })
}

const estiloArea = new Style({
  fill:   new Fill({ color: COLORES.area.fill }),
  stroke: new Stroke({
    color:    COLORES.area.stroke,
    width:    COLORES.area.width,
    lineDash: COLORES.area.lineDash
  })
})

export default function MapaCalidad({
  geojson,
  areaGeojson,
  height = 500,
  onClickPredioo
}) {
  const mapRef       = useRef(null)
  const mapInstance  = useRef(null)
  const prediosLayer = useRef(null)
  const areaLayer    = useRef(null)

  // ── Inicializar mapa una sola vez ─────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    prediosLayer.current = new VectorLayer({
      source: new VectorSource(),
      style:  (f) => estiloPredioPorMuestra(f.get('en_muestra')),
      zIndex: 2
    })

    areaLayer.current = new VectorLayer({
      source: new VectorSource(),
      style:  estiloArea,
      zIndex: 1
    })

    mapInstance.current = new OlMap({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        areaLayer.current,
        prediosLayer.current
      ],
      view: new View({
        center: fromLonLat([-74.09, 4.71]),
        zoom:   13
      })
    })

    // Click en predio
    if (onClickPredioo) {
      const selectInteraction = new Select({ condition: click })
      selectInteraction.on('select', (e) => {
        if (e.selected.length > 0) {
          const props = e.selected[0].getProperties()
          if (props.id_operacion) onClickPredioo(props)
        }
      })
      mapInstance.current.addInteraction(selectInteraction)
    }

    mapInstance.current.on('pointermove', (e) => {
      const hit = mapInstance.current.hasFeatureAtPixel(e.pixel)
      mapInstance.current.getTargetElement().style.cursor = hit ? 'pointer' : ''
    })

    return () => {
      if (mapInstance.current) {
        mapInstance.current.setTarget(null)
        mapInstance.current = null
      }
    }
  }, [])

  // ── Actualizar predios cuando cambia el GeoJSON ───────────────────────────
  useEffect(() => {
    if (!mapInstance.current || !geojson) return

    const source = prediosLayer.current.getSource()
    source.clear()

    const features = new GeoJSON().readFeatures(geojson, {
      featureProjection: 'EPSG:3857',
      dataProjection:    'EPSG:4326'
    })
    source.addFeatures(features)

    if (features.length > 0) {
      mapInstance.current.updateSize()
      mapInstance.current.getView().fit(source.getExtent(), {
        padding: [40, 40, 40, 40], maxZoom: 18
      })
    }
  }, [geojson])

  // ── Actualizar área del proyecto ──────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current || !areaGeojson) return

    const source = areaLayer.current.getSource()
    source.clear()

    const feature = new GeoJSON().readFeature(
      { type: 'Feature', geometry: areaGeojson },
      { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' }
    )
    source.addFeature(feature)
  }, [areaGeojson])

  return (
    <div ref={mapRef} style={{ width: '100%', height: `${height}px` }} />
  )
}

// Exportar colores para usar en leyendas
export { COLORES }
