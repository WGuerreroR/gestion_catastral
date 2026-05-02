import { memo } from 'react'
import { TextField, Typography, Box } from '@mui/material'

function formatNumero(value, decimales) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  if (typeof decimales === 'number') {
    return n.toLocaleString('es-CO', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    })
  }
  return n.toLocaleString('es-CO')
}

function NumberWidget({ field, value, onChange, modo, error, ayuda, placeholder, validations = {} }) {
  if (modo === 'view') {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">{field.label}</Typography>
        <Typography variant="body2" sx={{ minHeight: 22 }}>
          {formatNumero(value, field.decimales) ?? <em style={{ color: '#9e9e9e' }}>—</em>}
        </Typography>
      </Box>
    )
  }

  return (
    <TextField
      label={field.label}
      type="number"
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value
        onChange(raw === '' ? null : Number(raw))
      }}
      size="small"
      fullWidth
      placeholder={placeholder}
      helperText={error || ayuda}
      error={Boolean(error)}
      required={Boolean(validations.required)}
      inputProps={{
        step: field.step ?? 'any',
        min: validations.min,
        max: validations.max,
      }}
    />
  )
}

export default memo(NumberWidget)
