import { memo } from 'react'
import { TextField, Typography, Box } from '@mui/material'

function TextareaWidget({ field, value, onChange, modo, error, ayuda, placeholder, validations = {} }) {
  if (modo === 'view') {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">{field.label}</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', minHeight: 22 }}>
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
      multiline
      minRows={field.rows || 3}
      maxRows={field.rows ? field.rows + 4 : 8}
      fullWidth
      size="small"
      placeholder={placeholder}
      helperText={error || ayuda}
      error={Boolean(error)}
      required={Boolean(validations.required)}
      inputProps={{ maxLength: validations.maxLength }}
    />
  )
}

export default memo(TextareaWidget)
