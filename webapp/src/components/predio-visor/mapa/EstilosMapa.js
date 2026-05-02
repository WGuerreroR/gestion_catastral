/**
 * Builders de Style de OpenLayers a partir del bloque `estilo` del JSON.
 *
 * Soporta polígonos/líneas (fill + stroke + dashArray), puntos
 * (icono + color + tamaño) y labels permanentes sobre features
 * (`etiqueta_feature` con `campo`, `prefijo`, `color`, `background`).
 *
 * `styleResaltadoParaCapa` aplica `capa.estilo_resaltado` si está
 * declarado; si no, recarga `capa.estilo` con un fallback de
 * "más fuerte" (stroke +1, fill +0.2 alpha cuando podemos detectarlo).
 */
import { Style, Fill, Stroke, Text, Circle as CircleStyle } from 'ol/style'

function buildText(etiqueta, valor) {
  if (!etiqueta || !valor) return undefined
  const texto = `${etiqueta.prefijo ?? ''}${valor}`
  return new Text({
    text: texto,
    font: '12px Roboto, sans-serif',
    fill: new Fill({ color: etiqueta.color || '#000' }),
    backgroundFill: etiqueta.background
      ? new Fill({ color: etiqueta.background })
      : undefined,
    padding: [2, 4, 2, 4],
    overflow: true,
  })
}

function styleColor(c) {
  if (!c || c === 'transparent') return undefined
  return c
}

function _builderDeEstilo(estilo, capaCfg) {
  const e = estilo || {}

  if (capaCfg.tipo_geometria === 'Point') {
    const fill = styleColor(e.color || '#1976D2')
    const radio = e.size ? Number(e.size) / 2 : 7
    return (feature) => new Style({
      image: new CircleStyle({
        radius: radio,
        fill: fill ? new Fill({ color: fill }) : undefined,
        stroke: new Stroke({ color: '#fff', width: 2 }),
      }),
      text: feature && capaCfg.etiqueta_feature
        ? buildText(capaCfg.etiqueta_feature, feature.get(capaCfg.etiqueta_feature.campo))
        : undefined,
    })
  }

  const fillColor   = styleColor(e.fillColor)
  const strokeColor = styleColor(e.strokeColor) || '#1976D2'
  const strokeWidth = Number(e.strokeWidth ?? 1.5)

  return (feature) => new Style({
    fill:   fillColor ? new Fill({ color: fillColor }) : undefined,
    stroke: new Stroke({
      color: strokeColor,
      width: strokeWidth,
      lineDash: Array.isArray(e.strokeDashArray) ? e.strokeDashArray : undefined,
    }),
    text: feature && capaCfg.etiqueta_feature
      ? buildText(capaCfg.etiqueta_feature, feature.get(capaCfg.etiqueta_feature.campo))
      : undefined,
  })
}

export function styleParaCapa(capaCfg) {
  return _builderDeEstilo(capaCfg.estilo, capaCfg)
}

export function styleResaltadoParaCapa(capaCfg) {
  // Si la capa declara estilo_resaltado explícito, lo usamos.
  if (capaCfg.estilo_resaltado) {
    return _builderDeEstilo(capaCfg.estilo_resaltado, capaCfg)
  }
  // Si no, derivamos uno: stroke +1px, fill un poco más opaco.
  const e = capaCfg.estilo || {}
  const derivado = { ...e }
  derivado.strokeWidth = Number(e.strokeWidth ?? 1.5) + 1.5
  if (e.fillColor && e.fillColor !== 'transparent') {
    // Bump alpha si es rgba(...). Si no detectamos formato, lo dejamos.
    const m = String(e.fillColor).match(/^rgba?\(([^)]+)\)$/)
    if (m) {
      const partes = m[1].split(',').map(s => s.trim())
      const r = partes[0], g = partes[1], b = partes[2]
      const a = partes[3] !== undefined ? Math.min(1, Number(partes[3]) + 0.25) : 0.6
      derivado.fillColor = `rgba(${r}, ${g}, ${b}, ${a})`
    }
  }
  return _builderDeEstilo(derivado, capaCfg)
}

export function colorRepresentativoCapa(capaCfg) {
  const e = capaCfg.estilo || {}
  if (e.color) return e.color
  if (e.fillColor && e.fillColor !== 'transparent') return e.fillColor
  return e.strokeColor || '#999'
}
