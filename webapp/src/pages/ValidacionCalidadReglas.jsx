import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Paper, Stack, Button, IconButton, Chip, Switch,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  FormControl, InputLabel, Select, MenuItem, Alert, Tooltip,
  CircularProgress, FormControlLabel, ListSubheader
} from '@mui/material'
import ArrowBackIcon  from '@mui/icons-material/ArrowBack'
import AddIcon        from '@mui/icons-material/Add'
import EditIcon       from '@mui/icons-material/Edit'
import DeleteIcon     from '@mui/icons-material/Delete'
import api from '../api/validacionCalidad'
import axios from '../api/axios'

const CATEGORIAS_ORDEN = ['IDENTIFICACION', 'FISICA', 'JURIDICA', 'ECONOMICA', 'SIG']

const ENTIDADES = [
  { value: 'predio',              label: 'Predio (lc_predio_p)',           alias: 'p'  },
  { value: 'terreno',             label: 'Terreno (cr_terreno)',           alias: 't'  },
  { value: 'interesado',          label: 'Interesado (cr_interesado)',     alias: 'ci' },
  { value: 'unidad_construccion', label: 'Unidad construcción (cr_unidadconstruccion)', alias: 'uc' },
]

// Por seguridad la regla solo declara el SELECT que produce las 4 columnas.
// El backend envuelve automáticamente con
//   INSERT INTO validacion_calidad_log (job_id, numero_predial, regla, descripcion)
// antes de ejecutar — el usuario no puede inyectar un INSERT a otra tabla.
const TEMPLATES = {
  predio: `SELECT :job_id, p.numero_predial, 'CODIGO', 'Descripción del error'
FROM lc_predio_p p
{{filtro_alcance}}
WHERE /* tu condición */`,
  terreno: `SELECT :job_id, p.numero_predial, 'CODIGO', 'Descripción del error'
FROM cr_terreno t
JOIN lc_predio_p p ON p.id_operacion = t.id_operacion_predio
{{filtro_alcance}}
WHERE /* tu condición */`,
  interesado: `SELECT :job_id, p.numero_predial, 'CODIGO', 'Descripción del error'
FROM cr_interesado ci
JOIN lc_predio_p p ON p.id_operacion = ci.id_operacion_predio
{{filtro_alcance}}
WHERE /* tu condición */`,
  unidad_construccion: `SELECT :job_id, p.numero_predial, 'CODIGO', 'Descripción del error'
FROM cr_unidadconstruccion uc
JOIN lc_predio_p p ON p.id_operacion = uc.id_operacion_predio
{{filtro_alcance}}
WHERE /* tu condición */`,
}

const reglaVacia = () => ({
  codigo: '', nombre: '', descripcion: '',
  entidad: 'predio',
  sql_template: TEMPLATES.predio,
  activa: true, orden: 0,
  tipo_marca_id: null,
})

export default function ValidacionCalidadReglas() {
  const navigate = useNavigate()
  const [reglas, setReglas]   = useState([])
  const [loading, setLoading] = useState(true)
  const [tiposMarca, setTiposMarca] = useState([])

  const [editor, setEditor]   = useState(null) // {modo: 'crear'|'editar', data}
  const [guardando, setGuardando] = useState(false)
  const [errEditor, setErrEditor] = useState('')

  const cargar = async () => {
    setLoading(true)
    try {
      setReglas(await api.listarReglas())
    } finally {
      setLoading(false)
    }
  }
  const cargarTiposMarca = async () => {
    try {
      const { data } = await axios.get('/tipos-marca/', { params: { incluir_inactivas: false } })
      setTiposMarca(data || [])
    } catch {
      // sin tipos disponibles → el selector quedará vacío y el guardado fallará con 422
    }
  }
  useEffect(() => { cargar(); cargarTiposMarca() }, [])

  // Tipos agrupados por categoría para el Select con ListSubheader.
  const tiposPorCategoria = useMemo(() => {
    const map = {}
    for (const t of tiposMarca) {
      const cat = t.categoria || 'OTROS'
      if (!map[cat]) map[cat] = []
      map[cat].push(t)
    }
    return map
  }, [tiposMarca])

  const tipoMarcaPorId = useMemo(() => {
    const m = {}
    for (const t of tiposMarca) m[t.id] = t
    return m
  }, [tiposMarca])

  const abrirCrear = () => {
    setErrEditor('')
    setEditor({ modo: 'crear', data: reglaVacia() })
  }
  const abrirEditar = async (id) => {
    setErrEditor('')
    try {
      const r = await api.obtenerRegla(id)
      setEditor({ modo: 'editar', data: r })
    } catch {
      setErrEditor('No se pudo cargar la regla')
    }
  }

  const handleCambioEntidad = (entidad) => {
    setEditor(prev => ({
      ...prev,
      data: {
        ...prev.data,
        entidad,
        sql_template: prev.modo === 'crear'
          ? TEMPLATES[entidad]
          : prev.data.sql_template,
      }
    }))
  }

  const handleGuardar = async () => {
    setErrEditor(''); setGuardando(true)
    const { modo, data } = editor
    if (!data.tipo_marca_id) {
      setErrEditor('Selecciona el tipo de marca asociado a la regla.')
      setGuardando(false)
      return
    }
    try {
      if (modo === 'crear') {
        await api.crearRegla({
          codigo: data.codigo, nombre: data.nombre,
          descripcion: data.descripcion || null,
          entidad: data.entidad, sql_template: data.sql_template,
          activa: data.activa, orden: data.orden || 0,
          tipo_marca_id: data.tipo_marca_id,
        })
      } else {
        await api.actualizarRegla(data.id, {
          codigo: data.codigo, nombre: data.nombre,
          descripcion: data.descripcion, entidad: data.entidad,
          sql_template: data.sql_template, activa: data.activa,
          orden: data.orden,
          tipo_marca_id: data.tipo_marca_id,
        })
      }
      setEditor(null)
      cargar()
    } catch (e) {
      setErrEditor(e.response?.data?.detail || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const handleBorrar = async (id, codigo) => {
    if (!confirm(`¿Eliminar la regla "${codigo}"? No afecta jobs históricos.`)) return
    try {
      await api.borrarRegla(id)
      cargar()
    } catch (e) {
      alert(e.response?.data?.detail || 'No se pudo eliminar')
    }
  }

  const toggleActiva = async (r) => {
    try {
      await api.actualizarRegla(r.id, { activa: !r.activa })
      cargar()
    } catch {
      alert('No se pudo cambiar el estado')
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        <IconButton onClick={() => navigate('/validacion-calidad')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={600} sx={{ flex: 1 }}>
          Reglas de validación
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={abrirCrear}>
          Nueva regla
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" mb={2}>
        Cada regla es un <strong>SELECT</strong> que devuelve las 4 columnas
        del error: <code>(:job_id, numero_predial, codigo_regla, descripcion)</code>.
        El placeholder <code>{'{{filtro_alcance}}'}</code> se sustituye por el
        JOIN al alcance del job según la entidad declarada. Debe usarse el alias
        estándar (<code>p, t, ci, uc</code>) y referenciar <code>p.numero_predial</code>.
      </Typography>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Orden</TableCell>
              <TableCell>Código</TableCell>
              <TableCell>Nombre</TableCell>
              <TableCell>Entidad</TableCell>
              <TableCell>Tipo de marca</TableCell>
              <TableCell>Activa</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={20} /></TableCell></TableRow>
            ) : reglas.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center">Sin reglas — crea la primera</TableCell></TableRow>
            ) : reglas.map(r => (
              <TableRow key={r.id} hover>
                <TableCell>{r.orden}</TableCell>
                <TableCell>{r.codigo}</TableCell>
                <TableCell>{r.nombre}</TableCell>
                <TableCell><Chip size="small" label={r.entidad} /></TableCell>
                <TableCell>
                  {r.tipo_marca_codigo ? (
                    <Chip
                      size="small"
                      label={`[${r.tipo_marca_categoria}] ${r.tipo_marca_codigo}`}
                      variant="outlined"
                    />
                  ) : (
                    <Chip size="small" label="Sin tipo — configurar" color="error" variant="outlined" />
                  )}
                </TableCell>
                <TableCell>
                  <Switch size="small" checked={r.activa} onChange={() => toggleActiva(r)} />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Editar">
                    <IconButton size="small" onClick={() => abrirEditar(r.id)}><EditIcon fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title="Eliminar">
                    <IconButton size="small" color="error" onClick={() => handleBorrar(r.id, r.codigo)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Editor */}
      <Dialog open={!!editor} onClose={() => setEditor(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editor?.modo === 'crear' ? 'Nueva regla' : `Editar ${editor?.data?.codigo}`}
        </DialogTitle>
        <DialogContent dividers>
          {errEditor && <Alert severity="error" sx={{ mb: 2 }}>{errEditor}</Alert>}
          {editor && (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Código" size="small" sx={{ width: 200 }}
                  value={editor.data.codigo}
                  onChange={e => setEditor(prev => ({ ...prev, data: { ...prev.data, codigo: e.target.value } }))}
                />
                <TextField
                  label="Nombre" size="small" fullWidth
                  value={editor.data.nombre}
                  onChange={e => setEditor(prev => ({ ...prev, data: { ...prev.data, nombre: e.target.value } }))}
                />
                <TextField
                  label="Orden" type="number" size="small" sx={{ width: 100 }}
                  value={editor.data.orden}
                  onChange={e => setEditor(prev => ({ ...prev, data: { ...prev.data, orden: parseInt(e.target.value || '0', 10) } }))}
                />
              </Stack>
              <TextField
                label="Descripción" size="small" multiline rows={2} fullWidth
                value={editor.data.descripcion || ''}
                onChange={e => setEditor(prev => ({ ...prev, data: { ...prev.data, descripcion: e.target.value } }))}
              />
              <Stack direction="row" spacing={2} alignItems="center">
                <FormControl size="small" sx={{ width: 320 }}>
                  <InputLabel>Entidad objetivo</InputLabel>
                  <Select
                    label="Entidad objetivo" value={editor.data.entidad}
                    onChange={e => handleCambioEntidad(e.target.value)}
                  >
                    {ENTIDADES.map(e => (
                      <MenuItem key={e.value} value={e.value}>
                        {e.label} — alias <code>{e.alias}</code>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={<Switch checked={editor.data.activa}
                    onChange={e => setEditor(prev => ({ ...prev, data: { ...prev.data, activa: e.target.checked } }))} />}
                  label="Activa"
                />
              </Stack>

              <FormControl
                size="small"
                fullWidth
                required
                error={!editor.data.tipo_marca_id}
              >
                <InputLabel>Tipo de marca asociada</InputLabel>
                <Select
                  label="Tipo de marca asociada *"
                  value={editor.data.tipo_marca_id || ''}
                  onChange={e => setEditor(prev => ({
                    ...prev,
                    data: { ...prev.data, tipo_marca_id: e.target.value || null }
                  }))}
                  renderValue={(val) => {
                    const t = tipoMarcaPorId[val]
                    return t ? `[${t.categoria}] ${t.codigo} — ${t.significado || ''}` : ''
                  }}
                >
                  {CATEGORIAS_ORDEN.flatMap(cat => {
                    const lista = tiposPorCategoria[cat] || []
                    if (lista.length === 0) return []
                    return [
                      <ListSubheader key={`h-${cat}`}>{cat}</ListSubheader>,
                      ...lista.map(t => (
                        <MenuItem key={t.id} value={t.id}>
                          <code>{t.codigo}</code>&nbsp;— {t.significado || ''}
                        </MenuItem>
                      )),
                    ]
                  })}
                </Select>
                <Typography variant="caption" color={editor.data.tipo_marca_id ? 'text.secondary' : 'error'} sx={{ ml: 1.5, mt: 0.5 }}>
                  Obligatorio: define qué tipo de marca se crea cuando un revisor convierte el error.
                </Typography>
              </FormControl>
              <TextField
                label="SQL Template"
                multiline minRows={12} maxRows={28} fullWidth
                value={editor.data.sql_template}
                onChange={e => setEditor(prev => ({ ...prev, data: { ...prev.data, sql_template: e.target.value } }))}
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
              />
              <Alert severity="info">
                Define un <code>SELECT</code> (o <code>WITH ... SELECT</code>)
                que devuelva las 4 columnas:
                <code> :job_id</code>, <code>p.numero_predial</code>,
                código de regla y descripción. Debe contener exactamente un
                <code> {'{{filtro_alcance}}'}</code> y usar el alias correcto
                según la entidad. Se valida automáticamente al guardar.
              </Alert>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)} disabled={guardando}>Cancelar</Button>
          <Button variant="contained" onClick={handleGuardar} disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
