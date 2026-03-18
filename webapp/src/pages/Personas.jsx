import { useState, useEffect, useCallback } from 'react'
import {
  Box, Button, Typography, Chip, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Alert, CircularProgress,
  Tooltip, Stack
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import AddIcon         from '@mui/icons-material/Add'
import EditIcon        from '@mui/icons-material/Edit'
import BlockIcon       from '@mui/icons-material/Block'
import KeyIcon         from '@mui/icons-material/Key'
import GroupAddIcon    from '@mui/icons-material/GroupAdd'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningIcon     from '@mui/icons-material/Warning'
import api from '../api/axios'
import { useSelector } from 'react-redux'
import { getErrorMessage } from '../utils/errorHandler'

const coloresRol = {
  administrador: 'error',
  gerente:       'warning',
  lider:         'info',
  ejecutor:      'success'
}

const FORM_INICIAL = {
  identificacion:  '',
  primer_nombre:   '',
  segundo_nombre:  '',
  primer_apellido: '',
  segundo_apellido:'',
  password:        ''
}

export default function Personas() {
  const { user } = useSelector(state => state.auth)
  const esAdmin  = user?.roles?.includes('administrador')

  const [personas,  setPersonas]  = useState([])
  const [roles,     setRoles]     = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState('')

  // Modal crear/editar
  const [modalOpen, setModalOpen] = useState(false)
  const [editando,  setEditando]  = useState(null)
  const [form,      setForm]      = useState(FORM_INICIAL)
  const [guardando, setGuardando] = useState(false)

  // Modal roles
  const [modalRol,          setModalRol]          = useState(false)
  const [personaRol,        setPersonaRol]        = useState(null)
  const [rolSeleccionado,   setRolSeleccionado]   = useState('')

  // Modal set password
  const [modalSetPass,   setModalSetPass]   = useState(false)
  const [personaSetPass, setPersonaSetPass] = useState(null)
  const [setPass,        setSetPass]        = useState({ password_nueva: '', confirmar: '' })

  // Modal confirmación
  const [modalConfirm,  setModalConfirm]  = useState(false)
  const [confirmData,   setConfirmData]   = useState({ titulo: '', mensaje: '', onConfirm: null })
  const [confirmando,   setConfirmando]   = useState(false)

  const cargarDatos = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, rRes] = await Promise.all([
        api.get('/personas/'),
        api.get('/roles/')
      ])
      setPersonas(pRes.data)
      setRoles(rRes.data)
    } catch {
      setError('Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  const mostrarError   = (msg) => { setError(msg);   setTimeout(() => setError(''),   4000) }
  const mostrarSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }

  // ── Modal confirmación genérico ─────────────────────────
  const confirmar = ({ titulo, mensaje, onConfirm }) => {
    setConfirmData({ titulo, mensaje, onConfirm })
    setModalConfirm(true)
  }

  const handleConfirmar = async () => {
    setConfirmando(true)
    try {
      await confirmData.onConfirm()
      setModalConfirm(false)
    } finally {
      setConfirmando(false)
    }
  }

  // ── Crear / Editar ──────────────────────────────────────
  const abrirCrear = () => {
    setEditando(null)
    setForm(FORM_INICIAL)
    setModalOpen(true)
  }

  const abrirEditar = (persona) => {
    setEditando(persona)
    setForm({
      identificacion:   persona.identificacion,
      primer_nombre:    persona.primer_nombre    || '',
      segundo_nombre:   persona.segundo_nombre   || '',
      primer_apellido:  persona.primer_apellido  || '',
      segundo_apellido: persona.segundo_apellido || '',
      password: ''
    })
    setModalOpen(true)
  }

  const handleGuardar = async () => {
    setGuardando(true)
    setError('')
    try {
      if (editando) {
        const { identificacion, password, ...campos } = form
        await api.put(`/personas/${editando.id}`, campos)
      } else {
        await api.post('/personas/', form)
      }
      mostrarSuccess(editando ? 'Persona actualizada' : 'Persona creada exitosamente')
      setModalOpen(false)
      cargarDatos()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al guardar'))
    } finally {
      setGuardando(false)
    }
  }

  // ── Desactivar ──────────────────────────────────────────
  const handleDesactivar = (persona) => {
    confirmar({
      titulo:  'Desactivar persona',
      mensaje: `¿Estás seguro de desactivar a ${persona.primer_nombre} ${persona.primer_apellido}? La persona no podrá iniciar sesión.`,
      onConfirm: async () => {
        await api.delete(`/personas/${persona.id}`)
        mostrarSuccess('Persona desactivada')
        cargarDatos()
      }
    })
  }

  // ── Activar ─────────────────────────────────────────────
const handleActivar = (persona) => {
    confirmar({
      titulo:  'Activar persona',
      mensaje: `¿Activar a ${persona.primer_nombre} ${persona.primer_apellido}? La persona podrá iniciar sesión nuevamente.`,
      onConfirm: async () => {
        await api.put(`/personas/${persona.id}/activar`)
        mostrarSuccess('Persona activada')
        cargarDatos()
      }
    })
  }

  // ── Asignar / Revocar rol ───────────────────────────────
  const abrirAsignarRol = (persona) => {
    setPersonaRol(persona)
    setRolSeleccionado('')
    setModalRol(true)
  }

  const handleAsignarRol = async () => {
    try {
      await api.post('/roles/asignar', {
        persona_id: personaRol.id,
        rol_id: parseInt(rolSeleccionado)
      })
      mostrarSuccess('Rol asignado exitosamente')
      setModalRol(false)
      cargarDatos()
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al asignar rol'))
    }
  }

  const handleRevocarRol = (persona, rolNombre) => {
    const rol = roles.find(r => r.nombre === rolNombre)
    if (!rol) return
    confirmar({
      titulo:  'Revocar rol',
      mensaje: `¿Revocar el rol "${rolNombre}" a ${persona.primer_nombre} ${persona.primer_apellido}?`,
      onConfirm: async () => {
        await api.delete('/roles/revocar', {
          data: { persona_id: persona.id, rol_id: rol.id }
        })
        mostrarSuccess('Rol revocado')
        cargarDatos()
      }
    })
  }

  // ── Set password ────────────────────────────────────────
  const abrirSetPassword = (persona) => {
    setPersonaSetPass(persona)
    setSetPass({ password_nueva: '', confirmar: '' })
    setModalSetPass(true)
  }

  const handleSetPassword = async () => {
    if (setPass.password_nueva !== setPass.confirmar) {
      mostrarError('Las contraseñas no coinciden')
      return
    }
    try {
      await api.put(`/personas/${personaSetPass.id}/set-password`, {
        password_nueva: setPass.password_nueva
      })
      mostrarSuccess('Contraseña actualizada')
      setModalSetPass(false)
    } catch (e) {
      mostrarError(getErrorMessage(e, 'Error al actualizar contraseña'))
    }
  }

  // ── Columnas DataGrid ───────────────────────────────────
  const columnas = [
    {
      field: 'identificacion',
      headerName: 'Identificación',
      width: 140
    },
    {
      field: 'nombre_completo',
      headerName: 'Nombre completo',
      flex: 1,
      valueGetter: (_, row) =>
        `${row.primer_nombre || ''} ${row.segundo_nombre || ''} ${row.primer_apellido || ''} ${row.segundo_apellido || ''}`.trim()
    },
    {
      field: 'roles',
      headerName: 'Roles',
      width: 260,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" alignItems="center">
          {(row.roles || []).map(rol => (
            <Chip
              key={rol}
              label={rol}
              size="small"
              color={coloresRol[rol] || 'default'}
              onDelete={esAdmin ? () => handleRevocarRol(row, rol) : undefined}
            />
          ))}
        </Stack>
      )
    },
    {
      field: 'activo',
      headerName: 'Estado',
      width: 110,
      renderCell: ({ value }) => (
        <Chip
          label={value ? 'Activo' : 'Inactivo'}
          size="small"
          color={value ? 'success' : 'default'}
          icon={value ? <CheckCircleIcon /> : undefined}
        />
      )
    },
    {
      field: 'acciones',
      headerName: 'Acciones',
      width: 180,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          {esAdmin && (
            <>
              <Tooltip title="Editar datos">
                <IconButton size="small" onClick={() => abrirEditar(row)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Asignar rol">
                <IconButton size="small" color="primary" onClick={() => abrirAsignarRol(row)}>
                  <GroupAddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Setear contraseña">
                <IconButton size="small" color="warning" onClick={() => abrirSetPassword(row)}>
                  <KeyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {row.activo ? (
                    <Tooltip title="Desactivar">
                        <IconButton size="small" color="error" onClick={() => handleDesactivar(row)}>
                        <BlockIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    ) : (
                    <Tooltip title="Activar">
                        <IconButton size="small" color="success" onClick={() => handleActivar(row)}>
                        <CheckCircleIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    )}
            </>
          )}
        </Stack>
      )
    }
  ]

  return (
    <Box sx={{ p: 3 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          Administración de personas
        </Typography>
        {esAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={abrirCrear}>
            Nueva persona
          </Button>
        )}
      </Box>

      {/* Alertas */}
      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Tabla */}
      <DataGrid
        rows={personas}
        columns={columnas}
        loading={loading}
        autoHeight
        pageSizeOptions={[10, 25, 50]}
        initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
        disableRowSelectionOnClick
        sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
      />

      {/* ── Modal Crear / Editar ─────────────────────────── */}
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editando ? 'Editar persona' : 'Nueva persona'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Identificación"
              value={form.identificacion}
              onChange={e => setForm({ ...form, identificacion: e.target.value })}
              disabled={!!editando}
              type="number"
              fullWidth required
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Primer nombre"
                value={form.primer_nombre}
                onChange={e => setForm({ ...form, primer_nombre: e.target.value })}
                fullWidth required
              />
              <TextField
                label="Segundo nombre"
                value={form.segundo_nombre}
                onChange={e => setForm({ ...form, segundo_nombre: e.target.value })}
                fullWidth
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Primer apellido"
                value={form.primer_apellido}
                onChange={e => setForm({ ...form, primer_apellido: e.target.value })}
                fullWidth required
              />
              <TextField
                label="Segundo apellido"
                value={form.segundo_apellido}
                onChange={e => setForm({ ...form, segundo_apellido: e.target.value })}
                fullWidth
              />
            </Stack>
            {!editando && (
              <TextField
                label="Contraseña inicial"
                type="password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                fullWidth required
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setModalOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={handleGuardar} disabled={guardando}>
            {guardando ? <CircularProgress size={20} /> : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Modal Asignar Rol ────────────────────────────── */}
      <Dialog open={modalRol} onClose={() => setModalRol(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Asignar rol</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Persona: <strong>{personaRol?.primer_nombre} {personaRol?.primer_apellido}</strong>
          </Typography>
          <TextField
            select fullWidth
            label="Seleccionar rol"
            value={rolSeleccionado}
            onChange={e => setRolSeleccionado(e.target.value)}
          >
            {roles
              .filter(r => !personaRol?.roles?.includes(r.nombre))
              .map(r => (
                <MenuItem key={r.id} value={r.id}>{r.nombre}</MenuItem>
              ))
            }
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setModalRol(false)}>Cancelar</Button>
          <Button variant="contained" onClick={handleAsignarRol} disabled={!rolSeleccionado}>
            Asignar
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Modal Set Password ───────────────────────────── */}
      <Dialog open={modalSetPass} onClose={() => setModalSetPass(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Setear contraseña</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Persona: <strong>{personaSetPass?.primer_nombre} {personaSetPass?.primer_apellido}</strong>
          </Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Nueva contraseña"
              type="password"
              value={setPass.password_nueva}
              onChange={e => setSetPass({ ...setPass, password_nueva: e.target.value })}
              fullWidth required
            />
            <TextField
              label="Confirmar contraseña"
              type="password"
              value={setPass.confirmar}
              onChange={e => setSetPass({ ...setPass, confirmar: e.target.value })}
              fullWidth required
              error={!!setPass.confirmar && setPass.password_nueva !== setPass.confirmar}
              helperText={
                setPass.confirmar && setPass.password_nueva !== setPass.confirmar
                  ? 'Las contraseñas no coinciden' : ''
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setModalSetPass(false)}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleSetPassword}
            disabled={!setPass.password_nueva || setPass.password_nueva !== setPass.confirmar}
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Modal Confirmación ───────────────────────────── */}
      <Dialog open={modalConfirm} onClose={() => !confirmando && setModalConfirm(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningIcon color="warning" />
            {confirmData.titulo}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {confirmData.mensaje}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setModalConfirm(false)}
            disabled={confirmando}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmar}
            disabled={confirmando}
          >
            {confirmando ? <CircularProgress size={20} color="inherit" /> : 'Confirmar'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}