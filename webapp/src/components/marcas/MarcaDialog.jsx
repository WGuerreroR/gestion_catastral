import { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton,
  Box, Typography, TextField, Button, MenuItem, Stack, Chip, Divider,
  CircularProgress, Alert, Grid, InputLabel, FormControl, Select,
  Paper, ToggleButton, ToggleButtonGroup, Avatar
} from '@mui/material'
import CloseIcon            from '@mui/icons-material/Close'
import AddCircleIcon        from '@mui/icons-material/AddCircle'
import LockIcon             from '@mui/icons-material/Lock'
import LockOpenIcon         from '@mui/icons-material/LockOpen'
import HistoryIcon          from '@mui/icons-material/History'
import LabelImportantIcon   from '@mui/icons-material/LabelImportant'
import FlagIcon             from '@mui/icons-material/Flag'
import AssignmentIndIcon    from '@mui/icons-material/AssignmentInd'
import NotesIcon            from '@mui/icons-material/Notes'
import BadgeIcon            from '@mui/icons-material/Badge'
import MapIcon              from '@mui/icons-material/Map'
import TerrainIcon          from '@mui/icons-material/Terrain'
import GavelIcon            from '@mui/icons-material/Gavel'
import AttachMoneyIcon      from '@mui/icons-material/AttachMoney'
import api                  from '../../api/axios'
import marcasPredioApi      from '../../api/marcasPredio'

const PRIORIDADES        = ['ALTA', 'MEDIA', 'BAJA']
const ESTADOS_ESPERADOS  = ['AJUSTE', 'ANALISIS', 'CAMPO', 'DOCUMENTAL', 'OFICINA', 'VERIFICACION']

const META_CATEGORIA = {
  IDENTIFICACION: { color: '#0097A7', icon: <BadgeIcon /> },
  SIG:            { color: '#2E7D32', icon: <MapIcon /> },
  FISICA:         { color: '#1565C0', icon: <TerrainIcon /> },
  JURIDICA:       { color: '#6A1B9A', icon: <GavelIcon /> },
  ECONOMICA:      { color: '#C62828', icon: <AttachMoneyIcon /> },
}

const META_PRIORIDAD = {
  ALTA:  { label: 'Alta',  bg: '#D32F2F', text: 'white' },
  MEDIA: { label: 'Media', bg: '#ED6C02', text: 'white' },
  BAJA:  { label: 'Baja',  bg: '#0288D1', text: 'white' },
}

const COLOR_EVENTO = {
  CREACION:   { color: '#2E7D32', label: 'Creada',    icon: <AddCircleIcon fontSize="small" /> },
  CIERRE:     { color: '#C62828', label: 'Cerrada',   icon: <LockIcon fontSize="small" /> },
  REAPERTURA: { color: '#F57C00', label: 'Reabierta', icon: <LockOpenIcon fontSize="small" /> },
}

const titleCase = (s) => s ? s.charAt(0) + s.slice(1).toLowerCase() : ''

function formatearFechaHora(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function fechaRelativa(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.round(diff / 60000)
  if (min < 1)    return 'hace instantes'
  if (min < 60)   return `hace ${min} min`
  const horas = Math.round(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias  = Math.round(horas / 24)
  if (dias < 30)  return `hace ${dias} d`
  const meses = Math.round(dias / 30)
  return `hace ${meses} mes${meses === 1 ? '' : 'es'}`
}

const ESTADO_INICIAL = {
  tipo_marca_id:       '',
  descripcion_novedad: '',
  fuente_deteccion:    '',
  prioridad:           'MEDIA',
  accion_sugerida:     '',
  responsable_id:      '',
  estado_esperado:     'ANALISIS',
  observacion:         '',
}

// ── Subcomponente reutilizable: encabezado de sección ─────────────────────
function SeccionHeader({ icon, titulo, color = 'action' }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.75} mb={1.5}>
      <Box sx={{ color, display: 'flex' }}>{icon}</Box>
      <Typography
        variant="overline"
        sx={{ fontWeight: 700, letterSpacing: 0.5, color: 'text.secondary', lineHeight: 1 }}
      >
        {titulo}
      </Typography>
    </Stack>
  )
}

// ── Botones segmentados con color por opción ──────────────────────────────
function PrioridadSelector({ value, onChange, disabled }) {
  return (
    <ToggleButtonGroup
      size="small" exclusive
      value={value}
      onChange={(_, v) => v && onChange(v)}
      disabled={disabled}
      sx={{ '& .MuiToggleButton-root': { px: 2, fontWeight: 600 } }}
    >
      {PRIORIDADES.map(p => {
        const meta = META_PRIORIDAD[p]
        return (
          <ToggleButton
            key={p} value={p}
            sx={{
              borderColor: meta.bg,
              color: meta.bg,
              '&.Mui-selected': {
                bgcolor: meta.bg, color: meta.text,
                '&:hover': { bgcolor: meta.bg, opacity: 0.9 },
              },
            }}
          >
            {meta.label}
          </ToggleButton>
        )
      })}
    </ToggleButtonGroup>
  )
}

function EstadoEsperadoSelector({ value, onChange, disabled }) {
  return (
    <ToggleButtonGroup
      size="small" exclusive
      value={value}
      onChange={(_, v) => v && onChange(v)}
      disabled={disabled}
      sx={{
        flexWrap: 'wrap',
        '& .MuiToggleButton-root': { px: 1.5, py: 0.5, textTransform: 'none', fontWeight: 500, fontSize: '0.8rem' },
      }}
    >
      {ESTADOS_ESPERADOS.map(e => (
        <ToggleButton key={e} value={e}>{titleCase(e)}</ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

// ─────────────────────────────────────────────────────────────────────────
export default function MarcaDialog({
  open, modo, categoria, idOperacion, marca, puedeGestionar,
  onClose, onChange,
}) {
  const esCrear = modo === 'crear'
  const meta    = META_CATEGORIA[categoria] || { color: '#616161', icon: null }

  const [tipos, setTipos]               = useState([])
  const [personas, setPersonas]         = useState([])
  const [eventos, setEventos]           = useState([])
  const [form, setForm]                 = useState(ESTADO_INICIAL)
  const [error, setError]               = useState('')
  const [guardando, setGuardando]       = useState(false)
  const [accionActiva, setAccionActiva] = useState(null) // 'cerrar' | 'reabrir'
  const [obsAccion, setObsAccion]       = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setAccionActiva(null)
    setObsAccion('')

    if (esCrear) {
      setForm(ESTADO_INICIAL)
      api.get('/tipos-marca/', { params: { categoria } }).then(r => setTipos(r.data || []))
      api.get('/personas/').then(r => {
        const lista = (r.data || []).filter(p =>
          p.activo && !(p.roles || []).includes('administrador')
        )
        setPersonas(lista)
      })
    } else if (marca) {
      setForm({
        tipo_marca_id:       marca.tipo_marca_id,
        descripcion_novedad: marca.descripcion_novedad || '',
        fuente_deteccion:    marca.fuente_deteccion || '',
        prioridad:           marca.prioridad,
        accion_sugerida:     marca.accion_sugerida || '',
        responsable_id:      marca.responsable_id || '',
        estado_esperado:     marca.estado_esperado,
        observacion:         marca.observacion || '',
      })
      marcasPredioApi.eventos(idOperacion, marca.id).then(setEventos).catch(() => setEventos([]))
    }
  }, [open, esCrear, marca, categoria, idOperacion])

  const handleCambio = (campo) => (e) => {
    setForm(prev => ({ ...prev, [campo]: e.target.value }))
  }
  const setCampo = (campo) => (valor) => {
    setForm(prev => ({ ...prev, [campo]: valor }))
  }

  const handleCrear = async () => {
    if (!form.tipo_marca_id)               return setError('Selecciona un tipo de marca')
    if (!form.descripcion_novedad.trim())  return setError('La descripción de la novedad es obligatoria')

    setGuardando(true)
    setError('')
    try {
      await marcasPredioApi.crear(idOperacion, {
        ...form,
        categoria,
        responsable_id:   form.responsable_id || null,
        fuente_deteccion: form.fuente_deteccion || null,
        accion_sugerida:  form.accion_sugerida  || null,
        observacion:      form.observacion      || null,
      })
      onChange?.()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Error al guardar la marca')
    } finally {
      setGuardando(false)
    }
  }

  const ejecutarAccion = async () => {
    setGuardando(true)
    setError('')
    try {
      if (accionActiva === 'cerrar') {
        await marcasPredioApi.cerrar(idOperacion, marca.id, obsAccion || null)
      } else if (accionActiva === 'reabrir') {
        await marcasPredioApi.reabrir(idOperacion, marca.id, obsAccion || null)
      }
      onChange?.()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Error al cambiar el estado')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { borderRadius: 2 } }}
    >
      {/* ── Encabezado con acento por categoría ────────────────────────── */}
      <Box sx={{
        bgcolor: meta.color,
        height: 6,
      }} />

      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5 }}>
        <Avatar sx={{ bgcolor: meta.color, width: 40, height: 40 }}>
          {meta.icon}
        </Avatar>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
            {esCrear ? 'Nueva marca' : `Marca ${marca?.tipo_marca_codigo}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Categoría {titleCase(categoria)}
          </Typography>
        </Box>
        {!esCrear && (
          <Chip
            size="small"
            label={marca?.estado === 'CERRADA' ? 'Cerrada' : 'Abierta'}
            color={marca?.estado === 'CERRADA' ? 'default' : 'success'}
            icon={marca?.estado === 'CERRADA' ? <LockIcon /> : undefined}
            sx={{ fontWeight: 600 }}
          />
        )}
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'grey.50', p: 2.5 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        {/* ── 1. Identificación ─────────────────────────────────────────── */}
        <Paper variant="outlined" sx={{ p: 2.5, mb: 2, borderRadius: 2 }}>
          <SeccionHeader icon={<LabelImportantIcon fontSize="small" />} titulo="Tipo y descripción" />

          <Grid container spacing={2}>
            <Grid item xs={12}>
              <FormControl fullWidth size="small" disabled={!esCrear} required={esCrear}>
                <InputLabel>Tipo de marca</InputLabel>
                <Select
                  label="Tipo de marca"
                  value={form.tipo_marca_id || ''}
                  onChange={handleCambio('tipo_marca_id')}
                   sx={{ minWidth: 250 }} 
                >
                  {esCrear
                    ? tipos.map(t => (
                        <MenuItem key={t.id} value={t.id}>
                          <Stack>
                            <Typography variant="body2" fontWeight={600}>{t.significado}</Typography>
                            <Typography variant="caption" color="text.secondary">{t.codigo}</Typography>
                          </Stack>
                        </MenuItem>
                      ))
                    : marca && (
                        <MenuItem value={marca.tipo_marca_id}>
                          {marca.tipo_marca_codigo} — {marca.tipo_marca_significado}
                        </MenuItem>
                      )
                  }
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Descripción de la posible novedad"
                placeholder="¿Qué se observó? Sé concreto en máximo 2-3 líneas."
                fullWidth size="small" multiline rows={3}
                value={form.descripcion_novedad}
                onChange={handleCambio('descripcion_novedad')}
                disabled={!esCrear}
                required={esCrear}
                 sx={{ minWidth: 400 }} 
              />
            </Grid>
          </Grid>
        </Paper>

        {/* ── 2. Clasificación ──────────────────────────────────────────── */}
        <Paper variant="outlined" sx={{ p: 2.5, mb: 2, borderRadius: 2 }}>
          <SeccionHeader icon={<FlagIcon fontSize="small" />} titulo="Clasificación" />

          <Stack spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                Prioridad
              </Typography>
              <PrioridadSelector
                value={form.prioridad}
                onChange={setCampo('prioridad')}
                disabled={!esCrear}
              />
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                Estado esperado de la gestión
              </Typography>
              <EstadoEsperadoSelector
                value={form.estado_esperado}
                onChange={setCampo('estado_esperado')}
                disabled={!esCrear}
              />
            </Box>

            <TextField
              label="Fuente de detección"
              placeholder="Ej. Reporte de campo, denuncia, control de calidad…"
              fullWidth size="small"
              value={form.fuente_deteccion}
              onChange={handleCambio('fuente_deteccion')}
              disabled={!esCrear}
            />
          </Stack>
        </Paper>

        {/* ── 3. Asignación y seguimiento ───────────────────────────────── */}
        <Paper variant="outlined" sx={{ p: 2.5, mb: 2, borderRadius: 2 }}>
          <SeccionHeader icon={<AssignmentIndIcon fontSize="small" />} titulo="Asignación y seguimiento" />

          <Stack spacing={2}>
          <FormControl fullWidth size="small" disabled={!esCrear}>
            <InputLabel shrink>Responsable</InputLabel>

            <Select
              label="Responsable"
              value={form.responsable_id || ''}
              onChange={handleCambio('responsable_id')}
              displayEmpty
              renderValue={(val) => {
                if (!val) return <em>— Sin asignar —</em>
                if (esCrear) {
                  const p = personas.find(x => x.id === val)
                  return p ? `${p.primer_nombre} ${p.primer_apellido}` : ''
                }
                return marca?.responsable_nombre || ''
              }}
            >
              <MenuItem value="">
                <em>— Sin asignar —</em>
              </MenuItem>

              {esCrear
                ? personas.map(p => {
                    const rolesVisibles = (p.roles || []).filter(r => r !== 'administrador')
                    return (
                      <MenuItem key={p.id} value={p.id} sx={{ alignItems: 'flex-start', py: 0.75 }}>
                        <Stack sx={{ width: '100%' }}>
                          <Typography variant="body2" component="span" fontWeight={500}>
                            {p.primer_nombre} {p.primer_apellido}
                          </Typography>
                          <Stack direction="row" spacing={0.5} mt={0.25} flexWrap="wrap" useFlexGap>
                            {rolesVisibles.length > 0
                              ? rolesVisibles.map(r => (
                                  <Chip
                                    key={r} label={r} size="small" variant="outlined"
                                    sx={{ height: 18, fontSize: '0.7rem', textTransform: 'capitalize' }}
                                  />
                                ))
                              : (
                                  <Typography variant="caption" color="text.disabled" component="span">
                                    sin rol asignado
                                  </Typography>
                                )
                            }
                          </Stack>
                        </Stack>
                      </MenuItem>
                    )
                  })
                : marca?.responsable_id && (
                    <MenuItem value={marca.responsable_id}>
                      {marca.responsable_nombre}
                    </MenuItem>
                  )
              }
            </Select>
          </FormControl>

            <TextField
              label="Acción sugerida"
              placeholder="¿Qué se debería hacer para resolver la novedad?"
              fullWidth size="small" multiline rows={2}
              value={form.accion_sugerida}
              onChange={handleCambio('accion_sugerida')}
              disabled={!esCrear}
            />
          </Stack>
        </Paper>

        {/* ── 4. Observación ────────────────────────────────────────────── */}
        <Paper variant="outlined" sx={{ p: 2.5, mb: 0, borderRadius: 2 }}>
          <SeccionHeader icon={<NotesIcon fontSize="small" />} titulo="Observación" />
          <TextField
            placeholder="Notas adicionales (opcional)"
            fullWidth size="small" multiline rows={2}
            value={form.observacion}
            onChange={handleCambio('observacion')}
            disabled={!esCrear}
          />
        </Paper>

        {/* ── Historial — solo en detalle ───────────────────────────────── */}
        {!esCrear && (
          <Paper variant="outlined" sx={{ p: 2.5, mt: 2, borderRadius: 2 }}>
            <SeccionHeader icon={<HistoryIcon fontSize="small" />} titulo="Historial de la marca" />

            {eventos.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                Sin eventos registrados
              </Typography>
            )}

            <Box sx={{ position: 'relative', pl: 3, mt: 1 }}>
              {/* línea vertical */}
              <Box sx={{
                position: 'absolute', left: 9, top: 6, bottom: 6,
                width: 2, bgcolor: 'divider'
              }} />
              {eventos.map((ev, i) => {
                const evMeta = COLOR_EVENTO[ev.tipo_evento] || { color: 'grey', label: ev.tipo_evento, icon: null }
                const ultimo = i === eventos.length - 1
                return (
                  <Box key={ev.id} sx={{ position: 'relative', mb: 2.5, '&:last-child': { mb: 0 } }}>
                    <Box sx={{
                      position: 'absolute', left: -22, top: 2,
                      width: 20, height: 20, borderRadius: '50%',
                      bgcolor: evMeta.color, color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: ultimo ? '3px solid' : 'none',
                      borderColor: ultimo ? evMeta.color : 'transparent',
                      boxShadow: ultimo ? `0 0 0 3px ${evMeta.color}33` : 'none',
                    }}>
                      {evMeta.icon}
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="subtitle2" sx={{ color: evMeta.color, fontWeight: 600 }}>
                        {evMeta.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {fechaRelativa(ev.fecha)} — {formatearFechaHora(ev.fecha)}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      por <strong>{ev.usuario_nombre || `Usuario #${ev.usuario_id}`}</strong>
                    </Typography>
                    {ev.observacion && (
                      <Typography variant="body2" sx={{
                        mt: 0.5, fontStyle: 'italic', color: 'text.secondary',
                        bgcolor: 'background.default', p: 1, borderRadius: 1,
                      }}>
                        {ev.observacion}
                      </Typography>
                    )}
                  </Box>
                )
              })}
            </Box>

            {puedeGestionar && accionActiva && (
              <>
                <Divider sx={{ my: 2 }} />
                <TextField
                  label={accionActiva === 'cerrar'
                    ? 'Observación del cierre (opcional)'
                    : 'Observación de la reapertura (opcional)'}
                  fullWidth size="small" multiline rows={2}
                  value={obsAccion}
                  onChange={e => setObsAccion(e.target.value)}
                  autoFocus
                />
              </>
            )}
          </Paper>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {esCrear ? (
          <>
            <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
            <Button
              variant="contained"
              startIcon={guardando ? <CircularProgress size={14} color="inherit" /> : <AddCircleIcon />}
              onClick={handleCrear}
              disabled={guardando}
            >
              Crear marca
            </Button>
          </>
        ) : accionActiva ? (
          <>
            <Button onClick={() => { setAccionActiva(null); setObsAccion('') }} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              variant="contained"
              color={accionActiva === 'cerrar' ? 'error' : 'warning'}
              startIcon={guardando
                ? <CircularProgress size={14} color="inherit" />
                : (accionActiva === 'cerrar' ? <LockIcon /> : <LockOpenIcon />)}
              onClick={ejecutarAccion}
              disabled={guardando}
            >
              {accionActiva === 'cerrar' ? 'Confirmar cierre' : 'Confirmar reapertura'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cerrar diálogo</Button>
            {puedeGestionar && marca?.estado === 'ABIERTA' && (
              <Button
                variant="contained" color="error"
                startIcon={<LockIcon />}
                onClick={() => setAccionActiva('cerrar')}
              >
                Cerrar marca
              </Button>
            )}
            {puedeGestionar && marca?.estado === 'CERRADA' && (
              <Button
                variant="contained" color="warning"
                startIcon={<LockOpenIcon />}
                onClick={() => setAccionActiva('reabrir')}
              >
                Reabrir marca
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
