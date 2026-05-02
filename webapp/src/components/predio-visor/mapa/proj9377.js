/**
 * Registra EPSG:9377 (CTM12 — Marco Geocéntrico Nacional, Colombia) en
 * proj4 y en el sistema de proyecciones de OpenLayers.
 *
 * El backend devuelve geometrías reproyectadas a EPSG:4326. El mapa
 * usa internamente EPSG:3857 (default OL/OSM). EPSG:9377 lo necesitamos
 * para mostrar las coordenadas del cursor en CTM12 (la proyección
 * oficial del catastro IGAC).
 */
import proj4 from 'proj4'
import { register } from 'ol/proj/proj4'

let registrado = false

export function registrarEPSG9377() {
  if (registrado) return
  proj4.defs(
    'EPSG:9377',
    '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
  )
  register(proj4)
  registrado = true
}
