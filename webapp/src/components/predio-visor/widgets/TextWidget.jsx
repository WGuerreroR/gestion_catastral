import { memo } from 'react'
import { TextField, Typography, Box } from '@mui/material'

function TextWidget({ field, value, onChange, modo, error, ayuda, placeholder, validations = {} }) {
  if (modo === 'view') {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">{field.label}</Typography>
        <Typography variant="body2" sx={{ minHeight: 22, wordBreak: 'break-word' }}>
          {value ?? <em style={{ color: '#9e9e9e' }}>—</em>}
        </Typography>
      </Box>
    )
  }

  return (
    <TextField
      label={field.label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      size="small"
      fullWidth
      placeholder={placeholder}
      helperText={error || ayuda}
      error={Boolean(error)}
      required={Boolean(validations.required)}
      inputProps={{
        maxLength: validations.maxLength,
        minLength: validations.minLength,
      }}
    />
  )
}

export default memo(TextWidget)
