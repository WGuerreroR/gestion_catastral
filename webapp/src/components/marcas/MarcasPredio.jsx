import { useEffect, useState, useCallback } from 'react'
import {
  Accordion, AccordionSummary, AccordionDetails,
  Box, Typography, Button, Chip, Stack, IconButton, ToggleButtonGroup, ToggleButton,
  CircularProgress, Tooltip
} from '@mui/material'
import ExpandMoreIcon  from '@mui/icons-material/ExpandMore'
import AddIcon         from '@mui/icons-material/Add'
import RefreshIcon     from '@mui/icons-material/Refresh'
import BookmarkIcon    from '@mui/icons-material/Bookmark'
import marcasPredioApi from '../../api/marcasPredio'
import { useAuth }     from '../../hooks/useAuth'
import MarcaCard       from './MarcaCard'
import MarcaDialog     from './MarcaDialog'

export default function MarcasPredio({ idOperacion, categoria, onMarcasChanged }) {
  const { hasRole } = useAuth()
  const puedeGestionar = hasRole('administrador') || hasRole('supervisor')

  const [marcas, setMarcas]   = useState([])
  const [filtro, setFiltro]   = useState('TODAS')   // TODAS | ABIERTA | CERRADA
  const [cargando, setCargando] = useState(false)
  const [dialogo, setDialogo] = useState({ open: false, modo: null, marca: null })

  const cargar = useCallback(async () => {
    if (!idOperacion) return
    setCargando(true)
    try {
      const data = await marcasPredioApi.listar(idOperacion, { categoria })
      setMarcas(data)
    } catch {
      setMarcas([])
    } finally {
      setCargando(false)
    }
  }, [idOperacion, categoria])

  useEffect(() => { cargar() }, [cargar])

  const visibles = filtro === 'TODAS' ? marcas : marcas.filter(m => m.estado === filtro)
  const abiertas = marcas.filter(m => m.estado === 'ABIERTA').length
  const total    = marcas.length

  return (
    <>
      <Accordion variant="outlined" disableGutters sx={{ mt: 1.5, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <BookmarkIcon fontSize="small" color="action" />
            <Typography variant="body2" fontWeight={600}>Marcas</Typography>
            {total > 0 && (
              <Chip
                size="small"
                label={`${abiertas} abierta${abiertas === 1 ? '' : 's'} / ${total}`}
                color={abiertas > 0 ? 'warning' : 'default'}
                sx={{ height: 20 }}
              />
            )}
            {total === 0 && (
              <Typography variant="caption" color="text.secondary">— sin registros</Typography>
            )}
          </Box>
        </AccordionSummary>

        <AccordionDetails sx={{ pt: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              size="small" exclusive
              value={filtro}
              onChange={(_, v) => v && setFiltro(v)}
            >
              <ToggleButton value="TODAS">Todas ({total})</ToggleButton>
              <ToggleButton value="ABIERTA">Abiertas ({abiertas})</ToggleButton>
              <ToggleButton value="CERRADA">Cerradas ({total - abiertas})</ToggleButton>
            </ToggleButtonGroup>

            <Box sx={{ flexGrow: 1 }} />

            <Tooltip title="Recargar">
              <IconButton size="small" onClick={cargar} disabled={cargando}>
                {cargando ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </Tooltip>

            {puedeGestionar && (
              <Button
                size="small" variant="contained" startIcon={<AddIcon />}
                onClick={() => setDialogo({ open: true, modo: 'crear', marca: null })}
              >
                Agregar marca
              </Button>
            )}
          </Box>

          {visibles.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', py: 2 }}>
              {total === 0
                ? 'Aún no se han registrado marcas para esta categoría.'
                : 'No hay marcas que coincidan con el filtro.'}
            </Typography>
          ) : (
            <Stack spacing={1}>
              {visibles.map(m => (
                <MarcaCard
                  key={m.id} marca={m}
                  onClick={() => setDialogo({ open: true, modo: 'detalle', marca: m })}
                />
              ))}
            </Stack>
          )}
        </AccordionDetails>
      </Accordion>

      <MarcaDialog
        open={dialogo.open}
        modo={dialogo.modo}
        categoria={categoria}
        idOperacion={idOperacion}
        marca={dialogo.marca}
        puedeGestionar={puedeGestionar}
        onClose={() => setDialogo({ open: false, modo: null, marca: null })}
        onChange={() => { cargar(); onMarcasChanged?.() }}
      />
    </>
  )
}
