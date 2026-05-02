import { memo } from 'react'
import {
  Box, FormControlLabel, Checkbox, Typography, Stack, Tooltip
} from '@mui/material'
import { colorRepresentativoCapa } from './EstilosMapa'

/**
 * Panel lateral con checkboxes por capa. Las capas se ordenan por
 * `z_index` ascendente (al estilo "leyenda de mapa": las capas más al
 * fondo aparecen primero).
 */
function ControlCapas({ capas, visibilidad, onToggle }) {
  const ordenadas = [...capas].sort(
    (a, b) => (a.z_index ?? 0) - (b.z_index ?? 0)
  )

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.5,
        minWidth: 200,
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Capas
      </Typography>
      <Stack spacing={0}>
        {ordenadas.map((capa) => {
          const color = colorRepresentativoCapa(capa)
          return (
            <FormControlLabel
              key={capa.id}
              sx={{ mr: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={Boolean(visibilidad[capa.id])}
                  onChange={(e) => onToggle(capa.id, e.target.checked)}
                />
              }
              label={
                <Stack direction="row" spacing={1} alignItems="center">
                  <Tooltip title={`Color: ${color}`}>
                    <Box
                      sx={{
                        width: 12, height: 12, borderRadius: 0.5,
                        bgcolor: color,
                        border: '1px solid', borderColor: 'rgba(0,0,0,0.2)',
                      }}
                    />
                  </Tooltip>
                  <Typography variant="body2">{capa.label}</Typography>
                </Stack>
              }
            />
          )
        })}
      </Stack>
    </Box>
  )
}

export default memo(ControlCapas)
