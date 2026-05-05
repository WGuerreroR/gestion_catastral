import { useState, useEffect, useCallback } from 'react'
import {
  Box, Button, Typography, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Alert, CircularProgress, Tooltip,
  Chip, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, Paper, Select, MenuItem, FormControl,
  InputLabel, FormControlLabel, Switch, Stack, InputAdornment
} from '@mui/material'
import AddIcon    from '@mui/icons-material/Add'
import EditIcon   from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import LabelIcon  from '@mui/icons-material/Label'
import { useSelector } from 'react-redux'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'

const CATEGORIAS = ['FISICA', 'JURIDICA', 'ECONOMICA', 'IDENTIFICACION', 'SIG']

const ETIQUETAS_CATEGORIA = {
  FISICA:         'Física',
  JURIDICA:       'Jurídica',
  ECONOMICA:      'Económica',
  IDENTIFICACION: 'Identificación',
  SIG:            'SIG'
}

const COLORES_CATEGORIA = {
  FISICA:         'primary',
  JURIDICA:       'warning',
  ECONOMICA:      'success',
  IDENTIFICACION: 'info',
  SIG:            'secondary'
}

const PREFIJO_POR_CATEGORIA = {
  FISICA:         'FIS',
  JURIDICA:       'JUR',
  ECONOMICA:      'ECO',
  IDENTIFICACION: 'IDE',
  SIG:            'SIG'
}

// Quita cualquier prefijo conocido (`FIS-`, `JUR-`, ...) del inicio del código.
const quitarPrefijo = (codigo) => {
  if (!codigo) return ''
  for (const p of Object.values(PREFIJO_POR_CATEGORIA)) {
    if (codigo.startsWith(`${p}-`)) return codigo.slice(p.length + 1)
  }
  return codigo
}

const FORM_VACIO = { categoria: 'FISICA', codigo: '', significado: '' }

export default function TiposMarca() {
  const { user } = useSelector(state => state.auth)
  const esAdmin  = user?.roles?.includes('administrador')

  const [tipos,   setTipos]   = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')

  // Filtros
  const [categoriaFiltro,    setCategoriaFiltro]    = useState('')
  const [incluirInactivas,   setIncluirInactivas]   = useState(false)

  // Modal crear/editar
  const [modalOpen, setModalOpen] = useState(false)
  const [editando,  setEditando]  = useState(null)   // null = crear, objeto = editar
  const [form,      setForm]      = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (categoriaFiltro)  params.categoria = categoriaFiltro
      if (incluirInactivas) params.incluir_inactivas = true
      const { data } = await api.get('/tipos-marca/', { params })
      setTipos(data)
    } catch {
      setError('Error cargando tipos de marca')
    } finally {
      setLoading(false)
    }
  }, [categoriaFiltro, incluirInactivas])

  useEffect(() => { cargar() }, [cargar])

  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   4000) }
  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }

  const abrirCrear = () => {
    setEditando(null)
    setForm(FORM_VACIO)
    setModalOpen(true)
  }

  const abrirEditar = (tipo) => {
    setEditando(tipo)
    setForm({
      categoria:   tipo.categoria,
      codigo:      quitarPrefijo(tipo.codigo),
      significado: tipo.significado
    })
    setModalOpen(true)
  }

  const cerrarModal = () => {
    setModalOpen(false)
    setEditando(null)
    setForm(FORM_VACIO)
  }

  const formValido = form.categoria && form.codigo.trim() && form.significado.trim()

  const handleGuardar = async () => {
    if (!formValido) return
    setGuardando(true)
    try {
      if (editando) {
        await api.put(`/tipos-marca/${editando.id}`, {
          categoria:   form.categoria,
          codigo:      form.codigo,
          significado: form.significado
        })
        mostrarSuccess('Tipo de marca actualizado')
      } else {
        await api.post('/tipos-marca/', {
          categoria:   form.categoria,
          codigo:      form.codigo,
          significado: form.significado
        })
        mostrarSuccess('Tipo de marca creado')
      }
      cerrarModal()
      cargar()
    } catch (e) {
      mostrarError(getErrorMessage(e, editando ? 'Error al actualizar' : 'Error al crear'))
    } finally {
      setGuardando(false)
    }
  }

  const handleEliminar = async (tipo) => {
    if (!window.confirm(`¿Eliminar el tipo de marca "${tipo.codigo}"?`)) return
    try {
      await api.delete(`/tipos-marca/${tipo.id}`)
      mostrarSuccess('Tipo de marca eliminado')
      cargar()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al eliminar'))
    }
  }

  return (
    <Box sx={{ p: 3 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          Administración de tipos de marca
        </Typography>
        {esAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={abrirCrear}>
            Nuevo tipo de marca
          </Button>
        )}
      </Box>

      {/* Filtros */}
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Categoría</InputLabel>
          <Select
            label="Categoría"
            value={categoriaFiltro}
            onChange={e => setCategoriaFiltro(e.target.value)}
          >
            <MenuItem value="">Todas</MenuItem>
            {CATEGORIAS.map(c => (
              <MenuItem key={c} value={c}>{ETIQUETAS_CATEGORIA[c]}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControlLabel
          control={
            <Switch
              checked={incluirInactivas}
              onChange={e => setIncluirInactivas(e.target.checked)}
            />
          }
          label="Mostrar inactivas"
        />
      </Stack>

      {/* Alertas */}
      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Tabla */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Categoría</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Código</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Significado</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Estado</TableCell>
                {esAdmin && <TableCell align="right" sx={{ fontWeight: 600 }}>Acciones</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {tipos.map(tipo => (
                <TableRow key={tipo.id} hover sx={{ opacity: tipo.activo ? 1 : 0.55 }}>
                  <TableCell>
                    <Chip
                      label={ETIQUETAS_CATEGORIA[tipo.categoria] || tipo.categoria}
                      color={COLORES_CATEGORIA[tipo.categoria] || 'default'}
                      size="small"
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {tipo.codigo}
                  </TableCell>
                  <TableCell>{tipo.significado}</TableCell>
                  <TableCell>
                    <Chip
                      label={tipo.activo ? 'Activo' : 'Inactivo'}
                      color={tipo.activo ? 'success' : 'default'}
                      size="small"
                      variant={tipo.activo ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  {esAdmin && (
                    <TableCell align="right">
                      <Tooltip title="Editar">
                        <IconButton size="small" onClick={() => abrirEditar(tipo)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {tipo.activo && (
                        <Tooltip title="Eliminar">
                          <IconButton size="small" color="error" onClick={() => handleEliminar(tipo)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}

              {tipos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={esAdmin ? 5 : 4}>
                    <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                      <LabelIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                      <Typography>No hay tipos de marca registrados</Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Modal crear/editar */}
      <Dialog open={modalOpen} onClose={cerrarModal} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editando ? 'Editar tipo de marca' : 'Nuevo tipo de marca'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth required>
              <InputLabel>Categoría</InputLabel>
              <Select
                label="Categoría"
                value={form.categoria}
                onChange={e => setForm({ ...form, categoria: e.target.value })}
              >
                {CATEGORIAS.map(c => (
                  <MenuItem key={c} value={c}>{ETIQUETAS_CATEGORIA[c]}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Código"
              value={form.codigo}
              onChange={e => setForm({ ...form, codigo: quitarPrefijo(e.target.value.toUpperCase()) })}
              fullWidth
              required
              helperText={`Solo el sufijo. El sistema antepondrá "${PREFIJO_POR_CATEGORIA[form.categoria]}-" según la categoría`}
              inputProps={{ maxLength: 46, style: { fontFamily: 'monospace', fontWeight: 600 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Typography
                      sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'text.secondary' }}
                    >
                      {PREFIJO_POR_CATEGORIA[form.categoria]}-
                    </Typography>
                  </InputAdornment>
                )
              }}
            />

            <TextField
              label="Significado"
              value={form.significado}
              onChange={e => setForm({ ...form, significado: e.target.value })}
              fullWidth
              required
              multiline
              minRows={3}
              helperText="Descripción del significado del tipo de marca"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={cerrarModal}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleGuardar}
            disabled={guardando || !formValido}
          >
            {guardando ? <CircularProgress size={20} /> : (editando ? 'Guardar' : 'Crear')}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}
