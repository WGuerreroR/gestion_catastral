/**
 * ModalDetalleSync.jsx
 *
 * Modal de solo lectura que muestra el detalle de un sync offline ya
 * registrado en sync_history. Reusable: el botón "Ver detalle" del
 * historial lo abre con un syncId específico.
 *
 * El botón "Descargar reporte" está siempre disponible (también para syncs
 * ok, útil para auditoría); usa el endpoint .txt del backend.
 */

import { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Stack, Chip, CircularProgress,
  Alert, Paper, Table, TableHead, TableBody, TableRow, TableCell,
} from '@mui/material'
import HistoryIcon  from '@mui/icons-material/History'
import DownloadIcon from '@mui/icons-material/Download'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'


const ESTADOS_FINALES = ['ok', 'error', 'parcial', 'idempotente']
const colorEstado = {
  ok:           'success',
  parcial:      'warning',
  error:        'error',
  idempotente:  'info',
  encolado:     'default',
  corriendo:    'info',
}


export default function ModalDetalleSync({ open, onClose, syncId }) {
  const [detalle,  setDetalle]  = useState(null)
  const [cargando, setCargando] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!open || !syncId) return
    let cancelled = false

    Promise.resolve().then(() => {
      if (cancelled) return
      setCargando(true)
      setDetalle(null)
      setErrorMsg('')
    })

    api.get(`/proyectos/offline/sync/${syncId}/detalle`)
      .then(r => { if (!cancelled) setDetalle(r.data) })
      .catch(err => {
        if (!cancelled) setErrorMsg(getErrorMessage(err, 'No se pudo cargar el detalle'))
      })
      .finally(() => { if (!cancelled) setCargando(false) })

    return () => { cancelled = true }
  }, [open, syncId])

  async function descargarReporte() {
    if (!syncId) return
    try {
      const r = await api.get(`/proyectos/offline/sync/${syncId}/reporte.txt`,
        { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `sync_${syncId}_reporte.txt`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorMsg(getErrorMessage(err, 'No se pudo descargar el reporte'))
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <HistoryIcon color="primary" />
        Detalle de sync #{syncId}
      </DialogTitle>

      <DialogContent dividers>
        {cargando && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={20} />
            <Typography variant="body2">Cargando detalle…</Typography>
          </Stack>
        )}

        {errorMsg && (
          <Alert severity="error" onClose={() => setErrorMsg('')}>
            {errorMsg}
          </Alert>
        )}

        {detalle && <CuerpoDetalle detalle={detalle} />}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cerrar</Button>
        {detalle && (
          <Button
            variant="outlined"
            color="warning"
            startIcon={<DownloadIcon />}
            onClick={descargarReporte}
          >
            Descargar reporte
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}


function CuerpoDetalle({ detalle }) {
  const final = ESTADOS_FINALES.includes(detalle.estado)
  const resumen = detalle.resumen || {}
  const fotos   = detalle.fotos_resumen || {}

  return (
    <Box>
      {/* Encabezado */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Chip
          size="small"
          color={colorEstado[detalle.estado] || 'default'}
          icon={!final ? <CircularProgress size={14} /> : undefined}
          label={`Estado: ${detalle.estado}`}
        />
        {detalle.estado_anterior && detalle.estado_nuevo && (
          <Chip
            size="small"
            color="success"
            label={`${detalle.estado_anterior} → ${detalle.estado_nuevo}`}
          />
        )}
        {detalle.forzado && <Chip size="small" color="warning" label="forzado" />}
        {detalle.estrategia_diff && (
          <Chip size="small" label={detalle.estrategia_diff} />
        )}
      </Stack>

      <Box sx={{ mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Fecha: {detalle.fecha_sync ? new Date(detalle.fecha_sync).toLocaleString('es-CO') : '—'}
          {' · '}
          Usuario: {detalle.usuario || '—'}
          {' · '}
          Paquete: <code>{detalle.paquete_nombre || '—'}</code>
        </Typography>
        {detalle.paquete_hash && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Hash: <code>{detalle.paquete_hash.slice(0, 16)}…</code>
          </Typography>
        )}
      </Box>

      {/* Resumen por capa */}
      {Object.keys(resumen).length > 0 && (
        <Paper variant="outlined" sx={{ mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Capa</TableCell>
                <TableCell align="right">+</TableCell>
                <TableCell align="right">~</TableCell>
                <TableCell align="right">-</TableCell>
                <TableCell align="right">errores</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(resumen).sort(([a], [b]) => a.localeCompare(b)).map(([tabla, r]) => (
                <TableRow key={tabla}>
                  <TableCell><code>{tabla}</code></TableCell>
                  <TableCell align="right">{r.added || 0}</TableCell>
                  <TableCell align="right">{r.updated || 0}</TableCell>
                  <TableCell align="right">{r.deleted || 0}</TableCell>
                  <TableCell align="right">
                    {r.errors > 0
                      ? <Chip size="small" color="error" label={r.errors} />
                      : 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Fotos */}
      {fotos && Object.keys(fotos).length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
          {fotos.copiadas_nuevas > 0 && (
            <Chip size="small" label={`Copiadas: ${fotos.copiadas_nuevas}`} />
          )}
          {fotos.skip_idem > 0 && (
            <Chip size="small" label={`Skip idem: ${fotos.skip_idem}`} />
          )}
          {fotos.colisiones_nombre > 0 && (
            <Chip size="small" color="warning" label={`Colisiones: ${fotos.colisiones_nombre}`} />
          )}
          {fotos.huerfanas_copiadas > 0 && (
            <Chip size="small" label={`Huérfanas: ${fotos.huerfanas_copiadas}`} />
          )}
          {fotos.faltantes_referenciadas > 0 && (
            <Chip size="small" color="warning" label={`Faltantes: ${fotos.faltantes_referenciadas}`} />
          )}
        </Stack>
      )}

      {/* Advertencias */}
      {(detalle.advertencias || []).length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {detalle.advertencias.map((a, i) => <div key={i}>• {a}</div>)}
        </Alert>
      )}

      {/* Error global */}
      {detalle.error_detalle && (
        <Alert severity="error">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {detalle.error_detalle}
          </pre>
        </Alert>
      )}
    </Box>
  )
}
