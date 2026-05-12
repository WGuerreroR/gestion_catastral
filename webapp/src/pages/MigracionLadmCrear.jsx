import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Paper, Button, Stack, TextField, Alert, Radio, RadioGroup,
  FormControl, FormControlLabel, FormLabel, MenuItem, CircularProgress, Divider,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import api from '../api/migracionLadm'

function formatearError(e, fallback) {
  const detail = e?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map(d => d?.msg || JSON.stringify(d)).join('; ')
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return e?.message || fallback
}

export default function MigracionLadmCrear() {
  const navigate = useNavigate()

  const [origen, setOrigen] = useState('local')   // 'local' | 'perfil' | 'adhoc'
  const [perfiles, setPerfiles] = useState([])
  const [perfilId, setPerfilId] = useState('')

  // Ad-hoc
  const [host, setHost]         = useState('')
  const [port, setPort]         = useState(5432)
  const [dbname, setDbname]     = useState('')
  const [usuario, setUsuario]   = useState('')
  const [password, setPassword] = useState('')

  // Esquemas
  const [esquemaOrigen, setEsquemaOrigen]   = useState('validado')
  const [esquemaDestino, setEsquemaDestino] = useState('ladm')
  const [tablaDominios, setTablaDominios]   = useState('homologacion1_0_1_2')

  const [probando, setProbando]   = useState(false)
  const [pruebaOk, setPruebaOk]   = useState(false)
  const [creando, setCreando]     = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    api.listarConexiones().then(setPerfiles).catch(() => {})
  }, [])

  // Reset prueba cuando cambia origen o credenciales
  useEffect(() => { setPruebaOk(false) }, [origen, perfilId, host, port, dbname, usuario, password])

  const probar = async () => {
    setError(''); setProbando(true); setPruebaOk(false)
    try {
      let res
      if (origen === 'local') {
        res = await api.probarConexionLocal()
      } else if (origen === 'perfil') {
        if (!perfilId) { setError('Selecciona un perfil'); setProbando(false); return }
        res = await api.probarConexionPerfil(perfilId)
      } else {
        res = await api.probarConexionAdhoc({ host, port: Number(port), dbname, usuario, password })
      }
      if (res.ok) setPruebaOk(true)
      else setError(res.error || 'No se pudo conectar')
    } catch (e) {
      setError(formatearError(e, 'Error al probar conexión'))
    } finally {
      setProbando(false)
    }
  }

  const ejecutar = async () => {
    setError(''); setCreando(true)
    try {
      const conexion_id = origen === 'perfil' ? Number(perfilId) : null
      // Si origen='adhoc' aún no soportamos ejecutar sin guardar perfil:
      // pedimos al usuario que lo guarde primero (la API exige conexion_id o local).
      if (origen === 'adhoc') {
        setError('Para ejecutar con conexión ad-hoc, primero guárdala como perfil en "Perfiles de conexión".')
        setCreando(false)
        return
      }
      const { job_id } = await api.crearJob({
        conexion_id,
        esquema_origen: esquemaOrigen,
        esquema_destino: esquemaDestino,
        tabla_dominios: tablaDominios,
      })
      navigate(`/migracion-ladm/${job_id}`)
    } catch (e) {
      setError(formatearError(e, 'Error al crear el job'))
    } finally {
      setCreando(false)
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 800 }}>
      <Typography variant="h5" fontWeight={600} mb={1}>Nueva migración LADM</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Migra el esquema <code>validado</code> al modelo LADM oficial. Antes de
        ejecutar, prueba la conexión.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <FormControl>
          <FormLabel sx={{ fontWeight: 600, mb: 1 }}>Conexión a la base de datos</FormLabel>
          <RadioGroup value={origen} onChange={e => setOrigen(e.target.value)}>
            <FormControlLabel value="local"  control={<Radio />} label="BD del proyecto (default)" />
            <FormControlLabel value="perfil" control={<Radio />} label="Perfil guardado" />
            <FormControlLabel value="adhoc"  control={<Radio />} label="Conexión ad-hoc (solo para probar)" />
          </RadioGroup>
        </FormControl>

        {origen === 'perfil' && (
          <Box mt={2}>
            <TextField
              select fullWidth size="small" label="Perfil"
              value={perfilId}
              onChange={e => setPerfilId(e.target.value)}
            >
              {perfiles.length === 0 && <MenuItem disabled value="">Sin perfiles</MenuItem>}
              {perfiles.map(p => (
                <MenuItem key={p.id} value={p.id}>
                  {p.nombre} — {p.usuario}@{p.host}:{p.port}/{p.dbname}
                </MenuItem>
              ))}
            </TextField>
            {perfiles.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                Crea uno en <a href="/migracion-ladm/conexiones">Perfiles de conexión</a>.
              </Typography>
            )}
          </Box>
        )}

        {origen === 'adhoc' && (
          <Stack spacing={2} mt={2}>
            <Stack direction="row" spacing={2}>
              <TextField fullWidth size="small" label="Host"   value={host}   onChange={e => setHost(e.target.value)} />
              <TextField sx={{ width: 120 }} size="small" label="Puerto" type="number" value={port} onChange={e => setPort(e.target.value)} />
            </Stack>
            <TextField fullWidth size="small" label="Base de datos" value={dbname} onChange={e => setDbname(e.target.value)} />
            <Stack direction="row" spacing={2}>
              <TextField fullWidth size="small" label="Usuario"  value={usuario}  onChange={e => setUsuario(e.target.value)} />
              <TextField fullWidth size="small" label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
            </Stack>
          </Stack>
        )}

        <Stack direction="row" alignItems="center" spacing={2} mt={2}>
          <Button variant="outlined" onClick={probar} disabled={probando}>
            {probando ? 'Probando...' : 'Probar conexión'}
          </Button>
          {pruebaOk && (
            <Stack direction="row" alignItems="center" spacing={0.5} color="success.main">
              <CheckCircleIcon fontSize="small" />
              <Typography variant="body2">Conexión OK</Typography>
            </Stack>
          )}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mb: 2 }}>
        <FormLabel sx={{ fontWeight: 600 }}>Esquemas</FormLabel>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mt={2}>
          <TextField fullWidth size="small" label="Esquema origen"  value={esquemaOrigen}  onChange={e => setEsquemaOrigen(e.target.value)} />
          <TextField fullWidth size="small" label="Esquema destino" value={esquemaDestino} onChange={e => setEsquemaDestino(e.target.value)} />
        </Stack>
        <TextField
          fullWidth size="small" sx={{ mt: 2 }}
          label="Tabla de dominios" value={tablaDominios}
          onChange={e => setTablaDominios(e.target.value)}
          helperText="Default: homologacion1_0_1_2"
        />
      </Paper>

      <Divider sx={{ my: 2 }} />

      <Stack direction="row" spacing={2}>
        <Button onClick={() => navigate('/migracion-ladm')}>Cancelar</Button>
        <Button
          variant="contained" startIcon={<PlayArrowIcon />}
          onClick={ejecutar}
          disabled={creando || !pruebaOk || origen === 'adhoc' || !esquemaOrigen || !esquemaDestino}
        >
          {creando ? 'Iniciando...' : 'Ejecutar migración'}
        </Button>
      </Stack>
      {!pruebaOk && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Debes probar la conexión antes de ejecutar.
        </Typography>
      )}
    </Box>
  )
}
