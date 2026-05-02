/**
 * Widget `geometry` (resumen).
 *
 * Cuando un campo geometry aparece en una sección tabular (no en la
 * sección mapa), se muestra como display read-only con tipo,
 * cantidad de vértices y un link "Ver en mapa". El link:
 *   - Hace scroll suave a la sección mapa (id DOM
 *     `predio-visor-mapa`).
 *   - Si el JSON declara `vincular_capa_id` + `id_feature_field`,
 *     dispara el sync (`useMapaPredioSync.select(...)`) para que el
 *     mapa haga zoom/highlight al feature correspondiente.
 *   - Si no hay sync configurado, solo hace scroll.
 *
 * NO renderiza un mini-mapa propio: todas las geometrías van al mapa
 * principal (decisión del plan original).
 */
import { memo } from 'react'
import { Box, Typography, Stack, Chip, Link } from '@mui/material'
import PlaceIcon      from '@mui/icons-material/Place'
import VisibilityIcon from '@mui/icons-material/Visibility'

import { useMapaPredioSync } from '../mapa/useMapaPredioSync'


function contarVertices(coords) {
  if (!Array.isArray(coords)) return 0
  // Caso base: un par [x, y] (o [x, y, z])
  if (typeof coords[0] === 'number') return 1
  let n = 0
  for (const sub of coords) n += contarVertices(sub)
  return n
}


function GeometrySummaryWidget({ field, value, registro }) {
  const { select } = useMapaPredioSync()

  const headerLabel = (
    <Typography variant="caption" color="text.secondary">{field.label}</Typography>
  )

  if (!value || !value.type) {
    return (
      <Box>
        {headerLabel}
        <Typography variant="body2" color="text.disabled">Sin geometría</Typography>
      </Box>
    )
  }

  const tipo     = value.type
  const vertices = contarVertices(value.coordinates)

  const capaId   = field.vincular_capa_id
  const idField  = field.id_feature_field
  const featureId = idField ? registro?.[idField] : null
  const tieneSync = Boolean(capaId && featureId !== null && featureId !== undefined)

  const handleVerEnMapa = () => {
    if (tieneSync) {
      select(capaId, featureId, 'list')
    }
    const el = document.getElementById('predio-visor-mapa')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <Box>
      {headerLabel}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', mt: 0.25 }}>
        <PlaceIcon fontSize="small" color="action" />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{tipo}</Typography>
        <Chip size="small" variant="outlined" label={`${vertices} vértices`} />
        <Link
          component="button"
          type="button"
          onClick={handleVerEnMapa}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5,
            fontSize: 13, ml: 1, textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          <VisibilityIcon sx={{ fontSize: 16 }} />
          Ver en mapa
        </Link>
      </Stack>
    </Box>
  )
}

export default memo(GeometrySummaryWidget)
