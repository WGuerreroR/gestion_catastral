/**
 * Sección tipo `mapa` del visor de predios.
 *
 * Muestra todas las geometrías relacionadas al predio en capas
 * separadas y superpuestas, dirigidas por el JSON `seccion.capas`.
 * Read-only en esta iteración (sin herramientas de dibujo).
 *
 * Capas:
 *   - `fuente: "predio_data"`  → extrae geometrías del payload del
 *     predio por `ruta_dato` (ej. "terreno.geometry",
 *     "unidades[].geometry"). Soporta colecciones con `[]`.
 *   - `fuente: "endpoint"`     → fetch a un endpoint con sustitución
 *     de tokens (ej. `{codigo_manzana}` derivado de
 *     numero_predial.slice(0,17)).
 *
 * Coordenadas del cursor: se reproyectan a EPSG:9377 (CTM12) usando
 * proj4 si así lo declara el JSON (`srid_display`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Stack, Typography, Chip, Alert, IconButton, Tooltip
} from '@mui/material'
import FullscreenIcon     from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'

import Map        from 'ol/Map'
import View       from 'ol/View'
import TileLayer  from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import OSM        from 'ol/source/OSM'
import GeoJSON    from 'ol/format/GeoJSON'
import { fromLonLat, transform } from 'ol/proj'
import { ScaleLine, defaults as defaultControls } from 'ol/control'
import 'ol/ol.css'

import api from '../../../api/axios'
import ControlCapas from './ControlCapas'
import { styleParaCapa, styleResaltadoParaCapa } from './EstilosMapa'
import { registrarEPSG9377 } from './proj9377'
import { useMapaPredioSync } from './useMapaPredioSync'


// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Resuelve un path tipo "terreno.geometry" o "unidades[].geometry"
 * sobre el payload del predio. Devuelve siempre un array de
 * `{ feature, propiedades }`, donde `feature` es la geometría GeoJSON.
 */
function extraerGeometrias(predioCompleto, capa) {
  if (!predioCompleto || !capa.ruta_dato) return []

  const partes = capa.ruta_dato.split('.')
  let cursores = [predioCompleto]
  let propsCursores = [predioCompleto]

  for (const parte of partes) {
    const esColeccion = parte.endsWith('[]')
    const key = esColeccion ? parte.slice(0, -2) : parte
    const siguientes = []
    const siguientesProps = []

    for (let i = 0; i < cursores.length; i++) {
      const actual = cursores[i]
      const propiedades = propsCursores[i]
      if (actual == null) continue
      const v = actual[key]
      if (v == null) continue

      if (esColeccion && Array.isArray(v)) {
        for (const item of v) {
          siguientes.push(item)
          siguientesProps.push(item)
        }
      } else if (Array.isArray(v)) {
        // Caso raro: la ruta no marcó [] pero el valor es array → tomar todos
        for (const item of v) {
          siguientes.push(item)
          siguientesProps.push(propiedades)
        }
      } else {
        siguientes.push(v)
        siguientesProps.push(propiedades)
      }
    }

    cursores = siguientes
    propsCursores = siguientesProps
  }

  // Al final, `cursores` debería contener objetos GeoJSON Geometry y
  // `propsCursores` las propiedades del item al que pertenecen. Sacamos
  // `geometry` del bag de propiedades para que no choque con la
  // geometría top-level cuando OL lee el FeatureCollection (de lo
  // contrario el plain-object machaca la instancia de Geometry y
  // OL revienta con "geometry.getExtent is not a function").
  const out = []
  for (let i = 0; i < cursores.length; i++) {
    const geom = cursores[i]
    if (geom && typeof geom === 'object' && geom.type) {
      const props = { ...(propsCursores[i] || {}) }
      delete props.geometry
      out.push({ geometry: geom, propiedades: props })
    }
  }
  return out
}

function sustituirTokens(plantilla, contexto) {
  return plantilla.replace(/\{(\w+)\}/g, (_, key) =>
    contexto[key] !== undefined && contexto[key] !== null
      ? String(contexto[key])
      : `{${key}}`
  )
}


// ── Componente ──────────────────────────────────────────────────────

export default function SeccionMapa({ seccion, predioCompleto }) {
  const mapRef       = useRef(null)
  const mapInstance  = useRef(null)
  const layerRefs    = useRef({})              // capaId → VectorLayer
  const selectedRef  = useRef(null)            // selected actualizado para style fn
  const [coords, setCoords]           = useState(null)
  const [pantallaCompleta, setPC]     = useState(false)
  const [errorCapas, setErrorCapas]   = useState({}) // capaId → string

  const { selected, select } = useMapaPredioSync()

  // Visibilidad inicial desde el JSON
  const [visibilidad, setVisibilidad] = useState(() => {
    const init = {}
    for (const c of seccion.capas || []) init[c.id] = c.visible_default !== false
    return init
  })

  const sridDisplay = seccion.srid_display || 4326

  // Contexto para sustitución de tokens en endpoints (ej. {codigo_manzana})
  const contextoTokens = useMemo(() => {
    const np = predioCompleto?.predio?.numero_predial || ''
    return {
      codigo_manzana: np.length >= 17 ? np.slice(0, 17) : '',
      id_operacion:   predioCompleto?.predio?.id_operacion || '',
      numero_predial: np,
    }
  }, [predioCompleto])

  // Mount del mapa una sola vez
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    if (sridDisplay === 9377) registrarEPSG9377()

    const controls = defaultControls()
    if (seccion.mostrar_escala !== false) {
      controls.extend([new ScaleLine({ units: 'metric' })])
    }

    mapInstance.current = new Map({
      target: mapRef.current,
      layers: [new TileLayer({ source: new OSM() })],
      view: new View({
        center: fromLonLat([-73.81, 5.61]),  // Centro Chiquinquirá
        zoom: 14,
      }),
      controls,
    })

    if (seccion.mostrar_coordenadas_cursor !== false) {
      mapInstance.current.on('pointermove', (evt) => {
        try {
          const [x, y] = sridDisplay === 3857
            ? evt.coordinate
            : transform(evt.coordinate, 'EPSG:3857', `EPSG:${sridDisplay}`)
          setCoords({ x, y })
        } catch {
          setCoords(null)
        }
      })
    }

    // Click en feature → seleccionar (sync con sección lista)
    mapInstance.current.on('click', (evt) => {
      let payload = null
      mapInstance.current.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        for (const capa of (seccion.capas || [])) {
          if (
            capa.interactive &&
            capa.id_feature &&
            layerRefs.current[capa.id] === layer
          ) {
            const fid = feature.get(capa.id_feature)
            if (fid != null) {
              payload = { capaId: capa.id, featureId: String(fid) }
              return true   // detener iteración
            }
          }
        }
        return false
      })
      if (payload) select(payload.capaId, payload.featureId, 'map')
    })

    // Cursor pointer cuando hay feature interactivo bajo el mouse
    mapInstance.current.on('pointermove', (evt) => {
      if (evt.dragging) return
      let hit = false
      mapInstance.current.forEachFeatureAtPixel(evt.pixel, (_feature, layer) => {
        for (const capa of (seccion.capas || [])) {
          if (capa.interactive && layerRefs.current[capa.id] === layer) {
            hit = true
            return true
          }
        }
        return false
      })
      mapInstance.current.getTargetElement().style.cursor = hit ? 'pointer' : ''
    })

    return () => {
      if (mapInstance.current) {
        mapInstance.current.setTarget(null)
        mapInstance.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sincronizar capas con `seccion.capas` y `predioCompleto`
  useEffect(() => {
    if (!mapInstance.current || !predioCompleto) return
    let cancelado = false

    Promise.resolve().then(async () => {
      if (cancelado) return
      const map = mapInstance.current
      const capas = seccion.capas || []
      const errores = {}

      for (const capa of capas) {
        let features = []

        if (capa.fuente === 'predio_data') {
          const items = extraerGeometrias(predioCompleto, capa)
          features = items.map(({ geometry, propiedades }) => ({
            type: 'Feature',
            geometry,
            properties: propiedades,
          }))
        } else if (capa.fuente === 'endpoint' && capa.endpoint) {
          try {
            const url = sustituirTokens(capa.endpoint, contextoTokens)
            // El endpoint `/spatial/manzana/{codigo}` está bajo /api/v1
            // (axios baseURL ya lo incluye, así que pasamos el path
            // interno relativo)
            const path = url.startsWith('/') ? url : `/${url}`
            const { data } = await api.get(path)
            if (data?.geometry) {
              const props = { ...data }
              delete props.geometry
              features = [{
                type: 'Feature',
                geometry: data.geometry,
                properties: props,
              }]
            }
          } catch (err) {
            errores[capa.id] = err?.response?.status === 404
              ? 'No encontrado'
              : 'Error al cargar'
          }
        }

        if (cancelado) return

        // Crear/actualizar VectorLayer (con style reactivo: aplica el
        // estilo resaltado solo al feature seleccionado)
        let layer = layerRefs.current[capa.id]
        if (!layer) {
          const estiloNormal    = styleParaCapa(capa)
          const estiloResaltado = styleResaltadoParaCapa(capa)
          layer = new VectorLayer({
            source: new VectorSource(),
            style: (feature) => {
              const sel = selectedRef.current
              if (
                sel &&
                sel.capaId === capa.id &&
                capa.id_feature &&
                String(feature.get(capa.id_feature)) === sel.featureId
              ) {
                return estiloResaltado(feature)
              }
              return estiloNormal(feature)
            },
            zIndex: capa.z_index ?? 0,
          })
          layerRefs.current[capa.id] = layer
          map.addLayer(layer)
        }
        layer.setVisible(Boolean(visibilidad[capa.id]))

        const source = layer.getSource()
        source.clear()
        if (features.length > 0) {
          const olFeatures = new GeoJSON().readFeatures(
            { type: 'FeatureCollection', features },
            { featureProjection: 'EPSG:3857' }
          )
          source.addFeatures(olFeatures)
        }
      }

      if (!cancelado) setErrorCapas(errores)

      // Auto-zoom a las capas con datos al primer mount
      if (!cancelado) {
        const todosExtents = []
        for (const id of Object.keys(layerRefs.current)) {
          const src = layerRefs.current[id].getSource()
          if (src.getFeatures().length > 0) {
            todosExtents.push(src.getExtent())
          }
        }
        if (todosExtents.length > 0) {
          const merged = todosExtents.reduce((acc, e) => [
            Math.min(acc[0], e[0]),
            Math.min(acc[1], e[1]),
            Math.max(acc[2], e[2]),
            Math.max(acc[3], e[3]),
          ])
          if (Number.isFinite(merged[0])) {
            map.getView().fit(merged, { padding: [40, 40, 40, 40], maxZoom: 19 })
          }
        }
      }
    })

    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predioCompleto, seccion.capas, contextoTokens])

  // Re-aplicar visibilidad cuando el usuario togglea
  useEffect(() => {
    for (const id of Object.keys(layerRefs.current)) {
      layerRefs.current[id].setVisible(Boolean(visibilidad[id]))
    }
  }, [visibilidad])

  // Reaccionar a cambios de selección compartida:
  //   - Actualizar selectedRef (lo lee la style fn de cada capa)
  //   - Forzar repintar (`changed()`)
  //   - Si la selección vino de la lista, hacer fit al feature
  useEffect(() => {
    selectedRef.current = selected
    for (const id of Object.keys(layerRefs.current)) {
      layerRefs.current[id].changed()
    }

    if (!selected || selected.source !== 'list') return
    const layer = layerRefs.current[selected.capaId]
    if (!layer) return
    const capaCfg = (seccion.capas || []).find(c => c.id === selected.capaId)
    if (!capaCfg?.id_feature) return

    const feature = layer.getSource().getFeatures().find(
      f => String(f.get(capaCfg.id_feature)) === selected.featureId
    )
    if (feature && mapInstance.current) {
      const geom = feature.getGeometry()
      if (geom) {
        mapInstance.current.getView().fit(geom.getExtent(), {
          padding: [80, 80, 80, 80],
          maxZoom: 19,
          duration: 400,
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const altura = pantallaCompleta ? '85vh' : (seccion.altura || 500)

  return (
    <Box>
      <Box
        sx={{
          position: 'relative',
          height: altura,
          width: '100%',
          borderRadius: 1,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

        {/* Control de capas (overlay esquina superior derecha) */}
        <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }}>
          <ControlCapas
            capas={seccion.capas || []}
            visibilidad={visibilidad}
            onToggle={(id, v) => setVisibilidad(prev => ({ ...prev, [id]: v }))}
          />
        </Box>

        {/* Coordenadas (esquina inferior izquierda) */}
        {coords && (
          <Chip
            size="small"
            label={`${coords.x.toFixed(2)}, ${coords.y.toFixed(2)} (EPSG:${sridDisplay})`}
            sx={{
              position: 'absolute',
              bottom: 8, left: 8,
              bgcolor: 'rgba(255,255,255,0.9)',
              fontFamily: 'monospace',
              zIndex: 5,
            }}
          />
        )}

        {/* Pantalla completa */}
        {seccion.permite_pantalla_completa !== false && (
          <Tooltip title={pantallaCompleta ? 'Salir' : 'Pantalla completa'}>
            <IconButton
              size="small"
              onClick={() => {
                setPC(p => !p)
                setTimeout(() => mapInstance.current?.updateSize(), 100)
              }}
              sx={{
                position: 'absolute',
                bottom: 8, right: 8,
                bgcolor: 'background.paper',
                zIndex: 5,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {pantallaCompleta ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Errores por capa */}
      {Object.keys(errorCapas).length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {Object.entries(errorCapas).map(([id, msg]) => {
            const cfg = (seccion.capas || []).find(c => c.id === id)
            return (
              <Alert key={id} severity="warning" sx={{ py: 0.25 }}>
                Capa "{cfg?.label || id}": {msg}
              </Alert>
            )
          })}
        </Stack>
      )}

      {(seccion.capas || []).length === 0 && (
        <Typography variant="caption" color="text.secondary">
          No hay capas configuradas para esta sección.
        </Typography>
      )}
    </Box>
  )
}
