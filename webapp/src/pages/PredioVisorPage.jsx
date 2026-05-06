import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Box, TextField, IconButton, Paper, Typography, InputAdornment, Tooltip,
  Alert, Stack, Chip, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress
} from '@mui/material'
import SearchIcon       from '@mui/icons-material/Search'
import LockIcon         from '@mui/icons-material/Lock'
import VisibilityIcon   from '@mui/icons-material/Visibility'
import BookmarkIcon     from '@mui/icons-material/Bookmark'

import PredioVisor from '../components/predio-visor/PredioVisor'
import predioCompletoLectura from '../config/predio-forms/predio-completo-lectura.json'
import marcasPredioApi from '../api/marcasPredio'
import MarcaDialog from '../components/marcas/MarcaDialog'
import { useAuth } from '../hooks/useAuth'

const META_CATEGORIA = {
  IDENTIFICACION: { color: '#0097A7', label: 'Identificación' },
  SIG:            { color: '#2E7D32', label: 'SIG' },
  FISICA:         { color: '#1565C0', label: 'Física' },
  JURIDICA:       { color: '#6A1B9A', label: 'Jurídica' },
  ECONOMICA:      { color: '#C62828', label: 'Económica' },
}

export default function PredioVisorPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()

  const busquedaURL = searchParams.get('busqueda') || ''
  const marcaIdURL  = searchParams.get('marca_id')

  const [input, setInput]       = useState(busquedaURL)
  const [busqueda, setBusqueda] = useState(busquedaURL)
  const [marca, setMarca]       = useState(null)
  const [cargandoMarca, setCargandoMarca] = useState(false)
  const [errorMarca, setErrorMarca]       = useState('')
  const [dialogo, setDialogo]   = useState(false)
  const [confirmCerrar, setConfirmCerrar] = useState(false)
  const [obsCierre, setObsCierre]         = useState('')
  const [cerrando, setCerrando]           = useState(false)

  // Cuando cambia ?busqueda en URL, sincroniza state local
  useEffect(() => {
    setInput(busquedaURL)
    setBusqueda(busquedaURL)
  }, [busquedaURL])

  const cargarMarca = useCallback(async () => {
    if (!busquedaURL || !marcaIdURL) {
      setMarca(null)
      return
    }
    setCargandoMarca(true)
    setErrorMarca('')
    try {
      const lista = await marcasPredioApi.listar(busquedaURL, {})
      const m = (lista || []).find(x => String(x.id) === String(marcaIdURL))
      if (!m) {
        setErrorMarca('La marca indicada no existe en este predio.')
        setMarca(null)
      } else if (
        m.responsable_id == null ||
        user?.sub == null ||
        String(m.responsable_id) !== String(user.sub)
      ) {
        setErrorMarca('No eres el responsable de esta marca, así que el modo edición no se activa.')
        setMarca(null)
      } else {
        setMarca(m)
      }
    } catch (e) {
      setErrorMarca(e?.response?.data?.detail || 'No se pudo cargar la información de la marca.')
      setMarca(null)
    } finally {
      setCargandoMarca(false)
    }
  }, [busquedaURL, marcaIdURL, user?.sub])

  useEffect(() => { cargarMarca() }, [cargarMarca])

  const handleBuscar = (e) => {
    e?.preventDefault?.()
    const v = input.trim()
    setBusqueda(v)
    // Al hacer búsqueda manual descartamos el contexto de marca
    setSearchParams(v ? { busqueda: v } : {})
  }

  const cerrarMarca = async () => {
    setCerrando(true)
    try {
      await marcasPredioApi.cerrar(busqueda, marca.id, obsCierre || null)
      setConfirmCerrar(false)
      setObsCierre('')
      // Después del cierre, ya no hay contexto edición — limpiamos marca_id
      setSearchParams({ busqueda })
      setMarca(null)
    } catch (e) {
      setErrorMarca(e?.response?.data?.detail || 'No se pudo cerrar la marca.')
    } finally {
      setCerrando(false)
    }
  }

  const enModoMarca = !!marca && marca.estado === 'ABIERTA'
  const meta = enModoMarca ? META_CATEGORIA[marca.categoria] : null

  return (
    <Box sx={{ p: 3, maxWidth: 1280, mx: 'auto' }}>
      <Typography variant="h5" gutterBottom>Visor de predios</Typography>

      <Paper component="form" onSubmit={handleBuscar} sx={{ p: 2, mb: 3 }}>
        <TextField
          fullWidth
          label="Buscar por id_operacion o número predial"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          size="small"
          placeholder="id_operacion o número predial"
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title="Buscar">
                  <span>
                    <IconButton type="submit" color="primary" disabled={!input.trim()}>
                      <SearchIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </InputAdornment>
            )
          }}
        />
      </Paper>

      {cargandoMarca && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <CircularProgress size={14} sx={{ mr: 1 }} /> Cargando marca asignada…
        </Alert>
      )}

      {errorMarca && !cargandoMarca && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setErrorMarca('')}>
          {errorMarca}
        </Alert>
      )}

      {enModoMarca && (
        <Alert
          icon={<BookmarkIcon />}
          severity="info"
          sx={{
            mb: 2,
            borderLeft: '4px solid',
            borderLeftColor: meta?.color || 'primary.main',
            '& .MuiAlert-message': { width: '100%' }
          }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <Box sx={{ flexGrow: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography variant="body2" fontWeight={700}>
                  Estás atendiendo la marca {marca.tipo_marca_codigo}
                </Typography>
                <Chip
                  size="small" label={meta?.label || marca.categoria}
                  sx={{ bgcolor: meta?.color, color: 'white', fontWeight: 600 }}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {marca.descripcion_novedad}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                size="small" variant="outlined"
                startIcon={<VisibilityIcon />}
                onClick={() => setDialogo(true)}
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

      <PredioVisor
        formConfig={predioCompletoLectura}
        busqueda={busqueda}
        bypassRolesEdicion={enModoMarca}
      />

      {/* Detalle completo de la marca (timeline + acciones) */}
      <MarcaDialog
        open={dialogo}
        modo="detalle"
        categoria={marca?.categoria}
        idOperacion={busqueda}
        marca={marca}
        puedeGestionar={!!marca && marca.estado === 'ABIERTA'}
        onClose={() => setDialogo(false)}
        onChange={() => {
          setDialogo(false)
          // Si se cerró desde el dialog, recargamos
          cargarMarca()
        }}
      />

      {/* Confirmación rápida de cierre con observación */}
      <Dialog open={confirmCerrar} onClose={() => !cerrando && setConfirmCerrar(false)} fullWidth maxWidth="sm">
        <DialogTitle>Cerrar marca</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Vas a cerrar la marca {marca?.tipo_marca_codigo}. Esta acción queda registrada en el historial.
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
          <Button onClick={() => setConfirmCerrar(false)} disabled={cerrando}>Cancelar</Button>
          <Button
            variant="contained" color="error"
            onClick={cerrarMarca} disabled={cerrando}
            startIcon={cerrando ? <CircularProgress size={14} color="inherit" /> : <LockIcon />}
          >
            Confirmar cierre
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
