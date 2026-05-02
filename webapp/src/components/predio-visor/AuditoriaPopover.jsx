/**
 * Popover de auditoría por campo.
 *
 * Renderiza un ícono `HistoryIcon` chiquito al lado del campo. Al
 * hacer click, abre un popover que llama a
 *   GET /predios/{id_operacion}/auditoria/{tabla}/{pk}
 *
 * Hoy el endpoint es un stub (siempre devuelve cambios=[]); por eso
 * el popover muestra "Sin cambios registrados aún" + nota de que la
 * auditoría detallada llega en una próxima fase. Cuando el backend
 * devuelva cambios reales con la forma:
 *
 *   { tabla, pk, cambios: [
 *     { campo, valor_anterior, valor_nuevo, usuario, fecha }, ...
 *   ] }
 *
 * el popover los renderiza sin tocar el componente.
 */
import { memo, useState } from 'react'
import {
  IconButton, Popover, Box, Typography, CircularProgress, Alert,
  List, ListItem, ListItemText, Divider, Tooltip,
} from '@mui/material'
import HistoryIcon from '@mui/icons-material/History'

import { getAuditoriaCampo } from '../../api/predios'
import { getErrorMessage } from '../../utils/errorHandler'


function AuditoriaPopover({ label, tabla, pk, idOperacion, campo }) {
  const [anchor, setAnchor]   = useState(null)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const open = Boolean(anchor)

  const handleOpen = async (e) => {
    e.stopPropagation()
    setAnchor(e.currentTarget)
    if (data || loading) return     // ya cargado o en vuelo
    setLoading(true)
    setError(null)
    try {
      const res = await getAuditoriaCampo(idOperacion, tabla, pk)
      setData(res)
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cargar la auditoría'))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = (e) => {
    e?.stopPropagation?.()
    setAnchor(null)
  }

  const cambiosCampo = (data?.cambios || []).filter(
    c => !campo || !c.campo || c.campo === campo
  )

  return (
    <>
      <Tooltip title="Histórico de cambios" placement="top">
        <IconButton
          size="small"
          onClick={handleOpen}
          sx={{ p: 0.25, opacity: 0.5, '&:hover': { opacity: 1 } }}
        >
          <HistoryIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { minWidth: 280, maxWidth: 380 } } }}
      >
        <Box sx={{ p: 1.5 }}>
          <Typography variant="overline" color="text.secondary">
            Histórico
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {label}
          </Typography>
          <Divider sx={{ mb: 1 }} />

          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
              <CircularProgress size={14} />
              <Typography variant="caption">Cargando…</Typography>
            </Box>
          )}

          {!loading && error && (
            <Alert severity="error" sx={{ py: 0.25 }}>{error}</Alert>
          )}

          {!loading && !error && cambiosCampo.length === 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary">
                Sin cambios registrados aún
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
                La auditoría detallada se habilitará en una próxima fase.
              </Typography>
            </Box>
          )}

          {!loading && !error && cambiosCampo.length > 0 && (
            <List dense disablePadding>
              {cambiosCampo.map((c, i) => (
                <ListItem key={i} alignItems="flex-start" sx={{ px: 0 }}>
                  <ListItemText
                    primary={
                      <Typography variant="body2">
                        <strong>{c.valor_anterior ?? '—'}</strong>
                        {'  →  '}
                        <strong>{c.valor_nuevo ?? '—'}</strong>
                      </Typography>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {c.usuario || 'Usuario desconocido'}
                        {c.fecha ? ` · ${new Date(c.fecha).toLocaleString('es-CO')}` : ''}
                      </Typography>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Popover>
    </>
  )
}

export default memo(AuditoriaPopover)
