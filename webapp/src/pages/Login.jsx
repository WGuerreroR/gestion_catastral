import { useState, useEffect } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, Alert, CircularProgress, InputAdornment,
  IconButton
} from '@mui/material'
import MapIcon from '@mui/icons-material/Map'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { loginThunk, clearError } from '../store/slices/authSlice'
import Logomini from '../assets/logo_mini.svg'
import Logo from '../assets/ingicat.png'
export default function Login() {
  const navigate  = useNavigate()
  const dispatch  = useDispatch()
  const { loading, error, user } = useSelector(state => state.auth)

  const [form, setForm] = useState({ identificacion: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)

  // Si ya está autenticado redirigir
  useEffect(() => {
    if (user) navigate('/dashboard')
  }, [user])

  // Limpiar error al desmontar
  useEffect(() => {
    return () => dispatch(clearError())
  }, [])

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    if (error) dispatch(clearError())
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await dispatch(loginThunk({
        username: parseInt(form.identificacion),
        password: form.password
      })).unwrap()
      navigate('/dashboard')
    } catch {
      // El error ya queda en Redux
    }
  }

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: 'background.default',
      backgroundImage: 'linear-gradient(135deg, #3E2723 0%, #D1B692 100%)',
    }}>
      <Card sx={{ width: 420, mx: 2 }}>
        <CardContent sx={{ p: 4 }}>

          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
          <img
         src={Logo}
         alt="Ingicat"
         style={{ height: 60, width: 'auto' }}
       />
            <Typography variant="h5" fontWeight={600}>
              Gestión predial
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5}>
              Ingresa tus credenciales para continuar
            </Typography>
          </Box>

          {/* Error */}
          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => dispatch(clearError())}>
              {error}
            </Alert>
          )}

          {/* Formulario */}
          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              label="Número de identificación"
              name="identificacion"
              type="number"
              value={form.identificacion}
              onChange={handleChange}
              fullWidth
              required
              autoFocus
              sx={{ mb: 2 }}
              disabled={loading}
              inputProps={{ min: 0 }}
            />

            <TextField
              label="Contraseña"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={handleChange}
              fullWidth
              required
              sx={{ mb: 3 }}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                    >
                      {showPassword
                        ? <VisibilityOffIcon />
                        : <VisibilityIcon />
                      }
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />

            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={loading || !form.identificacion || !form.password}
              sx={{ py: 1.5 }}
            >
              {loading
                ? <CircularProgress size={24} color="inherit" />
                : 'Ingresar'
              }
            </Button>
          </Box>

        </CardContent>
      </Card>
    </Box>
  )
}
