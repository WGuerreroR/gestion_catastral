import { memo } from 'react'
import {
  Box, Typography, Switch, Checkbox, FormControlLabel,
  RadioGroup, Radio, FormHelperText
} from '@mui/material'

function BooleanWidget({ field, value, onChange, modo, error, ayuda }) {
  const labels = field.labels || { true: 'Sí', false: 'No' }
  const estilo = field.estilo || 'switch'
  const checked = Boolean(value)

  if (modo === 'view') {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">{field.label}</Typography>
        <Typography variant="body2" sx={{ minHeight: 22 }}>
          {value === null || value === undefined
            ? <em style={{ color: '#9e9e9e' }}>—</em>
            : (checked ? labels.true : labels.false)}
        </Typography>
      </Box>
    )
  }

  if (estilo === 'radio_si_no') {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">{field.label}</Typography>
        <RadioGroup
          row
          value={value === null || value === undefined ? '' : String(checked)}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <FormControlLabel value="true"  control={<Radio size="small" />} label={labels.true} />
          <FormControlLabel value="false" control={<Radio size="small" />} label={labels.false} />
        </RadioGroup>
        <FormHelperText error={Boolean(error)}>{error || ayuda}</FormHelperText>
      </Box>
    )
  }

  const Control = estilo === 'checkbox' ? Checkbox : Switch
  return (
    <Box>
      <FormControlLabel
        control={
          <Control
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            size="small"
          />
        }
        label={field.label}
      />
      {(error || ayuda) && (
        <FormHelperText error={Boolean(error)}>{error || ayuda}</FormHelperText>
      )}
    </Box>
  )
}

export default memo(BooleanWidget)
