import { useState, useEffect } from 'react'
import {
  Box, Card, CardContent, Typography, TextField,
  Button, Alert, Stack, Divider, Avatar, Chip,
  CircularProgress
} from '@mui/material'
import SaveIcon  from '@mui/icons-material/Save'
import LockIcon  from '@mui/icons-material/Lock'
import { useSelector } from 'react-redux'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'

const coloresRol = {
  admin:    'error',
  gerente:  'warning',
  lider:    'info',
  ejecutor: 'success'
}

export default function Perfil() {
  const { user } = useSelector(state => state.auth)

  // ── Todos los hooks primero, sin condiciones ────────────
  const [loadingPerfil, setLoadingPerfil] = useState(true)
  const [loadingDatos,  setLoadingDatos]  = useState(false)
  const [loadingPass,   setLoadingPass]   = useState(false)
  const [errorDatos,    setErrorDatos]    = useState('')
  const [successDatos,  setSuccessDatos]  = useState('')
  const [errorPass,     setErrorPass]     = useState('')
  const [successPass,   setSuccessPass]   = useState('')
  const [mostrarCambioPass, setMostrarCambioPass] = useState(false)

  const [datosForm, setDatosForm] = useState({
    primer_nombre:    '',
    segundo_nombre:   '',
    primer_apellido:  '',
    segundo_apellido: ''
  })

  const [passForm, setPassForm] = useState({
    password_actual: '',
    password_nueva:  '',
    confirmar:       ''
  })

  // Cargar datos del perfil
  useEffect(() => {
    const cargarPerfil = async () => {
      try {
        const { data } = await api.get(`/personas/${user.sub}`)
        setDatosForm({
          primer_nombre:    data.primer_nombre    || '',
          segundo_nombre:   data.segundo_nombre   || '',
          primer_apellido:  data.primer_apellido  || '',
          segundo_apellido: data.segundo_apellido || ''
        })
      } catch {
        setErrorDatos('Error cargando datos del perfil')
      } finally {
        setLoadingPerfil(false)
      }
    }
    if (user?.sub) cargarPerfil()
  }, [user?.sub])

  const getInitiales = () => {
    if (!user?.nombre) return 'U'
    return user.nombre.charAt(0).toUpperCase()
  }

  const handleGuardarDatos = async () => {
    setLoadingDatos(true)
    setErrorDatos('')
    try {
      await api.put(`/personas/${user.sub}`, datosForm)
      setSuccessDatos('Datos actualizados correctamente')
      setTimeout(() => setSuccessDatos(''), 4000)
    } catch (e) {
      setErrorDatos(e.response?.data?.detail || 'Error al actualizar datos')
    } finally {
      setLoadingDatos(false)
    }
  }

  const handleCambiarPassword = async () => {
    if (passForm.password_nueva !== passForm.confirmar) {
      setErrorPass('Las contraseñas no coinciden')
      return
    }
    setLoadingPass(true)
    setErrorPass('')
    setSuccessPass('')
    try {
      await api.put(`/personas/${user.sub}/password`, {
        password_actual: passForm.password_actual,
        password_nueva:  passForm.password_nueva
      })
      setSuccessPass('Contraseña actualizada correctamente')
      setPassForm({ password_actual: '', password_nueva: '', confirmar: '' })
      setMostrarCambioPass(false)
      setTimeout(() => setSuccessPass(''), 4000)
    } catch (e) {
      const detail = e.response?.data?.detail
      // Si es array (error de validación Pydantic 422)
      if (Array.isArray(detail)) {
        setErrorPass(detail.map(d => d.msg).join(', '))
      } else if (typeof detail === 'string') {
        setErrorPass(detail)
      } else {
        setErrorPass(getErrorMessage(e, 'Error al cambiar contraseña'))
      }

    } finally {
      setLoadingPass(false)
    }
  }

  // ── Return condicional DESPUÉS de todos los hooks ───────
  if (loadingPerfil) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3, maxWidth: 700, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={600} mb={3}>
        Mi perfil
      </Typography>

      {/* Info del usuario */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: 28 }}>
              {getInitiales()}
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight={600}>
                {user?.nombre}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={1}>
                ID: {user?.identificacion}
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap">
                {user?.roles?.map(rol => (
                  <Chip key={rol} label={rol} size="small" color={coloresRol[rol] || 'default'} />
                ))}
              </Stack>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Datos personales */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={500} mb={2}>
            Datos personales
          </Typography>
          <Divider sx={{ mb: 2 }} />

          {errorDatos   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setErrorDatos('')}>{errorDatos}</Alert>}
          {successDatos && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessDatos('')}>{successDatos}</Alert>}

          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Primer nombre"
                value={datosForm.primer_nombre}
                onChange={e => setDatosForm({ ...datosForm, primer_nombre: e.target.value })}
                fullWidth required
              />
              <TextField
                label="Segundo nombre"
                value={datosForm.segundo_nombre}
                onChange={e => setDatosForm({ ...datosForm, segundo_nombre: e.target.value })}
                fullWidth
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Primer apellido"
                value={datosForm.primer_apellido}
                onChange={e => setDatosForm({ ...datosForm, primer_apellido: e.target.value })}
                fullWidth required
              />
              <TextField
                label="Segundo apellido"
                value={datosForm.segundo_apellido}
                onChange={e => setDatosForm({ ...datosForm, segundo_apellido: e.target.value })}
                fullWidth
              />
            </Stack>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                startIcon={loadingDatos ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                onClick={handleGuardarDatos}
                disabled={loadingDatos}
              >
                Guardar cambios
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

        {/* Cambiar contraseña */}
        <Card>
        <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" fontWeight={500}>
                Cambiar contraseña
            </Typography>
            <Button
                variant={mostrarCambioPass ? 'outlined' : 'contained'}
                color="warning"
                size="small"
                startIcon={<LockIcon />}
                onClick={() => {
                setMostrarCambioPass(!mostrarCambioPass)
                setPassForm({ password_actual: '', password_nueva: '', confirmar: '' })
                setErrorPass('')
                setSuccessPass('')
                }}
            >
                {mostrarCambioPass ? 'Cancelar' : 'Cambiar contraseña'}
            </Button>
            </Box>

            {mostrarCambioPass && (
            <>
                <Divider sx={{ my: 2 }} />

                {errorPass   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setErrorPass('')}>{errorPass}</Alert>}
                {successPass && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessPass('')}>{successPass}</Alert>}

                <Stack spacing={2}>
                <TextField
                    label="Contraseña actual"
                    type="password"
                    value={passForm.password_actual}
                    onChange={e => setPassForm({ ...passForm, password_actual: e.target.value })}
                    fullWidth required
                />
                <TextField
                    label="Nueva contraseña"
                    type="password"
                    value={passForm.password_nueva}
                    onChange={e => setPassForm({ ...passForm, password_nueva: e.target.value })}
                    fullWidth required
                />
                <TextField
                    label="Confirmar nueva contraseña"
                    type="password"
                    value={passForm.confirmar}
                    onChange={e => setPassForm({ ...passForm, confirmar: e.target.value })}
                    fullWidth required
                    error={!!passForm.confirmar && passForm.password_nueva !== passForm.confirmar}
                    helperText={
                    passForm.confirmar && passForm.password_nueva !== passForm.confirmar
                        ? 'Las contraseñas no coinciden' : ''
                    }
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                    variant="contained"
                    color="warning"
                    startIcon={loadingPass ? <CircularProgress size={16} color="inherit" /> : <LockIcon />}
                    onClick={handleCambiarPassword}
                    disabled={
                        loadingPass ||
                        !passForm.password_actual ||
                        !passForm.password_nueva  ||
                        passForm.password_nueva !== passForm.confirmar
                    }
                    >
                    Guardar contraseña
                    </Button>
                </Box>
                </Stack>
            </>
            )}
        </CardContent>
        </Card>
    </Box>
  )
}