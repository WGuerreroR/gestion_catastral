import { memo } from 'react'
import { TextField, Typography, Box } from '@mui/material'

function formatear(value, formato = 'DD/MM/YYYY') {
  if (!value) return null
  const d = typeof value === 'string' ? value.slice(0, 10) : value
  const [y, m, day] = String(d).split('-')
  if (!y || !m || !day) return String(value)
  return formato
    .replace('YYYY', y)
    .replace('MM', m)
    .replace('DD', day)
}

function DateWidget({ field, value, onChange, modo, error, ayuda, validations = {} }) {
  if (modo === 'view') {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">{field.label}</Typography>
        <Typography variant="body2" sx={{ minHeight: 22 }}>
          {formatear(value, field.formato_display) ?? <em style={{ color: '#9e9e9e' }}>—</em>}
        </Typography>
      </Box>
    )
  }

  return (
    <TextField
      label={field.label}
      type="date"
      value={value ? String(value).slice(0, 10) : ''}
      onChange={(e) => onChange(e.target.value || null)}
      size="small"
      fullWidth
      InputLabelProps={{ shrink: true }}
      helperText={error || ayuda}
      error={Boolean(error)}
      required={Boolean(validations.required)}
      inputProps={{
        min: validations.min,
        // Resolver "today" como atajo si llega
        max: validations.max === 'today'
          ? new Date().toISOString().slice(0, 10)
          : validations.max,
      }}
    />
  )
}

export default memo(DateWidget)
