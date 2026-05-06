import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Box, Paper, Stack, Typography, Tabs, Tab, TextField, MenuItem,
  Chip, IconButton, Tooltip, Button, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, AppBar, Toolbar
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import RefreshIcon       from '@mui/icons-material/Refresh'
import VisibilityIcon    from '@mui/icons-material/Visibility'
import HomeWorkIcon      from '@mui/icons-material/HomeWork'
import CloseIcon         from '@mui/icons-material/Close'
import LockIcon          from '@mui/icons-material/Lock'
import BookmarkIcon      from '@mui/icons-material/Bookmark'

import marcasPredioApi from '../api/marcasPredio'
import { useAuth }     from '../hooks/useAuth'
import MarcaDialog     from '../components/marcas/MarcaDialog'
import PredioVisor     from '../components/predio-visor/PredioVisor'
import predioCompletoLectura from '../config/predio-forms/predio-completo-lectura.json'

const META_CATEGORIA = {
  IDENTIFICACION: { color: '#0097A7', label: 'Identificación' },
  SIG:            { color: '#2E7D32', label: 'SIG' },
  FISICA:         { color: '#1565C0', label: 'Física' },
  JURIDICA:       { color: '#6A1B9A', label: 'Jurídica' },
  ECONOMICA:      { color: '#C62828', label: 'Económica' },
}

const META_PRIORIDAD = {
  ALTA:  { color: '#D32F2F', label: 'Alta' },
  MEDIA: { color: '#ED6C02', label: 'Media' },
  BAJA:  { color: '#0288D1', label: 'Baja' },
}

const ROLES_VER_TODAS = ['administrador', 'supervisor', 'coordinador']

const formatearFecha = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function Marcas() {
  const { user, hasRole } = useAuth()
  const puedeVerTodas = ROLES_VER_TODAS.some(r => hasRole(r))

  const [tab,         setTab]         = useState('mias')   // 'mias' | 'todas'
  const [estado,      setEstado]      = useState('ABIERTA')
  const [categoria,   setCategoria]   = useState('')
  const [prioridad,   setPrioridad]   = useState('')
  const [busqueda,    setBusqueda]    = useState('')
  const [marcas,      setMarcas]      = useState([])
  const [cargando,    setCargando]    = useState(false)
  const [error,       setError]       = useState('')
  const [dialogo,     setDialogo]     = useState({ open: false, marca: null })
  const [predioModal, setPredioModal] = useState({ open: false, idOperacion: null, marca: null })
  const [confirmCerrar, setConfirmCerrar] = useState(false)
  const [obsCierre,     setObsCierre]     = useState('')
  const [cerrandoMarca, setCerrandoMarca] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      const data = await marcasPredioApi.listarGlobal({
        solo_mias: tab === 'mias',
        estado:    estado    || undefined,
        categoria: categoria || undefined,
        prioridad: prioridad || undefined,
        q:         busqueda.trim() || undefined,
      })
      setMarcas(data)
    } catch (e) {
      setMarcas([])
      setError(e?.response?.data?.detail || 'No se pudieron cargar las marcas')
    } finally {
      setCargando(false)
    }
  }, [tab, estado, categoria, prioridad, busqueda])

  useEffect(() => { cargar() }, [cargar])

  const onCambiarTab = (_, value) => {
    if (value === 'todas' && !puedeVerTodas) return
    setTab(value)
  }

  const esResponsableDe = useCallback((m) =>
    !!m && m.responsable_id != null && user?.sub != null
      && String(m.responsable_id) === String(user.sub)
  , [user?.sub])

  const abrirPredio = (m) => {
    // Si el user es responsable y la marca está abierta, lleva la marca al modal
    // para activar modo edición + alert con "Cerrar marca".
    const marcaCtx = (m && m.estado === 'ABIERTA' && esResponsableDe(m)) ? m : null
    setPredioModal({ open: true, idOperacion: m.id_operacion, marca: marcaCtx })
  }

  const cerrarPredioModal = () => {
    setPredioModal({ open: false, idOperacion: null, marca: null })
    setConfirmCerrar(false)
    setObsCierre('')
  }

  const ejecutarCierreMarca = async () => {
    if (!predioModal.marca) return
    setCerrandoMarca(true)
    try {
      await marcasPredioApi.cerrar(predioModal.idOperacion, predioModal.marca.id, obsCierre || null)
      setConfirmCerrar(false)
      setObsCierre('')
      // Después de cerrar, el modal vuelve a modo lectura y refrescamos la lista
      setPredioModal(prev => ({ ...prev, marca: null }))
      cargar()
    } catch (e) {
      setError(e?.response?.data?.detail || 'No se pudo cerrar la marca')
    } finally {
      setCerrandoMarca(false)
    }
  }

  const columnas = useMemo(() => {
    const cols = [
      {
        field: 'predio',
        headerName: 'Predio',
        flex: 1.1, minWidth: 200, sortable: false,
        renderCell: ({ row }) => (
          <Stack sx={{ py: 0.5 }}>
            <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.2 }}>
              {row.id_operacion}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
              {row.npn || '— sin NPN —'}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'tipo_marca',
        headerName: 'Tipo de marca',
        flex: 1.3, minWidth: 220, sortable: false,
        renderCell: ({ row }) => (
          <Stack sx={{ py: 0.5 }}>
            <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.2 }}>
              {row.tipo_marca_codigo}
            </Typography>
            <Typography variant="caption" color="text.secondary"
              sx={{ lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {row.tipo_marca_significado}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'categoria',
        headerName: 'Categoría',
        width: 130, sortable: false,
        renderCell: ({ value }) => {
          const meta = META_CATEGORIA[value] || { color: '#616161', label: value }
          return (
            <Chip
              size="small" label={meta.label}
              sx={{ bgcolor: meta.color, color: 'white', fontWeight: 600 }}
            />
          )
        },
      },
      {
        field: 'prioridad',
        headerName: 'Prioridad',
        width: 100, sortable: false,
        renderCell: ({ value }) => {
          const meta = META_PRIORIDAD[value] || { color: '#616161', label: value }
          return (
            <Chip
              size="small" label={meta.label}
              sx={{ bgcolor: meta.color, color: 'white', fontWeight: 600 }}
            />
          )
        },
      },
      {
        field: 'estado',
        headerName: 'Estado',
        width: 110, sortable: false,
        renderCell: ({ value }) => (
          <Chip
            size="small"
            label={value === 'CERRADA' ? 'Cerrada' : 'Abierta'}
            color={value === 'CERRADA' ? 'default' : 'success'}
          />
        ),
      },
    ]
    if (tab === 'todas') {
      cols.push({
        field: 'responsable_nombre',
        headerName: 'Responsable',
        flex: 1, minWidth: 160, sortable: false,
        renderCell: ({ value }) => value
          ? <Typography variant="body2">{value}</Typography>
          : <Typography variant="caption" color="text.disabled">— sin asignar —</Typography>,
      })
    }
    cols.push({
      field: 'fecha_creacion',
      headerName: 'Creada',
      width: 170, sortable: false,
      valueFormatter: (v) => formatearFecha(v),
    })
    cols.push({
      field: 'acciones',
      headerName: 'Acciones',
      width: 150, sortable: false, filterable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Ver detalle de la marca">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setDialogo({ open: true, marca: row }) }}>
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Ver datos del predio">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); abrirPredio(row) }}>
              <HomeWorkIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    })
    return cols
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const marcaAbierta = predioModal.marca   // ya validado: solo se setea si user es responsable + ABIERTA
  const metaMarca    = marcaAbierta ? META_CATEGORIA[marcaAbierta.categoria] : null

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={2}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>Marcas</Typography>
        <Tooltip title="Recargar">
          <span>
            <IconButton onClick={cargar} disabled={cargando}>
              {cargando ? <CircularProgress size={18} /> : <RefreshIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={onCambiarTab}>
          <Tab value="mias"  label="Mis marcas" />
          {puedeVerTodas && <Tab value="todas" label="Todas las marcas" />}
        </Tabs>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            select size="small" label="Estado"
            value={estado} onChange={(e) => setEstado(e.target.value)}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="ABIERTA">Abiertas</MenuItem>
            <MenuItem value="CERRADA">Cerradas</MenuItem>
          </TextField>
          <TextField
            select size="small" label="Categoría"
            value={categoria} onChange={(e) => setCategoria(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">Todas</MenuItem>
            {Object.entries(META_CATEGORIA).map(([k, v]) => (
              <MenuItem key={k} value={k}>{v.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select size="small" label="Prioridad"
            value={prioridad} onChange={(e) => setPrioridad(e.target.value)}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">Todas</MenuItem>
            {Object.entries(META_PRIORIDAD).map(([k, v]) => (
              <MenuItem key={k} value={k}>{v.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small" label="Buscar por id_operacion o NPN"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            sx={{ flexGrow: 1, minWidth: 240 }}
          />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ height: 'calc(100vh - 320px)', minHeight: 400 }}>
        <DataGrid
          rows={marcas}
          columns={columnas}
          getRowId={(r) => r.id}
          loading={cargando}
          disableColumnMenu
          rowHeight={56}
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
          onRowClick={({ row }) => setDialogo({ open: true, marca: row })}
          sx={{
            border: 0,
            '& .MuiDataGrid-row': { cursor: 'pointer' },
          }}
          localeText={{
            noRowsLabel: tab === 'mias'
              ? 'No tienes marcas asignadas con estos filtros'
              : 'No se encontraron marcas con estos filtros',
          }}
        />
      </Paper>

      {/* ── Modal: detalle de la marca (timeline + acciones) ─────────── */}
      <MarcaDialog
        open={dialogo.open}
        modo="detalle"
        categoria={dialogo.marca?.categoria}
        idOperacion={dialogo.marca?.id_operacion}
        marca={dialogo.marca}
        puedeGestionar={(() => {
          if (!dialogo.marca) return false
          const esAdmin = hasRole('administrador') || hasRole('supervisor')
          if (esAdmin) return true
          return esResponsableDe(dialogo.marca) && dialogo.marca.estado === 'ABIERTA'
        })()}
        onClose={() => setDialogo({ open: false, marca: null })}
        onChange={() => { cargar() }}
      />

      {/* ── Modal: visor del predio dentro de la página de marcas ────── */}
      <Dialog
        open={predioModal.open}
        onClose={cerrarPredioModal}
        fullScreen
        PaperProps={{ sx: { bgcolor: 'background.default' } }}
      >
        <AppBar position="sticky" color="default" elevation={1}>
          <Toolbar sx={{ gap: 2 }}>
            <HomeWorkIcon color="primary" />
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ lineHeight: 1.2 }}>
                Predio {predioModal.idOperacion}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {marcaAbierta
                  ? 'Edición habilitada por marca asignada — usa el botón "Editar"'
                  : 'Vista de solo lectura'}
              </Typography>
            </Box>
            <IconButton onClick={cerrarPredioModal} edge="end">
              <CloseIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        <DialogContent sx={{ p: 3 }}>
          {marcaAbierta && (
            <Alert
              icon={<BookmarkIcon />}
              severity="info"
              sx={{
                mb: 2,
                borderLeft: '4px solid',
                borderLeftColor: metaMarca?.color || 'primary.main',
                '& .MuiAlert-message': { width: '100%' }
              }}
            >
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
                <Box sx={{ flexGrow: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="body2" fontWeight={700}>
                      Estás atendiendo la marca {marcaAbierta.tipo_marca_codigo}
                    </Typography>
                    <Chip
                      size="small" label={metaMarca?.label || marcaAbierta.categoria}
                      sx={{ bgcolor: metaMarca?.color, color: 'white', fontWeight: 600 }}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {marcaAbierta.descripcion_novedad}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small" variant="outlined"
                    startIcon={<VisibilityIcon />}
                    onClick={() => setDialogo({ open: true, marca: marcaAbierta })}
                  >
                    Ver detalle
                  </Button>
                  <Button
                    size="small" variant="contained" color="error"
                    startIcon={<LockIcon />}
                    onClick={() => setConfirmCerrar(true)}
                  >
                    Cerrar marca
                  </Button>
                </Stack>
              </Stack>
            </Alert>
          )}

          {predioModal.idOperacion && (
            <PredioVisor
              formConfig={predioCompletoLectura}
              busqueda={predioModal.idOperacion}
              bypassRolesEdicion={!!marcaAbierta}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Confirmación rápida de cierre de marca ───────────────────── */}
      <Dialog open={confirmCerrar} onClose={() => !cerrandoMarca && setConfirmCerrar(false)} fullWidth maxWidth="sm">
        <DialogTitle>Cerrar marca</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Vas a cerrar la marca {marcaAbierta?.tipo_marca_codigo}. Esta acción queda registrada en el historial.
          </Typography>
          <TextField
            label="Observación del cierre (opcional)"
            fullWidth multiline rows={3}
            value={obsCierre}
            onChange={(e) => setObsCierre(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCerrar(false)} disabled={cerrandoMarca}>Cancelar</Button>
          <Button
            variant="contained" color="error"
            onClick={ejecutarCierreMarca} disabled={cerrandoMarca}
            startIcon={cerrandoMarca ? <CircularProgress size={14} color="inherit" /> : <LockIcon />}
          >
            Confirmar cierre
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
