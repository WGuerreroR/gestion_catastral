import { memo, useMemo } from 'react'
import {
  TextField, MenuItem, Typography, Box, Tooltip, CircularProgress
} from '@mui/material'
import useDominio from '../../../hooks/useDominio'

function SelectWidget({ field, value, onChange, modo, error, ayuda, validations = {} }) {
  const { items, loading, error: errorDominio } = useDominio(field.domain)

  const lookup = useMemo(() => {
    const m = new Map()
    for (const it of items || []) m.set(String(it.code), it.description)
    return m
  }, [items])

  if (modo === 'view') {
    const desc = value === null || value === undefined || value === ''
      ? null
      : (lookup.get(String(value)) ?? `${value} (sin descripción)`)
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">{field.label}</Typography>
        <Tooltip title={value !== null && value !== undefined ? `code: ${value}` : ''}>
          <Typography variant="body2" sx={{ minHeight: 22 }}>
            {loading
              ? <CircularProgress size={12} />
              : (desc ?? <em style={{ color: '#9e9e9e' }}>—</em>)
            }
          </Typography>
        </Tooltip>
      </Box>
    )
  }

  // modo edit
  const permiteVacio = field.permite_vacio !== false
  const labelVacio   = field.label_vacio ?? '— Seleccionar —'

  return (
    <TextField
      select
      label={field.label}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value
        onChange(raw === '' ? null : raw)
      }}
      size="small"
      fullWidth
      disabled={loading}
      helperText={error || errorDominio || ayuda}
      error={Boolean(error || errorDominio)}
      required={Boolean(validations.required)}
    >
      {permiteVacio && (
        <MenuItem value="">
          <em>{labelVacio}</em>
        </MenuItem>
      )}
      {(items || []).map(it => (
        <MenuItem key={it.code} value={String(it.code)}>
          {it.description}
        </MenuItem>
      ))}
    </TextField>
  )
}

export default memo(SelectWidget)
