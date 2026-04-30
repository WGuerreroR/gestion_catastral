/**
 * ModalAplicarPaqueteOffline.jsx
 *
 * Modal autocontenido para el flujo:
 *   1. Seleccionar paquete .zip (data.gpkg + DCIM/)
 *   2. Inspeccionar (POST /offline/inspeccionar-paquete) → muestra preview
 *   3. Aplicar (POST /offline/aplicar-cambios) → 202 con sync_id
 *   4. Polling al detalle del sync hasta ok|error|parcial|idempotente
 *   5. Mostrar resumen final
 *
 * Patrón de polling con failCount tomado de AsignacionDetalle (3 fallos
 * consecutivos → asumimos sesión caída y detenemos).
 */

import { useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Stack, Alert, Chip,
  CircularProgress, FormControlLabel, Checkbox, Divider,
  Table, TableHead, TableBody, TableRow, TableCell, Paper, Tooltip,
} from '@mui/material'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import UploadFileIcon  from '@mui/icons-material/UploadFile'
import PreviewIcon     from '@mui/icons-material/Preview'
import PlayArrowIcon   from '@mui/icons-material/PlayArrow'
import DownloadIcon    from '@mui/icons-material/Download'
import api from '../api/axios'
import { getErrorMessage } from '../utils/errorHandler'


const POLL_INTERVAL_MS = 2000
const MAX_FAILS        = 3
const ESTADOS_FINALES  = ['ok', 'error', 'parcial', 'idempotente']

const colorEstado = {
  ok:           'success',
  parcial:      'warning',
  error:        'error',
  idempotente:  'info',
  encolado:     'default',
  corriendo:    'info',
}


export default function ModalAplicarPaqueteOffline({
  open,
  onClose,
  proyectoId,
  estadoAsignacion,    // 'campo' | 'sincronizado' | 'validacion' | 'finalizado'
  esAdmin,
  onAppliedOk,         // callback opcional al terminar con éxito
}) {
  const [archivo,         setArchivo]         = useState(null)
  const [forzarReproceso, setForzarReproceso] = useState(false)
  const [inspeccion,      setInspeccion]      = useState(null)
  const [inspeccionando,  setInspeccionando]  = useState(false)
  const [aplicando,       setAplicando]       = useState(false)
  const [syncDetalle,     setSyncDetalle]     = useState(null)
  const [errorMsg,        setErrorMsg]        = useState('')

  // Persistencia: ¿ya hay un paquete oficial para esta asignación?
  // Si es true, al seleccionar archivo abrimos un Dialog secundario para
  // que el usuario confirme el reemplazo antes de proceder.
  const [existePaquete, setExistePaquete] = useState(null)
  const [confirmarReemplazo, setConfirmarReemplazo] = useState({
    open: false,
    archivoPendiente: null,
  })

  const fileRef    = useRef(null)
  const pollingRef = useRef(null)

  const esFinalizado    = estadoAsignacion === 'finalizado'
  const requiereForzar  = esFinalizado && esAdmin
  const puedeAplicar    = (
    archivo && inspeccion?.valido && !aplicando && !syncDetalle &&
    (!esFinalizado || (esAdmin && forzarReproceso))
  )
  const syncEnCurso = aplicando && (
    !syncDetalle || !ESTADOS_FINALES.includes(syncDetalle.estado)
  )

  // ── Reset al abrir/cerrar ────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    setArchivo(null)
    setForzarReproceso(false)
    setInspeccion(null)
    setSyncDetalle(null)
    setErrorMsg('')
    setInspeccionando(false)
    setAplicando(false)
    setExistePaquete(null)
    setConfirmarReemplazo({ open: false, archivoPendiente: null })
    if (fileRef.current) fileRef.current.value = ''

    // Una sola consulta al estado del paquete por apertura.
    // Si ya hay paquete oficial, mostraremos confirmación al seleccionar zip.
    api.get(`/proyectos/${proyectoId}/estado-generacion`)
       .then(r => setExistePaquete(Boolean(r.data?.archivo_existe)))
       .catch(() => setExistePaquete(false))
  }, [open, proyectoId])

  // ── Cleanup polling al desmontar / cerrar ────────────────────────────
  useEffect(() => {
    return () => detenerPolling()
  }, [])
  useEffect(() => {
    if (!open) detenerPolling()
  }, [open])

  function detenerPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  // ── Step 1: file picker ──────────────────────────────────────────────
  function abrirFilePicker() {
    fileRef.current?.click()
  }

  function onFileChange(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const ok = f.name.toLowerCase().endsWith('.zip')
    if (!ok) {
      setErrorMsg('El archivo debe ser .zip')
      return
    }
    setErrorMsg('')
    setInspeccion(null)
    setSyncDetalle(null)

    // Si ya existe un paquete oficial, pedir confirmación antes de adoptar
    // el nuevo. El reemplazo real solo ocurre tras un sync ok, pero el
    // operador debe saber que está pisando un paquete previo.
    if (existePaquete) {
      setConfirmarReemplazo({ open: true, archivoPendiente: f })
    } else {
      setArchivo(f)
    }
  }

  function confirmarReemplazoOk() {
    setArchivo(confirmarReemplazo.archivoPendiente)
    setConfirmarReemplazo({ open: false, archivoPendiente: null })
  }

  function confirmarReemplazoCancelar() {
    setConfirmarReemplazo({ open: false, archivoPendiente: null })
    if (fileRef.current) fileRef.current.value = ''
    setArchivo(null)
  }

  // ── Step 2: inspeccionar ─────────────────────────────────────────────
  async function inspeccionar() {
    if (!archivo) return
    setInspeccionando(true)
    setErrorMsg('')
    setInspeccion(null)
    try {
      const fd = new FormData()
      fd.append('paquete_zip', archivo)
      const r = await api.post(
        `/proyectos/${proyectoId}/offline/inspeccionar-paquete`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setInspeccion(r.data)
    } catch (err) {
      setErrorMsg(getErrorMessage(err, 'No se pudo inspeccionar el paquete'))
    } finally {
      setInspeccionando(false)
    }
  }

  // ── Step 3: aplicar (POST + polling) ─────────────────────────────────
  async function aplicar() {
    if (!archivo || !puedeAplicar) return
    setAplicando(true)
    setErrorMsg('')
    setSyncDetalle(null)
    try {
      const fd = new FormData()
      fd.append('paquete_zip', archivo)
      const url = `/proyectos/${proyectoId}/offline/aplicar-cambios`
                + (forzarReproceso ? '?forzar_reproceso=true' : '')
      const r = await api.post(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const syncId = r.data.sync_id

      // Caso especial: respuesta con estado 'idempotente' viene resuelto en seco;
      // hacemos UNA llamada al detalle para ver el resumen previo y listo.
      if (r.data.estado === 'idempotente') {
        const det = await api.get(`/proyectos/offline/sync/${syncId}/detalle`)
        setSyncDetalle(det.data)
        setAplicando(false)
        return
      }

      arrancarPolling(syncId)
    } catch (err) {
      setErrorMsg(getErrorMessage(err, 'No se pudo sincronizar el paquete'))
      setAplicando(false)
    }
  }

  // Descarga el reporte .txt del sync (auth via axios interceptor).
  async function descargarReporte() {
    if (!syncDetalle?.id) return
    try {
      const r = await api.get(
        `/proyectos/offline/sync/${syncDetalle.id}/reporte.txt`,
        { responseType: 'blob' }
      )
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `sync_${syncDetalle.id}_reporte.txt`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorMsg(getErrorMessage(err, 'No se pudo descargar el reporte'))
    }
  }

  function arrancarPolling(syncId) {
    detenerPolling()
    let fails = 0
    pollingRef.current = setInterval(async () => {
      try {
        const r = await api.get(`/proyectos/offline/sync/${syncId}/detalle`)
        fails = 0
        setSyncDetalle(r.data)
        if (ESTADOS_FINALES.includes(r.data.estado)) {
          detenerPolling()
          setAplicando(false)
          if (r.data.estado === 'ok' && typeof onAppliedOk === 'function') {
            onAppliedOk(r.data)
          }
        }
      } catch {
        fails += 1
        if (fails >= MAX_FAILS) {
          detenerPolling()
          setAplicando(false)
          setErrorMsg('Sesión interrumpida; recargá la página para ver el estado.')
        }
      }
    }, POLL_INTERVAL_MS)
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onClose={syncEnCurso ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CloudUploadIcon color="primary" />
        Sincronizar paquete offline
      </DialogTitle>

      <DialogContent dividers>

        {/* Estado de la asignación */}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Estado de la asignación:
          </Typography>
          <Chip
            label={estadoAsignacion}
            size="small"
            color={
              estadoAsignacion === 'campo'        ? 'warning' :
              estadoAsignacion === 'sincronizado' ? 'primary' :
              estadoAsignacion === 'validacion'   ? 'info'    :
              estadoAsignacion === 'finalizado'   ? 'success' : 'default'
            }
          />
        </Stack>

        {/* Step 1: archivo */}
        <SeccionArchivo
          archivo={archivo}
          fileRef={fileRef}
          onFileChange={onFileChange}
          onPick={abrirFilePicker}
          disabled={syncEnCurso}
        />

        {/* Step 2: inspección */}
        {archivo && (
          <SeccionInspeccion
            inspeccionando={inspeccionando}
            inspeccion={inspeccion}
            onInspeccionar={inspeccionar}
            disabled={syncEnCurso}
          />
        )}

        {/* Step 3: forzar reproceso si aplica */}
        {requiereForzar && !syncDetalle && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            La asignación está en estado <b>finalizado</b>. Para aplicar
            cambios necesitás marcar <b>Forzar reproceso</b>.
            <FormControlLabel
              sx={{ display: 'block', mt: 1 }}
              control={
                <Checkbox
                  checked={forzarReproceso}
                  onChange={(e) => setForzarReproceso(e.target.checked)}
                />
              }
              label="Forzar reproceso (admin)"
            />
          </Alert>
        )}
        {esFinalizado && !esAdmin && (
          <Alert severity="error" sx={{ mt: 2 }}>
            La asignación está finalizada. Solo un administrador puede
            aplicar cambios sobre ella.
          </Alert>
        )}

        {/* Step 4: aplicar / polling */}
        {(syncEnCurso || syncDetalle) && (
          <SeccionSync syncDetalle={syncDetalle} />
        )}

        {errorMsg && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setErrorMsg('')}>
            {errorMsg}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={syncEnCurso}>
          {syncDetalle ? 'Cerrar' : 'Cancelar'}
        </Button>

        {/* Descargar reporte detallado: aparece cuando el sync terminó y
            tiene errores (parcial/error). Útil para que el operador sepa
            qué predio/capa revisar en QField. */}
        {syncDetalle && ['parcial', 'error'].includes(syncDetalle.estado) && (
          <Button
            variant="outlined"
            color="warning"
            startIcon={<DownloadIcon />}
            onClick={descargarReporte}
          >
            Descargar reporte
          </Button>
        )}

        {!syncDetalle && (
          <Tooltip title={
            !archivo                 ? 'Seleccioná un .zip primero' :
            !inspeccion              ? 'Primero inspeccioná el paquete' :
            !inspeccion.valido       ? 'El paquete no es válido' :
            esFinalizado && !esAdmin ? 'Solo admin puede sincronizar sobre finalizado' :
            esFinalizado && !forzarReproceso ? 'Marcá forzar reproceso' :
            ''
          }>
            <span>
              <Button
                variant="contained"
                color="primary"
                startIcon={aplicando ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                onClick={aplicar}
                disabled={!puedeAplicar}
              >
                {aplicando ? 'Sincronizando…' : 'Sincronizar'}
              </Button>
            </span>
          </Tooltip>
        )}
      </DialogActions>

      {/* Confirmación de reemplazo del paquete oficial existente */}
      <Dialog
        open={confirmarReemplazo.open}
        onClose={confirmarReemplazoCancelar}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>¿Reemplazar paquete existente?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Esta asignación ya tiene un paquete oficial guardado en el servidor.
            Si el sync termina con éxito, el ZIP que acabás de seleccionar va a
            reemplazarlo (también la carpeta extraída).
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Si el sync falla o queda parcial, el paquete viejo permanece intacto.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={confirmarReemplazoCancelar}>Cancelar</Button>
          <Button variant="contained" color="warning" onClick={confirmarReemplazoOk}>
            Reemplazar
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}


// ── Subcomponentes ──────────────────────────────────────────────────────────

function SeccionArchivo({ archivo, fileRef, onFileChange, onPick, disabled }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" gutterBottom>1. Paquete</Typography>
      <Stack direction="row" spacing={2} alignItems="center">
        <Button
          variant="outlined"
          startIcon={<UploadFileIcon />}
          onClick={onPick}
          disabled={disabled}
        >
          Seleccionar .zip
        </Button>
        {archivo && (
          <Typography variant="body2" color="text.secondary">
            {archivo.name} <i>({(archivo.size / 1024 / 1024).toFixed(2)} MB)</i>
          </Typography>
        )}
      </Stack>
      <input
        type="file"
        accept=".zip,application/zip"
        ref={fileRef}
        onChange={onFileChange}
        style={{ display: 'none' }}
      />
    </Box>
  )
}


function SeccionInspeccion({ inspeccionando, inspeccion, onInspeccionar, disabled }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" gutterBottom>2. Vista previa</Typography>
      {!inspeccion && (
        <Button
          variant="outlined"
          color="info"
          startIcon={inspeccionando ? <CircularProgress size={16} /> : <PreviewIcon />}
          onClick={onInspeccionar}
          disabled={inspeccionando || disabled}
        >
          {inspeccionando ? 'Inspeccionando…' : 'Inspeccionar paquete'}
        </Button>
      )}

      {inspeccion && !inspeccion.valido && (
        <Alert severity="error" sx={{ mt: 1 }}>
          Paquete inválido:
          <ul style={{ margin: '6px 0' }}>
            {(inspeccion.errores || []).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Alert>
      )}

      {inspeccion?.valido && (
        <PreviewTabla inspeccion={inspeccion} />
      )}
    </Box>
  )
}


function PreviewTabla({ inspeccion }) {
  const preview = inspeccion.preview || {}
  const rows = Object.entries(preview).map(([tabla, p]) => ({
    tabla,
    added:    p.added || 0,
    updated:  p.updated_attrs_features || 0,
    geom:     p.updated_geom_features  || 0,
    removed:  p.removed || 0,
  }))
  rows.sort((a, b) => a.tabla.localeCompare(b.tabla))

  const totalCambios = rows.reduce(
    (acc, r) => acc + r.added + r.updated + r.geom + r.removed, 0
  )

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Chip
          size="small"
          label={`Estrategia: ${inspeccion.estrategia || 'desconocida'}`}
        />
        <Chip
          size="small"
          color={totalCambios > 0 ? 'warning' : 'default'}
          label={`Total cambios: ${totalCambios}`}
        />
        <Chip
          size="small"
          label={`Fotos en paquete: ${inspeccion.fotos_en_paquete || 0}`}
        />
      </Stack>

      {rows.length > 0 && (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Capa</TableCell>
                <TableCell align="right">+ nuevos</TableCell>
                <TableCell align="right">~ atributos</TableCell>
                <TableCell align="right">~ geom</TableCell>
                <TableCell align="right">- borrados</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.tabla}>
                  <TableCell><code>{r.tabla}</code></TableCell>
                  <TableCell align="right">{r.added}</TableCell>
                  <TableCell align="right">{r.updated}</TableCell>
                  <TableCell align="right">{r.geom}</TableCell>
                  <TableCell align="right">{r.removed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {(inspeccion.advertencias || []).length > 0 && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {inspeccion.advertencias.map((a, i) => <div key={i}>• {a}</div>)}
        </Alert>
      )}
    </Box>
  )
}


function SeccionSync({ syncDetalle }) {
  if (!syncDetalle) {
    return (
      <Box sx={{ mt: 2 }}>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={20} />
          <Typography variant="body2">Encolado, esperando inicio…</Typography>
        </Stack>
      </Box>
    )
  }

  const final = ESTADOS_FINALES.includes(syncDetalle.estado)
  const resumen = syncDetalle.resumen || {}
  const fotos   = syncDetalle.fotos_resumen || {}

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" gutterBottom>3. Resultado</Typography>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Chip
          size="small"
          color={colorEstado[syncDetalle.estado] || 'default'}
          icon={!final ? <CircularProgress size={14} /> : undefined}
          label={`Estado: ${syncDetalle.estado}`}
        />
        {syncDetalle.estado_anterior && syncDetalle.estado_nuevo && (
          <Chip
            size="small"
            color="success"
            label={`${syncDetalle.estado_anterior} → ${syncDetalle.estado_nuevo}`}
          />
        )}
        {syncDetalle.forzado && (
          <Chip size="small" color="warning" label="forzado" />
        )}
      </Stack>

      {Object.keys(resumen).length > 0 && (
        <Paper variant="outlined" sx={{ mb: 1 }}>
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
              {Object.entries(resumen).sort(([a],[b])=>a.localeCompare(b)).map(([tabla, r]) => (
                <TableRow key={tabla}>
                  <TableCell><code>{tabla}</code></TableCell>
                  <TableCell align="right">{r.added || 0}</TableCell>
                  <TableCell align="right">{r.updated || 0}</TableCell>
                  <TableCell align="right">{r.deleted || 0}</TableCell>
                  <TableCell align="right">{r.errors || 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Fotos */}
      {fotos && Object.keys(fotos).length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
          <Chip size="small" label={`Copiadas: ${fotos.copiadas_nuevas || 0}`} />
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

      {(syncDetalle.advertencias || []).length > 0 && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {syncDetalle.advertencias.map((a, i) => <div key={i}>• {a}</div>)}
        </Alert>
      )}
      {syncDetalle.error_detalle && (
        <Alert severity="error" sx={{ mt: 1 }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {syncDetalle.error_detalle}
          </pre>
        </Alert>
      )}
    </Box>
  )
}
