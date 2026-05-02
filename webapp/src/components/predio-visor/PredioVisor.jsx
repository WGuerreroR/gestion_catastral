/**
 * Componente principal del visor de predios.
 *
 * Es 100% dirigido por el JSON `formConfig`: lee qué secciones
 * renderizar, su orden, su modo (view/edit) y los campos.
 *
 * Modo edición (paso 12 del plan):
 *   - Botón "Editar" disponible si el JSON tiene secciones con
 *     `roles_edicion` que el usuario actual cumple.
 *   - Cambios se acumulan en `cambios` (estructurados por tabla):
 *       { lc_predio_p: {...}, cr_terreno: {...},
 *         cr_unidadconstruccion: [{pk, ...}], ... }
 *   - "Guardar" valida client-side; si OK, hace POST /predios/{id}/guardar.
 *     El backend re-valida (no se confía en cliente) y devuelve el
 *     predio actualizado, que reemplaza el cache local.
 *   - "Cancelar" descarta cambios y vuelve a view.
 */
import { useMemo, useState, useCallback } from 'react'
import {
  Box, Accordion, AccordionSummary, AccordionDetails,
  Typography, Skeleton, Alert, Chip, Button, Stack
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import LockIcon       from '@mui/icons-material/Lock'
import RefreshIcon    from '@mui/icons-material/Refresh'
import EditIcon       from '@mui/icons-material/Edit'
import SaveIcon       from '@mui/icons-material/Save'
import CancelIcon     from '@mui/icons-material/Cancel'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'

import usePredioData from '../../hooks/usePredioData'
import { useAuth } from '../../context/AuthContext'
import SeccionRegistroUnico from './SeccionRegistroUnico'
import SeccionLista from './SeccionLista'
import SeccionMapa from './mapa/SeccionMapa'
import { MapaPredioSyncProvider } from './mapa/useMapaPredioSync'
import { esVisible } from './visibility'
import { validarCampo } from './validators'
import { guardarPredio, descargarPredioPDF } from '../../api/predios'
import { getErrorMessage } from '../../utils/errorHandler'


// Mapeo declarativo tabla_origen → key del payload backend
const TABLA_A_PATH = {
  lc_predio_p:                          'predio',
  cr_terreno:                           'terreno',
  cr_unidadconstruccion:                'unidades',
  cr_caracteristicasunidadconstruccion: 'caracteristicas',
  cr_interesado:                        'interesados',
}

const TABLAS_LISTA = new Set([
  'cr_unidadconstruccion',
  'cr_caracteristicasunidadconstruccion',
  'cr_interesado',
])


function resolverDatosSeccion(predioCompleto, seccion) {
  const path = TABLA_A_PATH[seccion.tabla_origen]
  if (!path) return null
  return predioCompleto?.[path] ?? null
}


function buildCapasPorSeccion(formConfig) {
  const map = {}
  const mapaSeccion = formConfig?.secciones?.find(s => s.tipo === 'mapa')
  if (!mapaSeccion) return map
  for (const capa of (mapaSeccion.capas || [])) {
    if (capa.linked_section_id) map[capa.linked_section_id] = capa
  }
  return map
}


/**
 * Indexa todas las secciones (incluyendo subsecciones) por tabla_origen.
 */
function buildSeccionPorTabla(formConfig) {
  const map = {}
  for (const s of (formConfig?.secciones || [])) {
    if (s.tabla_origen) map[s.tabla_origen] = s
    if (s.subseccion?.tabla_origen) map[s.subseccion.tabla_origen] = s.subseccion
  }
  return map
}


function calcularModoEfectivo(seccion, modoOverride, hasRole) {
  const modoBase = modoOverride || seccion.modo || 'view'
  if (modoBase !== 'edit') return { modo: 'view', forzado: false }
  const rolesPermitidos = seccion.roles_edicion || []
  if (rolesPermitidos.length === 0) return { modo: 'edit', forzado: false }
  const tienePermiso = rolesPermitidos.some(r => hasRole(r))
  return tienePermiso
    ? { modo: 'edit', forzado: false }
    : { modo: 'view', forzado: true }
}


function tieneAlgunaSeccionEditable(formConfig, hasRole) {
  for (const s of (formConfig?.secciones || [])) {
    const candidatos = [s, s.subseccion].filter(Boolean)
    for (const c of candidatos) {
      const roles = c.roles_edicion || []
      if (roles.length === 0) continue
      if (roles.some(r => hasRole(r))) return true
    }
  }
  return false
}


/**
 * Aplica `cambios` sobre `predioCompleto` para mostrar al usuario sus
 * ediciones aún sin haber guardado.
 */
function aplicarCambiosLocales(data, cambios) {
  if (!data || Object.keys(cambios).length === 0) return data
  const out = { ...data }
  if (cambios.lc_predio_p) {
    out.predio = { ...out.predio, ...cambios.lc_predio_p }
  }
  if (cambios.cr_terreno && out.terreno) {
    out.terreno = { ...out.terreno, ...cambios.cr_terreno }
  }
  if (Array.isArray(cambios.cr_unidadconstruccion) && Array.isArray(out.unidades)) {
    const porPk = new Map(
      cambios.cr_unidadconstruccion.map(c => [c.id_operacion_uc_geo, c])
    )
    out.unidades = out.unidades.map(u => {
      const c = porPk.get(u.id_operacion_uc_geo)
      return c ? { ...u, ...c } : u
    })
  }
  if (Array.isArray(cambios.cr_caracteristicasunidadconstruccion) && Array.isArray(out.unidades)) {
    const porPk = new Map(
      cambios.cr_caracteristicasunidadconstruccion.map(c => [c.id_operacion_unidad_cons, c])
    )
    out.unidades = out.unidades.map(u => {
      if (!u.caracteristicas) return u
      const c = porPk.get(u.caracteristicas.id_operacion_unidad_cons)
      return c
        ? { ...u, caracteristicas: { ...u.caracteristicas, ...c } }
        : u
    })
  }
  if (Array.isArray(cambios.cr_interesado) && Array.isArray(out.interesados)) {
    const porPk = new Map(
      cambios.cr_interesado.map(c => [c.globalid, c])
    )
    out.interesados = out.interesados.map(i => {
      const c = porPk.get(i.globalid)
      return c ? { ...i, ...c } : i
    })
  }
  return out
}


/**
 * Mete un cambio nuevo en la estructura de `cambios`. Para tablas
 * "lista" (cr_unidadconstruccion, etc.), upserta el item por su pk.
 * Para registro_unico, hace merge sobre el dict.
 */
function aplicarCambio(prev, tabla, field, valor, pk, idPkField) {
  if (TABLAS_LISTA.has(tabla)) {
    if (!pk || !idPkField) return prev   // sin pk no podemos identificar el item
    const arr = Array.isArray(prev[tabla]) ? [...prev[tabla]] : []
    const idx = arr.findIndex(x => x[idPkField] === pk)
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], [field]: valor }
    } else {
      arr.push({ [idPkField]: pk, [field]: valor })
    }
    return { ...prev, [tabla]: arr }
  }
  return {
    ...prev,
    [tabla]: { ...(prev[tabla] || {}), [field]: valor }
  }
}


export default function PredioVisor({
  formConfig,
  busqueda,
  modoOverride: modoOverrideExterno = null,
  onSave,
  onCancel,
  className,
}) {
  const { hasRole } = useAuth()
  const { data, loading, error, status, recargar } = usePredioData(busqueda)

  const [editando, setEditando] = useState(false)
  const [cambios, setCambios]   = useState({})
  const [guardando, setGuardando] = useState(false)
  const [errorGuardar, setErrorGuardar] = useState(null)
  const [errorCount, setErrorCount] = useState(null)   // si la pre-validación falla
  const [descargandoPDF, setDescargandoPDF] = useState(false)

  // Override resultante: si el padre lo fuerza, gana; si no, depende del toggle.
  const modoOverride = modoOverrideExterno
    ?? (editando ? 'edit' : null)

  const seccionPorTabla = useMemo(() => buildSeccionPorTabla(formConfig), [formConfig])

  const handleChangeCampo = useCallback((tabla, field, valor, pk) => {
    const seccion = seccionPorTabla[tabla]
    const idPkField = seccion?.id_pk_field
    setCambios(prev => aplicarCambio(prev, tabla, field, valor, pk, idPkField))
    setErrorCount(null)
    setErrorGuardar(null)
  }, [seccionPorTabla])

  const datosConCambios = useMemo(
    () => aplicarCambiosLocales(data, cambios),
    [data, cambios]
  )

  const secciones = formConfig?.secciones || []
  const capasPorSeccion = useMemo(() => buildCapasPorSeccion(formConfig), [formConfig])
  const hayAlgoEditable = useMemo(
    () => tieneAlgunaSeccionEditable(formConfig, hasRole),
    [formConfig, hasRole]
  )

  // ─────────── handlers de modo edit ─────────────────────────────

  const empezarEdicion = () => {
    setEditando(true)
    setCambios({})
    setErrorGuardar(null)
    setErrorCount(null)
  }

  const cancelarEdicion = () => {
    setEditando(false)
    setCambios({})
    setErrorGuardar(null)
    setErrorCount(null)
    if (onCancel) onCancel()
  }

  const validarCambios = useCallback(() => {
    let total = 0
    for (const [tabla, payload] of Object.entries(cambios)) {
      const seccion = seccionPorTabla[tabla]
      if (!seccion) continue
      const campos = seccion.campos || []
      const camposPorField = Object.fromEntries(campos.map(c => [c.field, c]))

      const items = Array.isArray(payload) ? payload : [payload]
      for (const reg of items) {
        for (const [field] of Object.entries(reg)) {
          if (field === seccion.id_pk_field) continue
          const campo = camposPorField[field]
          if (!campo) continue
          if (!esVisible(campo.visible_if, reg)) continue
          if (validarCampo(campo, reg[field], reg)) total++
        }
      }
    }
    return total
  }, [cambios, seccionPorTabla])

  const exportarPDF = async () => {
    setDescargandoPDF(true)
    try {
      await descargarPredioPDF(data?.predio?.id_operacion, formConfig.id)
    } catch (err) {
      setErrorGuardar(getErrorMessage(err, 'No se pudo descargar el PDF'))
    } finally {
      setDescargandoPDF(false)
    }
  }

  const guardar = async () => {
    const errores = validarCambios()
    if (errores > 0) {
      setErrorCount(errores)
      return
    }
    if (Object.keys(cambios).length === 0) {
      setEditando(false)
      return
    }
    setGuardando(true)
    setErrorGuardar(null)
    try {
      const actualizado = await guardarPredio(
        data?.predio?.id_operacion,
        formConfig.id,
        cambios,
      )
      setCambios({})
      setEditando(false)
      if (onSave) onSave(actualizado)
      recargar()
    } catch (err) {
      setErrorGuardar(getErrorMessage(err, 'No se pudo guardar'))
    } finally {
      setGuardando(false)
    }
  }

  // ─────────── render ─────────────────────────────────────────────

  if (!busqueda) {
    return (
      <Box className={className} sx={{ p: 3 }}>
        <Alert severity="info">Buscá un predio para ver su información.</Alert>
      </Box>
    )
  }

  if (loading) {
    return (
      <Box className={className} sx={{ p: 3 }}>
        <Skeleton variant="rectangular" height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={120} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={120} />
      </Box>
    )
  }

  if (status === 404) {
    return (
      <Box className={className} sx={{ p: 3 }}>
        <Alert severity="warning">
          Predio no encontrado: <code>{busqueda}</code>. Verificá que el id_operacion
          o número predial sea correcto.
        </Alert>
      </Box>
    )
  }

  if (error) {
    return (
      <Box className={className} sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={recargar}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    )
  }

  if (!datosConCambios) return null

  const enModoEdit = modoOverride === 'edit'
  const cambiosCount = Object.values(cambios).reduce(
    (n, x) => n + (Array.isArray(x)
      ? x.reduce((m, item) => m + Object.keys(item).length - 1, 0)
      : Object.keys(x).length),
    0
  )

  return (
    <MapaPredioSyncProvider>
      <Box className={className}>
        {/* Header con metadata + acciones */}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          sx={{ mb: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
        >
          <Typography variant="h6" sx={{ mr: 2 }}>
            {datosConCambios.predio?.nombre_predio || datosConCambios.predio?.id_operacion}
          </Typography>
          <Chip size="small" label={`id_operacion: ${datosConCambios.predio?.id_operacion}`} />
          {datosConCambios.predio?.numero_predial && (
            <Chip size="small" variant="outlined" label={`NP: ${datosConCambios.predio.numero_predial}`} />
          )}
          <Chip
            size="small"
            color="info"
            label={`${datosConCambios._meta?.total_unidades ?? 0} unidades · ${datosConCambios._meta?.total_interesados ?? 0} interesados`}
          />

          <Box sx={{ flex: 1 }} />

          {formConfig?.exportacion_pdf?.habilitada && !enModoEdit && (
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<PictureAsPdfIcon />}
              onClick={exportarPDF}
              disabled={descargandoPDF}
            >
              {formConfig.exportacion_pdf.label_boton || 'Exportar a PDF'}
            </Button>
          )}

          {!modoOverrideExterno && hayAlgoEditable && !enModoEdit && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={empezarEdicion}
            >
              Editar
            </Button>
          )}
          {!modoOverrideExterno && enModoEdit && (
            <Stack direction="row" spacing={1} alignItems="center">
              {cambiosCount > 0 && (
                <Chip size="small" color="warning" label={`${cambiosCount} cambio${cambiosCount === 1 ? '' : 's'}`} />
              )}
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<SaveIcon />}
                onClick={guardar}
                disabled={guardando}
              >
                Guardar
              </Button>
              <Button
                size="small"
                variant="text"
                startIcon={<CancelIcon />}
                onClick={cancelarEdicion}
                disabled={guardando}
              >
                Cancelar
              </Button>
            </Stack>
          )}
        </Stack>

        {/* Errores de guardado / pre-validación */}
        {errorCount && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Hay {errorCount} {errorCount === 1 ? 'error' : 'errores'} de validación. Revisá los campos resaltados antes de guardar.
          </Alert>
        )}
        {errorGuardar && (
          <Alert severity="error" sx={{ mb: 2 }}>{errorGuardar}</Alert>
        )}

        {/* Secciones */}
        <Stack spacing={1}>
          {secciones.map((seccion) => (
            <SeccionRender
              key={seccion.id}
              seccion={seccion}
              predioCompleto={datosConCambios}
              modoOverride={modoOverride}
              hasRole={hasRole}
              onChangeCampo={handleChangeCampo}
              idOperacion={datosConCambios.predio?.id_operacion}
              capaVinculada={capasPorSeccion[seccion.id]}
            />
          ))}
        </Stack>
      </Box>
    </MapaPredioSyncProvider>
  )
}


function SeccionRender({ seccion, predioCompleto, modoOverride, hasRole, onChangeCampo, idOperacion, capaVinculada }) {
  const { modo, forzado } = calcularModoEfectivo(seccion, modoOverride, hasRole)

  if (seccion.tipo === 'mapa') {
    return (
      <Accordion id="predio-visor-mapa" defaultExpanded={seccion.expandida_por_default !== false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {seccion.titulo}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <SeccionMapa seccion={seccion} predioCompleto={predioCompleto} />
        </AccordionDetails>
      </Accordion>
    )
  }

  if (seccion.tipo === 'lista') {
    const items = resolverDatosSeccion(predioCompleto, seccion) || []
    const cantidad = Array.isArray(items) ? items.length : 0
    return (
      <Accordion defaultExpanded={seccion.expandida_por_default !== false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {seccion.titulo}
            </Typography>
            <Chip size="small" label={cantidad} variant="outlined" />
            {forzado && (
              <Chip
                size="small"
                icon={<LockIcon sx={{ fontSize: 14 }} />}
                label="Solo lectura por permisos"
                variant="outlined"
              />
            )}
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <SeccionLista
            seccion={seccion}
            items={items}
            modo={modo}
            onChange={modo === 'edit' ? onChangeCampo : undefined}
            idOperacion={idOperacion}
            capaVinculada={capaVinculada}
          />
        </AccordionDetails>
      </Accordion>
    )
  }

  if (seccion.tipo === 'registro_unico') {
    const registro = resolverDatosSeccion(predioCompleto, seccion)
    return (
      <Accordion defaultExpanded={seccion.expandida_por_default !== false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {seccion.titulo}
            </Typography>
            {forzado && (
              <Chip
                size="small"
                icon={<LockIcon sx={{ fontSize: 14 }} />}
                label="Solo lectura por permisos"
                color="default"
                variant="outlined"
              />
            )}
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          {registro ? (
            <SeccionRegistroUnico
              seccion={seccion}
              registro={registro}
              modo={modo}
              onChange={modo === 'edit' ? onChangeCampo : undefined}
              idOperacion={idOperacion}
            />
          ) : (
            <Alert severity="info">
              Este predio no tiene datos de "{seccion.titulo}".
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>
    )
  }

  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1">{seccion.titulo}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Alert severity="info">
          Tipo de sección "<code>{seccion.tipo}</code>" todavía no soportado.
        </Alert>
      </AccordionDetails>
    </Accordion>
  )
}
