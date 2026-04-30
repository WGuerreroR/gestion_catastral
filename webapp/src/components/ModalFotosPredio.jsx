/**
 * ModalFotosPredio.jsx
 *
 * Galería de fotos asociadas a un predio:
 *   - lc_predio_p.foto, foto_2
 *   - cr_caracteristicasunidadconstruccion (todas las unidades del predio)
 *
 * Usa el endpoint GET /proyectos/{id}/predios/{id_operacion}/fotos para
 * listar las URLs y renderea un grid con thumbnails. Click en una abre
 * el visor a tamaño completo.
 */

import { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Stack, Chip, CircularProgress,
  Grid, Alert, IconButton, Tooltip,
} from '@mui/material'
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary'
import CloseIcon        from '@mui/icons-material/Close'
import OpenInFullIcon   from '@mui/icons-material/OpenInFull'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'

// Las URLs que devuelve el backend son paths absolutos tipo "/api/v1/...".
// Como <img src> no pasa por axios, hay que prependerles el host de la API.
const API_HOST = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
const urlAbsoluta = (path) => `${API_HOST}${path}`


export default function ModalFotosPredio({ open, onClose, proyectoId, idOperacion }) {
  const [fotos,    setFotos]    = useState([])
  const [cargando, setCargando] = useState(false)
  const [error,    setError]    = useState('')
  const [visor,    setVisor]    = useState(null)  // foto seleccionada para fullscreen

  useEffect(() => {
    if (!open || !proyectoId || !idOperacion) return
    let cancelled = false

    // Disparar el fetch en una microtask para no llamar setState sync en el
    // cuerpo del effect (regla react-hooks/set-state-in-effect).
    Promise.resolve().then(() => {
      if (cancelled) return
      setCargando(true)
      setFotos([])
      setError('')
      setVisor(null)
    })

    api.get(`/proyectos/${proyectoId}/predios/${encodeURIComponent(idOperacion)}/fotos`)
      .then(r => { if (!cancelled) setFotos(r.data?.fotos || []) })
      .catch(err => { if (!cancelled) setError(getErrorMessage(err, 'No se pudieron cargar las fotos')) })
      .finally(() => { if (!cancelled) setCargando(false) })

    return () => { cancelled = true }
  }, [open, proyectoId, idOperacion])

  // Agrupar por unidad de construcción para que la galería sea ordenada
  const grupos = agruparPorUnidad(fotos)

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PhotoLibraryIcon color="primary" />
          Fotos del predio <code>{idOperacion}</code>
        </DialogTitle>

        <DialogContent dividers>
          {cargando && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={20} />
              <Typography variant="body2">Cargando fotos…</Typography>
            </Stack>
          )}

          {!cargando && error && (
            <Alert severity="error">{error}</Alert>
          )}

          {!cargando && !error && fotos.length === 0 && (
            <Alert severity="info">
              Este predio no tiene fotos asociadas todavía.
            </Alert>
          )}

          {!cargando && grupos.map(({ titulo, items }) => (
            <Box key={titulo} sx={{ mb: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                {titulo}
              </Typography>
              <Grid container spacing={1}>
                {items.map(f => (
                  <Grid item xs={6} sm={4} md={3} key={`${f.tabla}-${f.id_referencia}-${f.campo}`}>
                    <FotoTile foto={f} onAmpliar={() => setVisor(f)} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          ))}
        </DialogContent>

        <DialogActions>
          {!cargando && fotos.length > 0 && (
            <Chip size="small" label={`${fotos.length} foto${fotos.length !== 1 ? 's' : ''}`} />
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={onClose}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* Visor a tamaño completo */}
      <Dialog open={Boolean(visor)} onClose={() => setVisor(null)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography variant="subtitle1">{visor?.label}</Typography>
          <Box sx={{ flex: 1 }} />
          <IconButton onClick={() => setVisor(null)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', justifyContent: 'center', p: 1 }}>
          {visor && (
            <img
              src={urlAbsoluta(visor.url)}
              alt={visor.label}
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}


function FotoTile({ foto, onAmpliar }) {
  const [errorImg, setErrorImg] = useState(false)
  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: 'grey.100',
        borderRadius: 1,
        overflow: 'hidden',
        aspectRatio: '4 / 3',
        cursor: 'pointer',
        '&:hover .overlay': { opacity: 1 },
      }}
      onClick={onAmpliar}
    >
      {!errorImg ? (
        <img
          src={urlAbsoluta(foto.url)}
          alt={foto.label}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setErrorImg(true)}
        />
      ) : (
        <Box sx={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'text.secondary', fontSize: 12, p: 1, textAlign: 'center',
        }}>
          No se pudo cargar la imagen
        </Box>
      )}

      {/* Overlay con label + botón ampliar */}
      <Box
        className="overlay"
        sx={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.7) 100%)',
          opacity: 0.85, transition: 'opacity 0.15s',
          display: 'flex', alignItems: 'flex-end', p: 1,
        }}
      >
        <Typography
          variant="caption"
          sx={{ color: 'white', flex: 1, lineHeight: 1.2, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
        >
          {foto.label}
        </Typography>
        <Tooltip title="Ampliar">
          <IconButton size="small" sx={{ color: 'white' }} onClick={(e) => { e.stopPropagation(); onAmpliar() }}>
            <OpenInFullIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}


// Agrupa por: "Predio" (lc_predio_p) y por cada unidad de construcción (id_referencia)
function agruparPorUnidad(fotos) {
  const buckets = new Map()
  for (const f of fotos) {
    const key = f.tabla === 'lc_predio_p' ? '__predio__' : `unidad_${f.id_referencia}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        titulo: f.tabla === 'lc_predio_p'
          ? 'Predio'
          : `Unidad de construcción · ${f.id_referencia}`,
        items: [],
      })
    }
    buckets.get(key).items.push(f)
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => {
      if (a === '__predio__') return -1
      if (b === '__predio__') return 1
      return a.localeCompare(b)
    })
    .map(([, v]) => v)
}
