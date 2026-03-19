import { useState, useEffect, useRef } from 'react'
import {
  Box, Typography, TextField, Button, Alert, CircularProgress,
  Card, CardContent, Chip, Divider, Grid, Stack, IconButton,
  Tooltip, InputAdornment, Paper
} from '@mui/material'
import SearchIcon       from '@mui/icons-material/Search'
import CheckCircleIcon  from '@mui/icons-material/CheckCircle'
import CancelIcon       from '@mui/icons-material/Cancel'
import TerrainIcon      from '@mui/icons-material/Terrain'
import GavelIcon        from '@mui/icons-material/Gavel'
import MapIcon          from '@mui/icons-material/Map'
import EngineeringIcon  from '@mui/icons-material/Engineering'
import EditIcon         from '@mui/icons-material/Edit'
import SaveIcon         from '@mui/icons-material/Save'
import CloseIcon        from '@mui/icons-material/Close'
import VerifiedIcon     from '@mui/icons-material/Verified'
import NewReleasesIcon  from '@mui/icons-material/NewReleases'
import LocationOnIcon   from '@mui/icons-material/LocationOn'
import OlMap        from 'ol/Map'
import View         from 'ol/View'
import TileLayer    from 'ol/layer/Tile'
import VectorLayer  from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import OSM         from 'ol/source/OSM'
import GeoJSON     from 'ol/format/GeoJSON'
import { Style, Fill, Stroke } from 'ol/style'
import { fromLonLat } from 'ol/proj'
import 'ol/ol.css'
import api from '../api/axios'

const MAP_HEIGHT = 260

const BLOQUES_CALIDAD = [
  { key: 'calidad_campo',    label: 'Campo',    campoObs: 'revisar_campo',    icon: <EngineeringIcon />, color: '#F57C00' },
  { key: 'calidad_fisica',   label: 'Física',   campoObs: 'revisar_fisica',   icon: <TerrainIcon />,     color: '#1565C0' },
  { key: 'calidad_juridica', label: 'Jurídica', campoObs: 'revisar_juridica', icon: <GavelIcon />,       color: '#6A1B9A' },
  { key: 'calidad_sig',      label: 'SIG',      campoObs: 'revisar_sig',      icon: <MapIcon />,         color: '#2E7D32' }
]

// ── Bloque de calidad ────────────────────────────────────────────────────────
function BloqueCalidad({ bloque, predio, onActualizar, onGuardarObs, actualizando, guardandoObs }) {
  const valor     = predio[bloque.key]
  const obsActual = predio[bloque.campoObs] || ''
  const aprobado  = valor === 1
  const enProceso = actualizando === bloque.key
  const guardando = guardandoObs === bloque.campoObs

  const [editando, setEditando] = useState(false)
  const [obsLocal, setObsLocal] = useState(obsActual)

  useEffect(() => {
    setObsLocal(predio[bloque.campoObs] || '')
  }, [predio, bloque.campoObs])

  const handleGuardar = async () => {
    await onGuardarObs(bloque.campoObs, obsLocal)
    setEditando(false)
  }

  return (
    <Card variant="outlined" sx={{
      borderColor: aprobado ? 'success.main' : 'divider',
      borderWidth:  aprobado ? 2 : 1,
      transition:  'border-color 0.2s'
    }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ color: bloque.color }}>{bloque.icon}</Box>
            <Typography variant="subtitle1" fontWeight={600}>{bloque.label}</Typography>
          </Box>
          <Chip size="small" label={aprobado ? 'Aprobado' : 'Sin revisar'}
            color={aprobado ? 'success' : 'default'}
            icon={aprobado ? <CheckCircleIcon /> : undefined}
          />
        </Box>

        <Divider sx={{ mb: 1.5 }} />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">Observaciones</Typography>
          {!editando && (
            <Tooltip title="Editar observación">
              <IconButton size="small" onClick={() => setEditando(true)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {editando ? (
          <Box>
            <TextField fullWidth multiline rows={3} size="small" autoFocus
              value={obsLocal} onChange={e => setObsLocal(e.target.value)}
              placeholder="Escribe las observaciones..."
            />
            <Stack direction="row" spacing={1} mt={1}>
              <Button fullWidth size="small" variant="contained" color="primary"
                startIcon={guardando ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                onClick={handleGuardar} disabled={guardando}
              >
                {guardando ? 'Guardando...' : 'Guardar'}
              </Button>
              <Button fullWidth size="small" variant="outlined" color="inherit"
                startIcon={<CloseIcon />}
                onClick={() => { setObsLocal(obsActual); setEditando(false) }}
                disabled={guardando}
              >
                Cancelar
              </Button>
            </Stack>
          </Box>
        ) : (
          <Typography variant="body2" sx={{
            minHeight: 56, p: 1,
            bgcolor: 'background.default', borderRadius: 1,
            fontStyle: obsActual ? 'normal' : 'italic',
            color: obsActual ? 'text.primary' : 'text.disabled',
            whiteSpace: 'pre-wrap'
          }}>
            {obsActual || 'Sin observaciones — haz clic en ✏️ para agregar'}
          </Typography>
        )}

        <Stack direction="row" spacing={1} mt={2}>
          <Button fullWidth size="small"
            variant={aprobado ? 'outlined' : 'contained'} color="success"
            startIcon={enProceso && !aprobado
              ? <CircularProgress size={14} color="inherit" /> : <CheckCircleIcon />}
            onClick={() => onActualizar(bloque.key, 1)}
            disabled={aprobado || !!actualizando || editando}
          >Aprobar</Button>
          <Button fullWidth size="small"
            variant={!aprobado ? 'outlined' : 'contained'} color="warning"
            startIcon={enProceso && aprobado
              ? <CircularProgress size={14} color="inherit" /> : <CancelIcon />}
            onClick={() => onActualizar(bloque.key, 0)}
            disabled={!aprobado || !!actualizando || editando}
          >Revertir</Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

// ── Indicador compacto ───────────────────────────────────────────────────────
function IndicadorValidacion({ total }) {
  const completo = total === 4
  return (
    <Paper elevation={0} sx={{
      display: 'inline-flex', alignItems: 'center', gap: 1.5,
      px: 2, py: 1, borderRadius: 2,
      bgcolor: completo ? 'success.main' : 'warning.light',
      color:   completo ? 'white' : 'warning.contrastText',
      border: '1.5px solid',
      borderColor: completo ? 'success.dark' : 'warning.main',
    }}>
      {completo ? <VerifiedIcon sx={{ fontSize: 22 }} /> : <NewReleasesIcon sx={{ fontSize: 22 }} />}
      <Typography variant="body2" fontWeight={600}>
        {completo ? 'Predio totalmente validado' : `${total} / 4 aspectos aprobados`}
      </Typography>
      <Stack direction="row" spacing={0.5} ml={0.5}>
        {BLOQUES_CALIDAD.map((b, i) => (
          <Tooltip key={b.key} title={b.label}>
            <Box sx={{
              width: 10, height: 10, borderRadius: '50%',
              bgcolor: i < total
                ? (completo ? 'white' : 'success.main')
                : 'rgba(0,0,0,0.2)',
            }} />
          </Tooltip>
        ))}
      </Stack>
    </Paper>
  )
}

// ── Mapa como componente separado ────────────────────────────────────────────
// Se monta SOLO cuando hay predio, así el div tiene dimensiones reales
// desde el primer render y OL no queda con 0x0.
function MapaPredio({ geometry }) {
  const mapRef      = useRef(null)
  const mapInstance = useRef(null)
  const layerRef    = useRef(null)

  useEffect(() => {
    if (!mapRef.current) return

    layerRef.current = new VectorLayer({
      source: new VectorSource(),
      style: new Style({
        fill:   new Fill({ color: 'rgba(33,150,243,0.25)' }),
        stroke: new Stroke({ color: '#1565C0', width: 2.5 })
      })
    })

    mapInstance.current = new OlMap({
      target: mapRef.current,
      layers: [new TileLayer({ source: new OSM() }), layerRef.current],
      view:   new View({ center: fromLonLat([-74.09, 4.71]), zoom: 13 })
    })

    // Cargar geometría si viene desde el inicio
    if (geometry) {
      const source = layerRef.current.getSource()
      const feature = new GeoJSON().readFeature(
        { type: 'Feature', geometry },
        { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' }
      )
      source.addFeature(feature)
      mapInstance.current.getView().fit(source.getExtent(), {
        padding: [30, 30, 30, 30], maxZoom: 19
      })
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.setTarget(null)
        mapInstance.current = null
      }
    }
  }, []) // solo al montar — el div ya tiene dimensiones reales

  return (
    <div ref={mapRef} style={{ width: '100%', height: `${MAP_HEIGHT}px` }} />
  )
}

// ── Página principal ─────────────────────────────────────────────────────────
export default function CalidadPredio() {
  const [busqueda,     setBusqueda]     = useState('')
  const [buscando,     setBuscando]     = useState(false)
  const [predio,       setPredio]       = useState(null)
  const [error,        setError]        = useState('')
  const [success,      setSuccess]      = useState('')
  const [actualizando, setActualizando] = useState(null)
  const [guardandoObs, setGuardandoObs] = useState(null)

  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   4000) }
  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }

  const handleBuscar = async () => {
    if (!busqueda.trim()) return
    setBuscando(true)
    setError('')
    setPredio(null)   // destruye MapaPredio anterior → OL se limpia
    try {
      const { data } = await api.get(`/calidad/predio/${busqueda.trim()}`)
      setPredio(data) // monta nuevo MapaPredio con div visible
    } catch (e) {
      if (e.response?.status === 404) {
        mostrarError(`No se encontró ningún predio con número predial: ${busqueda}`)
      } else {
        mostrarError('Error al buscar el predio')
      }
    } finally {
      setBuscando(false)
    }
  }

  const handleActualizar = async (campo, valor) => {
    setActualizando(campo)
    try {
      await api.patch(`/calidad/predio/${predio.id_operacion}/calidad`, { campo, valor })
      setPredio(prev => ({ ...prev, [campo]: valor }))
      mostrarSuccess(`Calidad ${campo.replace('calidad_', '')} ${valor === 1 ? 'aprobada' : 'revertida'}`)
    } catch {
      mostrarError('Error al actualizar la calidad')
    } finally {
      setActualizando(null)
    }
  }

  const handleGuardarObs = async (campo, texto) => {
    setGuardandoObs(campo)
    try {
      await api.patch(`/calidad/predio/${predio.id_operacion}/observacion`, { campo, texto })
      setPredio(prev => ({ ...prev, [campo]: texto }))
      mostrarSuccess('Observación guardada')
    } catch {
      mostrarError('Error al guardar la observación')
    } finally {
      setGuardandoObs(null)
    }
  }

  const formatearDireccion = (p) => {
    const partes = [
      p.clase_via_principal && `Vía ${p.clase_via_principal}`,
      p.valor_via_principal, p.letra_via_principal,
      p.letra_via_generadora && `# ${p.letra_via_generadora}`,
      p.valor_via_generadora, p.complemento
    ].filter(Boolean)
    return partes.length > 0 ? partes.join(' ') : (p.nombre_predio || '—')
  }

  const totalAprobados = predio
    ? BLOQUES_CALIDAD.filter(b => predio[b.key] === 1).length
    : 0

  return (
    <Box sx={{ p: 3 }}>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h5" fontWeight={600}>Control de calidad predial</Typography>
        {predio && <IndicadorValidacion total={totalAprobados} />}
      </Box>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Ingresa el número predial para verificar y aprobar los aspectos de calidad.
      </Typography>

      {/* Buscador */}
      <Box sx={{ display: 'flex', gap: 1, mb: 3, maxWidth: 520 }}>
        <TextField fullWidth size="small" label="Número predial"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleBuscar()}
          placeholder="Ej: 25001000100000000001000"
          InputProps={{ startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" color="action" />
            </InputAdornment>
          )}}
        />
        <Button variant="contained" onClick={handleBuscar}
          disabled={buscando || !busqueda.trim()} sx={{ minWidth: 110 }}
        >
          {buscando ? <CircularProgress size={20} color="inherit" /> : 'Buscar'}
        </Button>
      </Box>

      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {predio && (
        <Grid container spacing={3}>

          <Grid item xs={12} md={12}>
            <Grid container spacing={2}>

              {/* Info del predio */}
              <Grid item xs={12} sm={12} sx={{ height: '100%',  width: '370px' }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="subtitle1" fontWeight={600} mb={1.5}>
                      Información del predio
                    </Typography>
                    <Divider sx={{ mb: 1.5 }} />
                    <Stack spacing={1.2}>
                      {[
                        { label: 'NPN',          value: predio.npn_etiqueta || predio.npn },
                        { label: 'N° predial',   value: predio.numero_predial },
                        { label: 'Nombre/Dir.',  value: predio.nombre_predio || formatearDireccion(predio) },
                        { label: 'Municipio',     value: predio.municipio },
                        { label: 'Departamento',  value: predio.departamento },
                        { label: 'Matrícula',     value: predio.matricula_inmobiliaria },
                        { label: 'Área (m²)',     value: predio.area_total_terreno
                            ? Number(predio.area_total_terreno).toFixed(2) : null },
                        { label: 'Avalúo',        value: predio.avaluo_catastral
                            ? `$${Number(predio.avaluo_catastral).toLocaleString('es-CO')}` : null },
                      ].map(({ label, value }) => (
                        <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 90 }}>
                            {label}
                          </Typography>
                          <Typography variant="caption" fontWeight={500} textAlign="right">
                            {value || '—'}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>

              {/* Mapa */}
              <Grid item xs={12} sm={12} sx={{ height: '100%',  width: '500px' }}>
                <Card sx={{ height: '100%',  width: '100%' }}>
                  <CardContent sx={{ p: '12px !important', height: '100%' , width: '100%'}}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                      <LocationOnIcon fontSize="small" color="action" />
                      <Typography variant="caption" color="text.secondary">Localización</Typography>
                    </Box>
                    <Box sx={{
                      borderRadius: 1, overflow: 'hidden',
                      border: '1px solid', borderColor: 'divider',
                      height: 'calc(100% - 28px)',   // ocupa todo el alto disponible
                      minHeight: 260
                    }}>
                      <MapaPredio geometry={predio.geometry} />
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

            </Grid>
          </Grid>
          
          {/* Columna derecha: calidades */}
          <Grid item xs={12} md={8}>
            <Typography variant="subtitle1" fontWeight={600} mb={2}>Aspectos de calidad</Typography>
            <Grid container spacing={2}>
              {BLOQUES_CALIDAD.map(bloque => (
                <Grid item xs={12} sm={6} key={bloque.key}>
                  <BloqueCalidad
                    bloque={bloque} predio={predio}
                    onActualizar={handleActualizar}
                    onGuardarObs={handleGuardarObs}
                    actualizando={actualizando}
                    guardandoObs={guardandoObs}
                  />
                </Grid>
              ))}
            </Grid>
          </Grid>

        </Grid>
      )}
    </Box>
  )
}
