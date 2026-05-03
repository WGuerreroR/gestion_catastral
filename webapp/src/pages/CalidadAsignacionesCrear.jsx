import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Alert, Box, Button, Card, Checkbox, Chip, CircularProgress,
  Divider, Drawer, FormControl, IconButton, InputLabel, List,
  ListItemButton, ListItemIcon, ListItemText, MenuItem, Select,
  Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import ArrowBackIcon    from '@mui/icons-material/ArrowBack'
import FactCheckIcon    from '@mui/icons-material/FactCheck'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ListIcon         from '@mui/icons-material/List'
import ShuffleIcon      from '@mui/icons-material/Shuffle'
import OlMap        from 'ol/Map'
import View         from 'ol/View'
import TileLayer    from 'ol/layer/Tile'
import VectorLayer  from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import OSM          from 'ol/source/OSM'
import GeoJSON      from 'ol/format/GeoJSON'
import { Style, Fill, Stroke } from 'ol/style'
import { fromLonLat } from 'ol/proj'
import 'ol/ol.css'
import { useNavigate } from 'react-router-dom'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'

const estiloArea = new Style({
  fill:   new Fill({ color: 'rgba(255,152,0,0.15)' }),
  stroke: new Stroke({ color: '#F57C00', width: 2, lineDash: [8, 4] }),
})
const estiloPredio = new Style({
  fill:   new Fill({ color: 'rgba(200,200,200,0.4)' }),
  stroke: new Stroke({ color: '#888', width: 1.5 }),
})

export default function CalidadAsignacionesCrear() {
  const navigate    = useNavigate()
  const mapRef      = useRef(null)
  const mapInstance = useRef(null)
  const areaLayer   = useRef(null)
  const prediosLayer= useRef(null)

  const [asignaciones,    setAsignaciones]    = useState([])
  const [seleccionados,   setSeleccionados]   = useState(new Set())
  const [filtro,          setFiltro]          = useState('')
  const [margenError,     setMargenError]     = useState(0.10)
  const [resultado,       setResultado]       = useState(null)
  const [nombre,          setNombre]          = useState('')
  const [descripcion,     setDescripcion]     = useState('')
  const [cargandoLista,   setCargandoLista]   = useState(true)
  const [calculando,      setCalculando]      = useState(false)
  const [creando,         setCreando]         = useState(false)
  const [error,           setError]           = useState('')
  const [drawerOpen,      setDrawerOpen]      = useState(false)

  // ── Cargar lista de asignaciones disponibles ──────────────────────────────
  useEffect(() => {
    let cancelado = false
    setCargandoLista(true)
    api.get('/calidad-muestreo/asignaciones-disponibles')
      .then(({ data }) => { if (!cancelado) setAsignaciones(data) })
      .catch(() => { if (!cancelado) setError('Error cargando asignaciones disponibles') })
      .finally(() => { if (!cancelado) setCargandoLista(false) })
    return () => { cancelado = true }
  }, [])

  // ── Inicializar mapa una sola vez ─────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return
    areaLayer.current    = new VectorLayer({ source: new VectorSource(), style: estiloArea,   zIndex: 2 })
    prediosLayer.current = new VectorLayer({ source: new VectorSource(), style: estiloPredio, zIndex: 1 })
    mapInstance.current = new OlMap({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        areaLayer.current,
        prediosLayer.current,
      ],
      view: new View({ center: fromLonLat([-74.09, 4.71]), zoom: 13 }),
    })
    return () => {
      if (mapInstance.current) {
        mapInstance.current.setTarget(null)
        mapInstance.current = null
      }
    }
  }, [])

  // ── Debounced preview cada vez que cambia la selección ──────────────────
  const idsKey = Array.from(seleccionados).sort((a, b) => a - b).join(',')
  useEffect(() => {
    if (seleccionados.size === 0) {
      setResultado(null)
      areaLayer.current?.getSource().clear()
      prediosLayer.current?.getSource().clear()
      return
    }
    let cancelado = false
    const t = setTimeout(async () => {
      setCalculando(true)
      try {
        const { data } = await api.post('/calidad-muestreo/preview', {
          asignacion_ids: Array.from(seleccionados),
          margen_error:   margenError,
        })
        if (cancelado) return
        setResultado(data)
        renderEnMapa(data)
      } catch (e) {
        if (!cancelado) setError(getErrorMessage(e, 'Error calculando la muestra'))
      } finally {
        if (!cancelado) setCalculando(false)
      }
    }, 350)
    return () => { cancelado = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, margenError])

  const renderEnMapa = useCallback((data) => {
    if (!mapInstance.current) return
    const fmt = new GeoJSON({ featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' })

    // Predios
    const sourcePredios = prediosLayer.current.getSource()
    sourcePredios.clear()
    if (data?.geojson_predios?.features?.length) {
      sourcePredios.addFeatures(fmt.readFeatures(data.geojson_predios))
    }

    // Área
    const sourceArea = areaLayer.current.getSource()
    sourceArea.clear()
    if (data?.area_geojson) {
      sourceArea.addFeatures(fmt.readFeatures({
        type: 'Feature', geometry: data.area_geojson, properties: {},
      }))
    }

    // Encuadre
    const ext = sourcePredios.getExtent()
    if (ext && Number.isFinite(ext[0])) {
      mapInstance.current.getView().fit(ext, { padding: [40, 40, 40, 40], maxZoom: 18 })
    }
  }, [])

  const toggle = (id) => {
    setSeleccionados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleCrear = async () => {
    if (!nombre.trim() || !resultado) return
    setCreando(true); setError('')
    try {
      const { data } = await api.post('/calidad-muestreo/', {
        nombre,
        descripcion,
        asignacion_ids:    Array.from(seleccionados),
        id_operaciones:    resultado.id_operaciones,
        muestra_calculada: resultado.muestra_calculada,
        margen_error:      margenError,
      })
      navigate(`/calidad-asignaciones/${data.id}`)
    } catch (e) {
      setError(getErrorMessage(e, 'Error al crear el proyecto'))
    } finally {
      setCreando(false)
    }
  }

  const filtradas = asignaciones.filter(a => {
    if (!filtro) return true
    const q = filtro.toLowerCase()
    return (a.clave_proyecto || '').toLowerCase().includes(q)
        || (a.responsable     || '').toLowerCase().includes(q)
  })

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* Panel izquierdo */}
      <Box sx={{
        width: 380, flexShrink: 0,
        borderRight: '1px solid', borderColor: 'divider',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <IconButton size="small" onClick={() => navigate('/calidad-asignaciones')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <FactCheckIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600}>Nuevo proyecto</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Selecciona una o más asignaciones en estado "validación"
          </Typography>
        </Box>

        {/* Buscador */}
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField fullWidth size="small" label="Filtrar (clave u operador)"
            value={filtro} onChange={e => setFiltro(e.target.value)} />
        </Box>

        {/* Lista checkable */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {error && <Alert severity="error" sx={{ m: 2 }} onClose={() => setError('')}>{error}</Alert>}

          {cargandoLista ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : filtradas.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {asignaciones.length === 0
                  ? 'No hay asignaciones en estado "validación".'
                  : 'Ninguna asignación coincide con el filtro.'}
              </Typography>
            </Box>
          ) : (
            <List dense sx={{ py: 0 }}>
              {filtradas.map(a => {
                const checked = seleccionados.has(a.id)
                return (
                  <ListItemButton key={a.id} onClick={() => toggle(a.id)}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Checkbox edge="start" checked={checked} tabIndex={-1} disableRipple />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" fontWeight={600}>
                            {a.clave_proyecto}
                          </Typography>
                          <Chip label={`${a.total_predios} predios`} size="small" variant="outlined" />
                        </Stack>
                      }
                      secondary={a.responsable || '—'}
                    />
                  </ListItemButton>
                )
              })}
            </List>
          )}
        </Box>

        {/* Resultado / acción */}
        {seleccionados.size > 0 && (
          <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            {calculando ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                <CircularProgress size={20} />
              </Box>
            ) : resultado ? (
              <Stack spacing={1.5}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">Asignaciones</Typography>
                  <Typography variant="body2" fontWeight={700}>{seleccionados.size}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">Predios</Typography>
                  <Typography variant="body2" fontWeight={700} color="primary.main">
                    {resultado.total_predios}
                  </Typography>
                </Box>
                <FormControl fullWidth size="small">
                  <InputLabel>Margen de error</InputLabel>
                  <Select
                    value={margenError}
                    label="Margen de error"
                    onChange={(e) => setMargenError(parseFloat(e.target.value))}
                  >
                    <MenuItem value={0.05}>5%</MenuItem>
                    <MenuItem value={0.10}>10%</MenuItem>
                    <MenuItem value={0.15}>15%</MenuItem>
                    <MenuItem value={0.20}>20%</MenuItem>
                    <MenuItem value={0.25}>25%</MenuItem>
                  </Select>
                </FormControl>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Muestra calculada</Typography>
                    <Tooltip title={`n = (N·Z²·p·q) / (e²·(N-1) + Z²·p·q) — IC 95%, e=${(margenError * 100).toFixed(0)}%`}>
                      <InfoOutlinedIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
                    </Tooltip>
                  </Box>
                  <Chip label={resultado.muestra_calculada} size="small"
                    color="primary" icon={<ShuffleIcon />} />
                </Box>

                <Button size="small" variant="outlined" startIcon={<ListIcon />}
                  onClick={() => setDrawerOpen(true)} disabled={!resultado.id_operaciones?.length}>
                  Ver lista de predios
                </Button>

                <Divider />

                <TextField size="small" fullWidth label="Nombre del proyecto *"
                  value={nombre} onChange={e => setNombre(e.target.value)} />
                <TextField size="small" fullWidth multiline rows={2}
                  label="Descripción (opcional)"
                  value={descripcion} onChange={e => setDescripcion(e.target.value)} />
                <Button fullWidth variant="contained" color="primary"
                  onClick={handleCrear}
                  disabled={creando || !nombre.trim() || resultado.total_predios === 0}
                  startIcon={creando
                    ? <CircularProgress size={16} color="inherit" />
                    : <FactCheckIcon />}
                >
                  {creando ? 'Creando…' : 'Crear proyecto de calidad'}
                </Button>
              </Stack>
            ) : null}
          </Box>
        )}
      </Box>

      {/* Mapa */}
      <Box sx={{ flex: 1, position: 'relative' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

        <Card sx={{ position: 'absolute', bottom: 16, left: 16, zIndex: 1000, p: 1.5 }}>
          <Typography variant="caption" fontWeight={600} display="block" mb={1}>Leyenda</Typography>
          {[
            { label: 'Área de las asignaciones', fill: 'rgba(255,152,0,0.15)', stroke: '#F57C00', dash: true },
            { label: 'Predios del universo',     fill: 'rgba(200,200,200,0.4)', stroke: '#888',    dash: false },
          ].map(({ label, fill, stroke, dash }) => (
            <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Box sx={{
                width: 14, height: 14, borderRadius: 0.5,
                bgcolor: fill,
                border: `2px ${dash ? 'dashed' : 'solid'} ${stroke}`,
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
            Predios del universo ({resultado?.total_predios || 0})
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
