import {
  Card, CardActionArea, CardContent, Box, Typography, Chip, Stack
} from '@mui/material'
import PersonIcon       from '@mui/icons-material/Person'
import EventIcon        from '@mui/icons-material/Event'
import CheckCircleIcon  from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'

const COLOR_PRIORIDAD = { ALTA: 'error', MEDIA: 'warning', BAJA: 'info' }

function formatearFecha(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MarcaCard({ marca, onClick }) {
  const cerrada = marca.estado === 'CERRADA'

  return (
    <Card
      variant="outlined"
      sx={{
        opacity: cerrada ? 0.7 : 1,
        borderColor: cerrada ? 'divider' : 'primary.light',
      }}
    >
      <CardActionArea onClick={onClick}>
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1, lineHeight: 1.25 }}>
              {marca.tipo_marca_codigo} — {marca.tipo_marca_significado}
            </Typography>
            <Chip
              size="small"
              label={cerrada ? 'Cerrada' : 'Abierta'}
              color={cerrada ? 'default' : 'success'}
              icon={cerrada ? <CheckCircleIcon /> : <RadioButtonUncheckedIcon />}
              sx={{ height: 22 }}
            />
          </Box>

          {marca.descripcion_novedad && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {marca.descripcion_novedad}
            </Typography>
          )}

          <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`Prioridad ${marca.prioridad}`} color={COLOR_PRIORIDAD[marca.prioridad]} variant="outlined" sx={{ height: 20 }} />
            <Chip size="small" label={marca.estado_esperado} variant="outlined" sx={{ height: 20 }} />
          </Stack>

          <Stack direction="row" spacing={1.5} mt={1} sx={{ color: 'text.secondary' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <PersonIcon sx={{ fontSize: 14 }} />
              <Typography variant="caption">{marca.responsable_nombre || '— sin responsable'}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <EventIcon sx={{ fontSize: 14 }} />
              <Typography variant="caption">{formatearFecha(marca.fecha_creacion)}</Typography>
            </Box>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
