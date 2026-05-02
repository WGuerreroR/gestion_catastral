/**
 * Widget `photo`.
 *
 * Modo `view`: thumbnail clickable que abre un lightbox (Dialog MUI a tamaño
 *              completo). Si la imagen 404, muestra placeholder "Foto no
 *              disponible".
 *
 * Modo `edit`: muestra el thumbnail + un aviso de que la edición de fotos
 *              todavía no está habilitada (necesita endpoint de upload —
 *              parte del paso 12 del plan iterativo).
 *
 * URL: el path guardado en BD es relativo (ej. "DCIM/IMG_xxx.jpg") y se
 * resuelve contra `/api/v1/predios/{idOperacion}/fotos/{ruta}`. Por eso
 * el widget recibe `idOperacion` como contexto desde PredioVisor.
 */
import { memo, useState } from 'react'
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, IconButton, Alert
} from '@mui/material'
import CloseIcon         from '@mui/icons-material/Close'
import BrokenImageIcon   from '@mui/icons-material/BrokenImage'
import PhotoOutlinedIcon from '@mui/icons-material/PhotoOutlined'

import { urlFotoPredio } from '../../../api/predios'

const TAMANO_THUMB = 150

function PhotoWidget({ field, value, modo, idOperacion, ayuda }) {
  const [errorImg, setErrorImg] = useState(false)
  const [lightbox, setLightbox] = useState(false)

  const url = idOperacion && value ? urlFotoPredio(idOperacion, value) : null
  const tieneRuta = Boolean(value)

  const labelHeader = (
    <Typography variant="caption" color="text.secondary">
      {field.label}
    </Typography>
  )

  if (!tieneRuta) {
    return (
      <Box>
        {labelHeader}
        <Box
          sx={{
            mt: 0.5,
            width: TAMANO_THUMB, height: TAMANO_THUMB,
            border: '1px dashed', borderColor: 'divider',
            borderRadius: 1, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column',
            color: 'text.disabled', bgcolor: 'grey.50',
          }}
        >
          <PhotoOutlinedIcon fontSize="large" />
          <Typography variant="caption">Sin foto</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box>
      {labelHeader}

      <Box
        onClick={() => !errorImg && setLightbox(true)}
        sx={{
          mt: 0.5,
          position: 'relative',
          width: TAMANO_THUMB, height: TAMANO_THUMB,
          borderRadius: 1, overflow: 'hidden',
          border: '1px solid', borderColor: 'divider',
          cursor: errorImg ? 'default' : 'zoom-in',
          bgcolor: 'grey.100',
        }}
      >
        {!errorImg ? (
          <img
            src={url}
            alt={field.label}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setErrorImg(true)}
          />
        ) : (
          <Box sx={{
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'text.secondary', textAlign: 'center', p: 1,
          }}>
            <BrokenImageIcon />
            <Typography variant="caption">Foto no disponible</Typography>
          </Box>
        )}
      </Box>

      {modo === 'edit' && (
        <Alert severity="info" sx={{ mt: 1, py: 0.25, fontSize: 12 }}>
          La edición de fotos se habilita cuando esté el endpoint de upload.
        </Alert>
      )}

      {ayuda && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {ayuda}
        </Typography>
      )}

      <Dialog open={lightbox} onClose={() => setLightbox(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography variant="subtitle1">{field.label}</Typography>
          <Box sx={{ flex: 1 }} />
          <IconButton onClick={() => setLightbox(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', justifyContent: 'center', p: 1 }}>
          <img
            src={url}
            alt={field.label}
            style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
          />
        </DialogContent>
      </Dialog>
    </Box>
  )
}

export default memo(PhotoWidget)
