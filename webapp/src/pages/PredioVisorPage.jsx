import { useState } from 'react'
import { Box, TextField, IconButton, Paper, Typography, InputAdornment, Tooltip } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'

import PredioVisor from '../components/predio-visor/PredioVisor'
import predioCompletoLectura from '../config/predio-forms/predio-completo-lectura.json'

export default function PredioVisorPage() {
  const [input, setInput] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const handleBuscar = (e) => {
    e?.preventDefault?.()
    setBusqueda(input.trim())
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1280, mx: 'auto' }}>
      <Typography variant="h5" gutterBottom>Visor de predios</Typography>

      <Paper component="form" onSubmit={handleBuscar} sx={{ p: 2, mb: 3 }}>
        <TextField
          fullWidth
          label="Buscar por id_operacion o número predial"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          size="small"
          placeholder="id_operacion o número predial"
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title="Buscar">
                  <span>
                    <IconButton type="submit" color="primary" disabled={!input.trim()}>
                      <SearchIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </InputAdornment>
            )
          }}
        />
      </Paper>

      <PredioVisor
        formConfig={predioCompletoLectura}
        busqueda={busqueda}
      />
    </Box>
  )
}
