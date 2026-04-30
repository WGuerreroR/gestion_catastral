import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box, Typography, Chip, Button, Alert,
  CircularProgress, Stack, Divider, Grid,
  Card, CardContent, IconButton, Tab, Tabs,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Tooltip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import ArrowBackIcon  from '@mui/icons-material/ArrowBack'
import MapIcon        from '@mui/icons-material/Map'
import TableChartIcon from '@mui/icons-material/TableChart'
import AssignmentIcon from '@mui/icons-material/Assignment'
import PersonIcon     from '@mui/icons-material/Person'
import FolderIcon     from '@mui/icons-material/Folder'
import DownloadIcon   from '@mui/icons-material/Download'
import BuildIcon       from '@mui/icons-material/Build'
import UploadIcon      from '@mui/icons-material/Upload'
import WarningIcon     from '@mui/icons-material/Warning'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import SyncIcon        from '@mui/icons-material/Sync'
import Map          from 'ol/Map'
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
import { useParams, useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'
import ModalMetodoAsignacion       from '../components/ModalMetodoAsignacion'
import ModalMapaAsignacion         from '../components/ModalMapaAsignacion'
import ModalAplicarPaqueteOffline  from '../components/ModalAplicarPaqueteOffline'
import ModalFotosPredio            from '../components/ModalFotosPredio'
import ModalDetalleSync            from '../components/ModalDetalleSync'
import PublishIcon                 from '@mui/icons-material/Publish'
import PhotoLibraryIcon            from '@mui/icons-material/PhotoLibrary'
import HistoryIcon                 from '@mui/icons-material/History'
import VisibilityIcon              from '@mui/icons-material/Visibility'

const MAP_HEIGHT = 550

const coloresEstado = {
  campo:      { fill: 'rgba(255,0,200,0.4)',  stroke: '#F57C00' },
  validado:   { fill: 'rgba(33,150,243,0.4)', stroke: '#1565C0' },
  finalizado: { fill: 'rgba(76,175,80,0.4)',  stroke: '#2E7D32' },
  sin_asignar:{ fill: 'rgba(255,152,0,0.4)',  stroke: '#F57C00' }
}

const chipEstado = {
  campo:      'warning',
  validado:   'info',
  finalizado: 'success',
}

const colorEstadoSync = {
  ok:           'success',
  parcial:      'warning',
  error:        'error',
  idempotente:  'info',
  encolado:     'default',
  corriendo:    'info',
}

function columnasHistorialSync({ onAbrirDetalle }) {
  return [
    {
      field: 'fecha_sync', headerName: 'Fecha', width: 170,
      renderCell: ({ value }) =>
        value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—',
    },
    { field: 'paquete_nombre', headerName: 'Paquete', width: 220 },
    {
      field: 'estado', headerName: 'Estado', width: 130,
      renderCell: ({ value }) => (
        <Chip size="small" label={value || '—'} color={colorEstadoSync[value] || 'default'} />
      ),
    },
    { field: 'usuario', headerName: 'Usuario', width: 110 },
    {
      field: 'forzado', headerName: 'Forzado', width: 90,
      renderCell: ({ value }) => value ? <Chip size="small" color="warning" label="forzado" /> : null,
    },
    {
      field: '__detalle', headerName: 'Detalle', width: 100, sortable: false, filterable: false,
      renderCell: ({ row }) => (
        <Tooltip title="Ver detalle del sync">
          <IconButton size="small" onClick={() => onAbrirDetalle(row.id)}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ]
}

const estiloArea = new Style({
  fill:   new Fill({ color: 'rgba(25, 118, 210, 0.08)' }),
  stroke: new Stroke({ color: '#1976D2', width: 2.5, lineDash: [8, 4] })
})

function estiloPredioPorEstado(estado) {
  const c = coloresEstado[estado] || coloresEstado.sin_asignar
  return new Style({
    fill:   new Fill({ color: c.fill }),
    stroke: new Stroke({ color: c.stroke, width: 1.5 })
  })
}

export default function AsignacionDetalle() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const { user }   = useSelector(state => state.auth)
  const puedeAdmin = user?.roles?.some(r => ['administrador', 'supervisor'].includes(r))

  const mapRef          = useRef(null)
  const mapInstance     = useRef(null)
  const prediosLayerRef = useRef(null)
  const areaLayerRef    = useRef(null)
  const geojsonCargado  = useRef(false)
  const areaCargada     = useRef(false)

  const [tab,          setTab]          = useState(0)
  const [proyecto,     setProyecto]     = useState(null)
  const [predios,      setPredios]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [success,      setSuccess]      = useState('')
  const [predioActivo, setPredioActivo] = useState(null)
  const [tieneArea,    setTieneArea]    = useState(false)
  const [descargando,  setDescargando]  = useState(false)  // ← nuevo

  const [modalMetodo,    setModalMetodo]    = useState(false)
  const [modalMapa,      setModalMapa]      = useState(false)
  const [metodoSelected, setMetodoSelected] = useState(null)

  // Descargar QGIS (proyecto base centrado en el área, PostGIS vivo)
  const [descargandoQGZ, setDescargandoQGZ] = useState(false)

  // Proyecto offline (background) — estado + polling
  const [generandoOffline, setGenerandoOffline] = useState(false)
  const [estadoOffline,    setEstadoOffline]    = useState(null)
  const [modalReemplazo,   setModalReemplazo]   = useState({ open: false, proyectoId: null, detalle: null })
  const pollingRef = useRef(null)

  // Cargar proyecto offline (subir .zip generado en QGIS desktop)
  const [subiendoOffline,     setSubiendoOffline]     = useState(false)
  const [modalCargarOffline,  setModalCargarOffline]  = useState(false)
  const [archivoOfflineSel,   setArchivoOfflineSel]   = useState(null)
  const [errorArchivoOffline, setErrorArchivoOffline] = useState('')
  const fileInputCargaRef = useRef(null)

  // QField Cloud (subir / sincronizar con el proyecto remoto)
  const [cloudStatus,     setCloudStatus]     = useState(null)
  const [procesandoCloud, setProcesandoCloud] = useState(false)
  const cloudPollingRef = useRef(null)

  // Sync inverso: aplicar paquete offline editado a PostGIS
  const [modalAplicarOffline, setModalAplicarOffline] = useState(false)

  // Galería de fotos de un predio
  const [modalFotos, setModalFotos] = useState({ open: false, idOperacion: null })

  // Historial de syncs offline + modal de detalle reusable
  const [historialSync, setHistorialSync] = useState([])
  const [mostrarHistorial, setMostrarHistorial] = useState(false)
  const [modalDetalleSync, setModalDetalleSync] = useState({ open: false, syncId: null })

  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   4000) }
  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }

  // ── Cargar datos ─────────────────────────────────────────
  const cargarHistorialSync = useCallback(async () => {
    try {
      const r = await api.get(`/proyectos/${id}/offline/historial-sync?limit=50`)
      setHistorialSync(Array.isArray(r.data) ? r.data : [])
    } catch {
      // No bloquear la página si el historial falla; típicamente la
      // tabla sync_history aún no fue migrada en este entorno.
      setHistorialSync([])
    }
  }, [id])

  const cargarDatos = useCallback(async () => {
    setLoading(true)
    geojsonCargado.current = false
    areaCargada.current    = false
    try {
      const [prRes, pdRes] = await Promise.all([
        api.get(`/proyectos/${id}`),
        api.get(`/proyectos/${id}/predios`)
      ])
      setProyecto(prRes.data)
      setPredios(pdRes.data)
      cargarHistorialSync()  // fire-and-forget; no bloquea el render
    } catch {
      mostrarError('Error cargando datos del proyecto')
    } finally {
      setLoading(false)
    }
  }, [id, cargarHistorialSync])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // ── Proyecto offline: estado + polling ──────────────────
  const detenerPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  const cargarEstadoOffline = useCallback(async () => {
    try {
      const { data } = await api.get(`/proyectos/${id}/estado-generacion`)
      setEstadoOffline(data)
      return data
    } catch (err) {
      console.warn('[offline] estado-generacion no disponible:', err?.message)
      setEstadoOffline(null)
      return null
    }
  }, [id])

  // ── QField Cloud: estado combinado + acciones en background ─────────────
  const detenerPollingCloud = () => {
    if (cloudPollingRef.current) {
      clearInterval(cloudPollingRef.current)
      cloudPollingRef.current = null
    }
  }

  const cargarCloudStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/proyectos/${id}/qfield/cloud-status`)
      setCloudStatus(data)
      return data
    } catch (err) {
      console.warn('[cloud] cloud-status no disponible:', err?.message)
      setCloudStatus(null)
      return null
    }
  }, [id])

  const iniciarPollingCloud = useCallback(() => {
    detenerPollingCloud()
    let failCount = 0
    const MAX_FAILS = 3
    cloudPollingRef.current = setInterval(async () => {
      const data = await cargarCloudStatus()

      // Sin respuesta: contamos fallos; tras 3 seguidos asumimos sesión caída
      if (!data) {
        failCount += 1
        if (failCount >= MAX_FAILS) {
          console.warn('[cloud] polling sin respuesta — sesión/conexión caída')
          detenerPollingCloud()
          setCloudStatus(null)
          setProcesandoCloud(false)
        }
        return
      }

      failCount = 0  // reset en cada éxito
      if (!data.operacion_en_curso) {
        detenerPollingCloud()
        setProcesandoCloud(false)
        if (data.operacion_error) {
          mostrarError(`Error en QField Cloud: ${data.operacion_error}`)
        }
      }
    }, 2000)
  }, [cargarCloudStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Botón único de QField Cloud: el backend decide si subir (primera vez),
  // sincronizar (pull del campo) o recrear (si fue borrado en cloud).
  const handleSincronizarCloud = async () => {
    setProcesandoCloud(true)
    try {
      await api.post(`/proyectos/${id}/qfield/sincronizar-cloud`)
      mostrarSuccess('Operación encolada — progreso arriba')
      await cargarCloudStatus()
      iniciarPollingCloud()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error con QField Cloud'))
      setProcesandoCloud(false)
    }
  }

  // Cancela cualquier operación en curso (offline o cloud) para este proyecto
  const handleCancelarOperacion = async () => {
    try {
      await api.post(`/proyectos/${id}/cancelar-operacion`)
      // Los pollings detectan el cambio y limpian los chips automáticamente
    } catch (e) {
      mostrarError(getErrorMessage(e, 'No se pudo cancelar la operación'))
    }
  }

  const iniciarPolling = useCallback(() => {
    detenerPolling()
    let failCount = 0
    const MAX_FAILS = 3
    pollingRef.current = setInterval(async () => {
      const data = await cargarEstadoOffline()

      // Sin respuesta: contamos fallos; tras 3 seguidos asumimos sesión caída
      if (!data) {
        failCount += 1
        if (failCount >= MAX_FAILS) {
          console.warn('[offline] polling sin respuesta — sesión/conexión caída')
          detenerPolling()
          setEstadoOffline(null)
          setGenerandoOffline(false)
        }
        return
      }

      failCount = 0  // reset en cada éxito
      const estado = data.estado_generacion
      if (!estado || !['pendiente', 'procesando'].includes(estado)) {
        detenerPolling()
        if (estado === 'terminado') mostrarSuccess('Proyecto offline listo')
        if (estado === 'error')     mostrarError('Error generando proyecto offline')
      }
    }, 3000)
  }, [cargarEstadoOffline]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cargar estado inicial + reanudar polling si ya está generando
  useEffect(() => {
    cargarEstadoOffline().then(data => {
      if (data && ['pendiente', 'procesando'].includes(data.estado_generacion)) {
        iniciarPolling()
      }
    })
    cargarCloudStatus().then(data => {
      if (data?.operacion_en_curso) {
        setProcesandoCloud(true)
        iniciarPollingCloud()
      }
    })
    return () => {
      detenerPolling()
      detenerPollingCloud()
    }
  }, [cargarEstadoOffline, iniciarPolling, cargarCloudStatus, iniciarPollingCloud])

  // ── Descargar QGIS (proyecto base centrado, PostGIS vivo) ──
  const handleDescargarQGZ = async () => {
    if (!proyecto?.clave_proyecto) return
    setDescargandoQGZ(true)
    try {
      const response = await api.get(
        `/proyectos/${id}/descargar-proyecto-qgis`,
        { responseType: 'blob' }
      )
      const url  = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href     = url
      link.download = `${proyecto.clave_proyecto}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error descargando QGIS'))
    } finally {
      setDescargandoQGZ(false)
    }
  }

  // ── Generar / Regenerar offline (background) ────────────
  const generarProyectoOffline = async (reemplazar = false) => {
    setGenerandoOffline(true)
    try {
      await api.post(
        `/proyectos/${id}/proyecto-offline/generar`,
        null,
        { params: { reemplazar } }
      )
      setEstadoOffline(prev => ({ ...(prev || {}), estado_generacion: 'pendiente', progreso: 0 }))
      iniciarPolling()
    } catch (err) {
      const status = err?.response?.status
      if (status === 409) {
        setModalReemplazo({ open: true, proyectoId: parseInt(id), detalle: err.response.data?.detail })
      } else if (status === 404) {
        console.warn('[offline] endpoint no disponible:', err?.message)
      } else {
        mostrarError('Error generando proyecto offline')
      }
    } finally {
      setGenerandoOffline(false)
    }
  }

  // ── Cargar proyecto offline (subir .zip) ────────────────
  const abrirModalCargarOffline = () => {
    setArchivoOfflineSel(null)
    setErrorArchivoOffline('')
    setModalCargarOffline(true)
  }

  const cerrarModalCargarOffline = () => {
    if (subiendoOffline) return
    setModalCargarOffline(false)
    setArchivoOfflineSel(null)
    setErrorArchivoOffline('')
  }

  const handleSeleccionarArchivoOffline = (e) => {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return

    if (!archivo.name.toLowerCase().endsWith('.zip')) {
      setErrorArchivoOffline('Solo se permiten archivos .zip')
      setArchivoOfflineSel(null)
      return
    }
    if (archivo.type && !['application/zip', 'application/x-zip-compressed', ''].includes(archivo.type)) {
      setErrorArchivoOffline('El archivo no parece ser un ZIP válido')
      setArchivoOfflineSel(null)
      return
    }
    setErrorArchivoOffline('')
    setArchivoOfflineSel(archivo)
  }

  const handleConfirmarCargarOffline = async () => {
    if (!archivoOfflineSel) return
    setSubiendoOffline(true)
    try {
      const formData = new FormData()
      formData.append('archivo', archivoOfflineSel)
      const { data } = await api.post(
        `/proyectos/${id}/cargar-offline`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      mostrarSuccess(data?.mensaje || 'Proyecto offline cargado exitosamente')
      setModalCargarOffline(false)
      setArchivoOfflineSel(null)
      cargarEstadoOffline()
      cargarCloudStatus()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error cargando proyecto offline'))
      setModalCargarOffline(false)
      setArchivoOfflineSel(null)
    } finally {
      setSubiendoOffline(false)
    }
  }

  // ── Descargar proyecto ────────────────────────────────────
  const handleDescargar = async () => {
    if (!proyecto?.clave_proyecto) return
    setDescargando(true)
    try {
      const response = await api.get(
        `/proyectos/clave/${proyecto.clave_proyecto}/descarga`,
        { responseType: 'blob' }
      )
      const url  = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href     = url
      link.download = `${proyecto.clave_proyecto}_offline.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      mostrarError('Error descargando el proyecto')
    } finally {
      setDescargando(false)
    }
  }

  // ── Inicializar mapa la PRIMERA vez que se abre el tab ───
  useEffect(() => {
    if (tab !== 1) return
    if (!mapRef.current) return

    if (!mapInstance.current) {
      areaLayerRef.current = new VectorLayer({
        source: new VectorSource(),
        style:  estiloArea,
        zIndex: 1
      })

      prediosLayerRef.current = new VectorLayer({
        source: new VectorSource(),
        style:  (feature) => estiloPredioPorEstado(feature.get('estado')),
        zIndex: 2
      })

      mapInstance.current = new Map({
        target: mapRef.current,
        layers: [
          new TileLayer({ source: new OSM() }),
          areaLayerRef.current,
          prediosLayerRef.current
        ],
        view: new View({
          center: fromLonLat([-74.09, 4.71]),
          zoom:   13
        })
      })

      const selectInteraction = new Select({ condition: click })
      selectInteraction.on('select', (e) => {
        if (e.selected.length > 0) {
          const props = e.selected[0].getProperties()
          setPredioActivo(props?.npn ? props : null)
        } else {
          setPredioActivo(null)
        }
      })
      mapInstance.current.addInteraction(selectInteraction)

      mapInstance.current.on('pointermove', (e) => {
        const hit = mapInstance.current.hasFeatureAtPixel(e.pixel)
        mapInstance.current.getTargetElement().style.cursor = hit ? 'pointer' : ''
      })

      if (predios.length > 0 && !geojsonCargado.current) {
        cargarGeojson()
        cargarArea()
      }
    }

    setTimeout(() => {
      mapInstance.current?.updateSize()
      const source = prediosLayerRef.current?.getSource()
      if (source && source.getFeatures().length > 0) {
        mapInstance.current.getView().fit(source.getExtent(), {
          padding: [5, 5, 5, 50]
        })
      }
    }, 50)
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cargar GeoJSON de predios ────────────────────────────
  const cargarGeojson = useCallback(async () => {
    if (geojsonCargado.current) return
    try {
      const { data } = await api.get(`/proyectos/${id}/geojson`)
      if (!data?.features?.length) return

      const source = prediosLayerRef.current.getSource()
      source.clear()
      const features = new GeoJSON().readFeatures(data, {
        featureProjection: 'EPSG:3857',
        dataProjection:    'EPSG:4326'
      })
      source.addFeatures(features)
      geojsonCargado.current = true

      mapInstance.current?.updateSize()
      mapInstance.current?.getView().fit(source.getExtent(), {
        padding: [5, 5, 5, 5]
      })
    } catch {
      // sin geojson — no crítico
    }
  }, [id])

  // ── Cargar área del proyecto ─────────────────────────────
  const cargarArea = useCallback(async () => {
    if (areaCargada.current) return
    try {
      const { data } = await api.get(`/proyectos/${id}/area`)
      const source = areaLayerRef.current.getSource()
      source.clear()
      const features = new GeoJSON().readFeatures(data, {
        featureProjection: 'EPSG:3857',
        dataProjection:    'EPSG:4326'
      })
      source.addFeatures(features)
      areaCargada.current = true
      setTieneArea(true)
    } catch {
      setTieneArea(false)
    }
  }, [id])

  useEffect(() => {
    if (tab === 1 && mapInstance.current && predios.length > 0 && !geojsonCargado.current) {
      cargarGeojson()
      cargarArea()
    }
  }, [predios, tab, cargarGeojson, cargarArea])

  useEffect(() => {
    return () => {
      if (mapInstance.current) {
        mapInstance.current.setTarget(null)
        mapInstance.current = null
      }
    }
  }, [])

  // ── Columnas tabla ───────────────────────────────────────
  const columnas = [
    { field: 'npn',           headerName: 'NPN',             width: 200 },
    { field: 'nombre_predio', headerName: 'Identificación',  width: 200 },
    { field: 'municipio',     headerName: 'Municipio',       width: 140 },
    { field: 'responsable',   headerName: 'Responsable',     width: 180 },
    {
      field: 'estado', headerName: 'Estado', width: 120,
      renderCell: ({ value }) => (
        <Chip label={value} size="small" color={chipEstado[value] || 'default'} />
      )
    },
    {
      field: 'ultima_sync_offline',
      headerName: 'Última sync',
      width: 160,
      renderCell: ({ value }) => {
        if (!value) return <Typography variant="caption" color="text.secondary">—</Typography>
        const fecha = new Date(value)
        const horasDesde = (Date.now() - fecha.getTime()) / 36e5
        const reciente = horasDesde < 24
        return (
          <Chip
            size="small"
            color={reciente ? 'success' : 'default'}
            label={fecha.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
          />
        )
      },
    },
    {
      field: '__fotos',
      headerName: 'Fotos',
      width: 80,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        <Tooltip title="Ver fotos del predio">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setModalFotos({ open: true, idOperacion: row.id_operacion })
            }}
          >
            <PhotoLibraryIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ]

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/asignaciones')}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FolderIcon color="primary" />
            <Typography variant="h5" fontWeight={600}>
              {proyecto?.clave_proyecto}
            </Typography>
            <Chip
              label={proyecto?.estado}
              size="small"
              color={
                proyecto?.estado === 'campo'        ? 'warning'  :
                proyecto?.estado === 'sincronizado' ? 'primary'  :
                proyecto?.estado === 'validacion'   ? 'info'     :
                proyecto?.estado === 'finalizado'   ? 'success'  : 'default'
              }
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {proyecto?.descripcion || 'Sin descripción'}
          </Typography>
        </Box>

        {/* ── Botones header (dos filas) ── */}
        <Stack direction="column" spacing={1} alignItems="flex-end">

          {/* Fila 1: Descargar área + Asignar predios (último) */}
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              color="secondary"
              startIcon={descargandoQGZ ? <CircularProgress size={16} /> : <MapIcon />}
              onClick={handleDescargarQGZ}
              disabled={descargandoQGZ || procesandoCloud}
            >
              {descargandoQGZ ? 'Descargando...' : 'Descargar área'}
            </Button>
            {puedeAdmin && (
              <Tooltip
                title={
                  proyecto?.estado !== 'campo'
                    ? `Solo se pueden asignar predios en estado 'campo' (actual: '${proyecto?.estado}')`
                    : ''
                }
              >
                <span>
                  <Button
                    variant="contained"
                    startIcon={<AssignmentIcon />}
                    onClick={() => setModalMetodo(true)}
                    disabled={procesandoCloud || proyecto?.estado !== 'campo'}
                  >
                    Asignar predios
                  </Button>
                </span>
              </Tooltip>
            )}
          </Stack>

          {/* Fila 2: estado + offline (Regenerar → Descargar → Cargar) */}
          <Stack direction="row" spacing={1} alignItems="center">
            {['pendiente', 'procesando'].includes(estadoOffline?.estado_generacion) && (
              <Tooltip title="Cancelar generación">
                <Chip
                  size="small"
                  color="info"
                  icon={<CircularProgress size={14} sx={{ color: 'inherit' }} />}
                  label={`Generando… ${estadoOffline?.progreso ?? 0}%`}
                  onDelete={handleCancelarOperacion}
                />
              </Tooltip>
            )}
            {estadoOffline?.estado_generacion === 'error' && (
              <Chip size="small" color="error" label="Error generando" />
            )}

            {/* Chip de progreso de operación con QField Cloud */}
            {cloudStatus?.operacion_en_curso && (
              <Tooltip title={
                cloudStatus.operacion_archivos_total > 0
                  ? `${cloudStatus.operacion_archivos_procesados} de ${cloudStatus.operacion_archivos_total} archivos`
                  : ''
              }>
                <Chip
                  size="small"
                  color={cloudStatus.operacion_en_curso === 'subir' ? 'info' : 'warning'}
                  icon={<CircularProgress size={14} sx={{ color: 'inherit' }} />}
                  label={
                    cloudStatus.operacion_en_curso === 'subir'
                      ? `Subiendo… ${cloudStatus.operacion_progreso ?? 0}%`
                      : `Sincronizando… ${cloudStatus.operacion_progreso ?? 0}%`
                  }
                />
              </Tooltip>
            )}
  {/*
            <Button
              variant="outlined"
              color="warning"
              startIcon={generandoOffline ? <CircularProgress size={16} /> : <BuildIcon />}
              onClick={() => generarProyectoOffline(false)}
              disabled={
                generandoOffline ||
                procesandoCloud ||
                ['pendiente', 'procesando'].includes(estadoOffline?.estado_generacion)
              }
            >
              {generandoOffline
                ? 'Procesando...'
                : estadoOffline?.estado_generacion === 'terminado' || estadoOffline?.estado_generacion === 'error'
                  ? 'Regenerar offline'
                  : 'Generar offline'}
            </Button>*/}
            

            {estadoOffline?.estado_generacion === 'terminado' && estadoOffline?.archivo_existe && (
              <Button
                variant="outlined"
                startIcon={descargando ? <CircularProgress size={16} /> : <DownloadIcon />}
                onClick={handleDescargar}
                disabled={descargando || procesandoCloud}
              >
                {descargando ? 'Descargando...' : 'Descargar offline'}
              </Button>
            )}
          {/*
            {puedeAdmin && (
              <Button
                variant="outlined"
                color="primary"
                startIcon={<UploadIcon />}
                onClick={abrirModalCargarOffline}
                disabled={procesandoCloud}
              >
                Cargar offline
              </Button>
            )}
            */}

            {/* Sincronizar offline: cierre del ciclo, trae los cambios
                editados en QField de vuelta a la base de datos. */}
            {puedeAdmin && (
              <Tooltip title="Subir un .zip editado en QField y aplicar los cambios a la base de datos">
                <span>
                  <Button
                    variant="outlined"
                    color="success"
                    startIcon={<PublishIcon />}
                    onClick={() => setModalAplicarOffline(true)}
                    disabled={procesandoCloud}
                  >
                    Sincronizar offline
                  </Button>
                </span>
              </Tooltip>
            )}

            {/* ── QField Cloud: botón único "Sincronizar" ──────────────
                  Un solo botón que hace todo según el estado:
                    - Si no está en cloud → sube y crea el proyecto
                    - Si está en cloud con cambios del campo → pull
                    - Si fue borrado de cloud → lo recrea (backend lo detecta)
                  El backend decide qué hacer; el UI solo dispara la acción. */}
          {/*   {puedeAdmin
              && cloudStatus?.existe_offline_local
              && cloudStatus?.estado_proyecto === 'terminado'
              && !cloudStatus?.operacion_en_curso && (
                <Tooltip
                  title={
                    cloudStatus?.ultima_sincronizacion
                      ? `Última: ${new Date(cloudStatus.ultima_sincronizacion).toLocaleString()}` +
                        (cloudStatus?.cloud_updated_at
                          ? ` · Campo: ${new Date(cloudStatus.cloud_updated_at).toLocaleString()}`
                          : '')
                      : 'Aún no sincronizado con QField Cloud'
                  }
                >
                  <span>
                   <Button
                      variant="outlined"
                      color={cloudStatus?.sincronizaciones_pendientes ? 'warning' : 'primary'}
                      startIcon={procesandoCloud
                        ? <CircularProgress size={16} />
                        : (cloudStatus?.existe_en_cloud ? <SyncIcon /> : <CloudUploadIcon />)
                      }
                      onClick={handleSincronizarCloud}
                      disabled={procesandoCloud}
                    >
                      {procesandoCloud ? 'Procesando...' : 'Sincronizar con QField Cloud'}
                    </Button>
             
                  </span>       
                </Tooltip>
            )}*/}
          </Stack>

        </Stack>
      </Box>

      {/* Alertas */}
      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Resumen */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={3}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PersonIcon color="action" fontSize="small" />
                <Box>
                  <Typography variant="caption" color="text.secondary">Responsable</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {proyecto?.responsable || 'Sin asignar'}
                  </Typography>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">Total predios</Typography>
                <Typography variant="body2" fontWeight={500}>{predios.length}</Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">En campo</Typography>
                <Typography variant="body2" fontWeight={500} color="warning.main">
                  {predios.filter(p => p.estado === 'campo').length}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">Finalizados</Typography>
                <Typography variant="body2" fontWeight={500} color="success.main">
                  {predios.filter(p => p.estado === 'finalizado').length}
                </Typography>
              </Box>
            </Grid>

            {/* Última sincronización offline (paquete entero) */}
            <Grid item xs={12} sm={6}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Última sincronización offline
                </Typography>
                <Typography variant="body2" fontWeight={500}>
                  {proyecto?.ultima_sincronizacion_offline
                    ? new Date(proyecto.ultima_sincronizacion_offline).toLocaleString('es-CO', {
                        dateStyle: 'medium', timeStyle: 'short',
                      })
                    : <span style={{ color: '#888' }}>Nunca sincronizado</span>}
                </Typography>
                {historialSync.length > 0 && (
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<HistoryIcon fontSize="small" />}
                    onClick={() => setMostrarHistorial(v => !v)}
                    sx={{ mt: 0.5, textTransform: 'none', minWidth: 0, p: 0.5 }}
                  >
                    {mostrarHistorial ? 'Ocultar' : 'Ver'} historial de sincronización ({historialSync.length})
                  </Button>
                )}
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Historial de sincronizaciones offline (sólo cuando el usuario lo pidió) */}
      {mostrarHistorial && historialSync.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <HistoryIcon color="action" fontSize="small" />
              <Typography variant="subtitle2">
                Historial de sincronizaciones offline ({historialSync.length})
              </Typography>
            </Box>
            <DataGrid
              autoHeight
              density="compact"
              rows={historialSync}
              columns={columnasHistorialSync({ onAbrirDetalle: (id) => setModalDetalleSync({ open: true, syncId: id }) })}
              pageSizeOptions={[5, 10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 5 } } }}
              disableRowSelectionOnClick
              getRowId={(r) => r.id}
            />
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab icon={<TableChartIcon />} iconPosition="start" label="Tabla" />
        <Tab icon={<MapIcon />}        iconPosition="start" label="Mapa"  />
      </Tabs>

      {/* ── Tab Tabla ── */}
      {tab === 0 && (
        <DataGrid
          rows={predios}
          columns={columnas}
          autoHeight
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          disableRowSelectionOnClick
          sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
        />
      )}

      {/* ── Tab Mapa — siempre en DOM, visibilidad por CSS ── */}
      <Box sx={{ display: tab === 1 ? 'flex' : 'none', gap: 2 }}>
        <Box sx={{
          flexGrow: 1,
          height:   MAP_HEIGHT,
          borderRadius: 2,
          overflow: 'hidden',
          position: 'relative',
          border: '1px solid',
          borderColor: 'divider'
        }}>
          <div ref={mapRef} style={{ width: '100%', height: `${MAP_HEIGHT}px` }} />

          {/* Leyenda */}
          <Card sx={{
            position: 'absolute', bottom: 16, left: 16,
            zIndex: 1000, p: 1.5, minWidth: 150
          }}>
            {tieneArea && (
              <>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{
                    width: 14, height: 14, borderRadius: 0.5,
                    bgcolor: 'rgba(25,118,210,0.08)',
                    border: '2.5px dashed #1976D2'
                  }} />
                  <Typography variant="caption">Área proyecto</Typography>
                </Box>
              </>
            )}
          </Card>
        </Box>

        {/* Panel detalle predio */}
        {predioActivo && (
          <Card sx={{ width: 260, overflow: 'auto', height: MAP_HEIGHT }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={600} mb={1}>
                Detalle del predio
              </Typography>
              <Divider sx={{ mb: 1.5 }} />
              <Stack spacing={1.5}>
                {[
                  { label: 'NPN',        value: predioActivo.npn },
                  { label: 'Nombre',     value: predioActivo.nombre_predio },
                  { label: 'Municipio',  value: predioActivo.municipio },
                  { label: 'Área (m²)',  value: predioActivo.area_terreno
                      ? Number(predioActivo.area_terreno).toFixed(2) : null },
                  { label: 'Avalúo',     value: predioActivo.avaluo_catastral
                      ? `$${Number(predioActivo.avaluo_catastral).toLocaleString('es-CO')}` : null },
                  { label: 'Responsable',value: predioActivo.responsable },
                ].map(({ label, value }) => (
                  <Box key={label}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="body2" fontWeight={500}>{value || '—'}</Typography>
                  </Box>
                ))}
                <Box>
                  <Typography variant="caption" color="text.secondary">Estado</Typography>
                  <Box mt={0.5}>
                    <Chip
                      label={predioActivo.estado}
                      size="small"
                      color={chipEstado[predioActivo.estado] || 'default'}
                    />
                  </Box>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Box>

      {/* Modales */}
      <ModalMetodoAsignacion
        open={modalMetodo}
        onClose={() => setModalMetodo(false)}
        onSelect={(metodo) => {
          setMetodoSelected(metodo)
          setModalMetodo(false)
          setModalMapa(true)
        }}
      />

      <ModalMapaAsignacion
        open={modalMapa}
        onClose={() => setModalMapa(false)}
        metodo={metodoSelected}
        // Inyectamos total_predios desde la lista de predios cargada, porque
        // /proyectos/{id} (get_by_id) no lo devuelve.
        proyecto={proyecto ? { ...proyecto, total_predios: predios.length } : null}
        onAsignar={(total) => {
          mostrarSuccess(`${total} predios asignados — generando proyecto offline...`)
          cargarDatos()
          // Forzamos reemplazo sin preguntar: al actualizar una asignación el
          // offline previo queda obsoleto y SIEMPRE debe regenerarse.
          generarProyectoOffline(true)
        }}
      />

      {/* ── Modal Reemplazar proyecto offline existente ─── */}
      <Dialog
        open={modalReemplazo.open}
        onClose={() => setModalReemplazo({ open: false, proyectoId: null, detalle: null })}
        maxWidth="xs" fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningIcon color="warning" />
            ¿Reemplazar proyecto offline?
          </Box>
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Ya existe un proyecto offline generado
            {modalReemplazo.detalle?.cloud   && ' (con copia en QField Cloud)'}
            {modalReemplazo.detalle?.carpeta && ' (con carpeta local)'}
            {modalReemplazo.detalle?.zip     && ' (con zip de descarga)'}.
            Si continuás se borrará y se generará de cero.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setModalReemplazo({ open: false, proyectoId: null, detalle: null })}>
            Cancelar
          </Button>
          <Button
            variant="contained" color="warning"
            onClick={() => {
              setModalReemplazo({ open: false, proyectoId: null, detalle: null })
              generarProyectoOffline(true)
            }}
          >
            Reemplazar
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Modal Cargar proyecto offline (subir .zip) ───── */}
      <Dialog
        open={modalCargarOffline}
        onClose={cerrarModalCargarOffline}
        maxWidth="sm" fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <UploadIcon color="primary" />
            Cargar proyecto offline
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert
            severity={estadoOffline?.archivo_existe ? 'warning' : 'info'}
            sx={{ mb: 2 }}
          >
            {estadoOffline?.archivo_existe
              ? <>Ya existe un proyecto offline para <strong>{proyecto?.clave_proyecto}</strong>. Si continuás, <strong>será reemplazado por completo</strong>.</>
              : <>El proyecto se extraerá y quedará disponible para descarga offline.</>
            }
          </Alert>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            El archivo debe ser un <code>.zip</code> que contenga un proyecto QGIS (<code>.qgz</code> o <code>.qgs</code>) en su raíz o primera carpeta.
          </Typography>

          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            style={{ display: 'none' }}
            ref={fileInputCargaRef}
            onChange={handleSeleccionarArchivoOffline}
          />
          <Button
            variant="outlined"
            fullWidth
            startIcon={<UploadIcon />}
            onClick={() => fileInputCargaRef.current?.click()}
            disabled={subiendoOffline}
          >
            Seleccionar archivo .zip
          </Button>

          {archivoOfflineSel && (
            <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2">📦 <strong>{archivoOfflineSel.name}</strong></Typography>
              <Typography variant="caption" color="text.secondary">
                {(archivoOfflineSel.size / 1024 / 1024).toFixed(2)} MB
              </Typography>
            </Box>
          )}

          {errorArchivoOffline && (
            <Alert severity="error" sx={{ mt: 2 }}>{errorArchivoOffline}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={cerrarModalCargarOffline} disabled={subiendoOffline}>
            Cancelar
          </Button>
          <Button
            variant="contained" color="warning"
            onClick={handleConfirmarCargarOffline}
            disabled={!archivoOfflineSel || !!errorArchivoOffline || subiendoOffline}
            startIcon={subiendoOffline ? <CircularProgress size={16} /> : <UploadIcon />}
          >
            {subiendoOffline ? 'Cargando...' : 'Cargar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Detalle de un sync histórico (abierto desde la tabla del card historial) */}
      <ModalDetalleSync
        open={modalDetalleSync.open}
        onClose={() => setModalDetalleSync({ open: false, syncId: null })}
        syncId={modalDetalleSync.syncId}
      />

      {/* Galería de fotos del predio (lc_predio_p + cr_caracteristicas...) */}
      <ModalFotosPredio
        open={modalFotos.open}
        onClose={() => setModalFotos({ open: false, idOperacion: null })}
        proyectoId={id}
        idOperacion={modalFotos.idOperacion}
      />

      {/* Modal para aplicar paquete offline editado a PostGIS */}
      <ModalAplicarPaqueteOffline
        open={modalAplicarOffline}
        onClose={() => setModalAplicarOffline(false)}
        proyectoId={id}
        estadoAsignacion={proyecto?.estado}
        esAdmin={user?.roles?.includes('administrador')}
        onAppliedOk={(detalle) => {
          mostrarSuccess(
            `Sync ok: ${
              Object.values(detalle.resumen || {})
                .reduce((acc, r) => acc + (r.added || 0) + (r.updated || 0), 0)
            } cambios aplicados a PostGIS`
          )
          // Refrescar info del proyecto (estado pudo haber cambiado de campo→sincronizado)
          cargarDatos()
          cargarHistorialSync()
        }}
      />

    </Box>
  )
}
