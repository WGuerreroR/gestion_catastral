import { memo } from 'react'
import { TextField, Typography, Box } from '@mui/material'

function formatearFechaHora(value, formato = 'DD/MM/YYYY HH:mm') {
  if (!value) return null
  const s = String(value)
  const [fecha, horaCompleta = ''] = s.split('T')
  const [y, m, d] = fecha.split('-')
  const [h = '00', min = '00'] = horaCompleta.split(':')
  if (!y || !m || !d) return s
  return formato
    .replace('YYYY', y)
    .replace('MM', m)
    .replace('DD', d)
    .replace('HH', h.padStart(2, '0'))
    .replace('mm', min.padStart(2, '0'))
}

function DatetimeWidget({ field, value, onChange, modo, error, ayuda, validations = {} }) {
  if (modo === 'view') {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">{field.label}</Typography>
        <Typography variant="body2" sx={{ minHeight: 22 }}>
          {formatearFechaHora(value, field.formato_display) ?? <em style={{ color: '#9e9e9e' }}>—</em>}
        </Typography>
      </Box>
    )
  }

  // input datetime-local pide formato YYYY-MM-DDTHH:mm
  const inputValue = value ? String(value).slice(0, 16).replace(' ', 'T') : ''
  return (
    <TextField
      label={field.label}
      type="datetime-local"
      value={inputValue}
      onChange={(e) => onChange(e.target.value || null)}
      size="small"
      fullWidth
      InputLabelProps={{ shrink: true }}
      helperText={error || ayuda}
      error={Boolean(error)}
      required={Boolean(validations.required)}
    />
  )
}

export default memo(DatetimeWidget)
