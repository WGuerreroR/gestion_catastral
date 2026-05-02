import { memo, useCallback, useMemo } from 'react'
import { Grid, Alert, Box } from '@mui/material'
import { getWidget } from './widgets'
import { esVisible } from './visibility'
import { validarCampo } from './validators'
import AuditoriaPopover from './AuditoriaPopover'

function SeccionRegistroUnico({ seccion, registro, modo, onChange, idOperacion, pkItem }) {
  const handleChange = useCallback((field, nuevoValor) => {
    if (!onChange) return
    // pkItem es relevante solo para items de lista (cr_unidad..., interesados);
    // en registro_unico se ignora.
    onChange(seccion.tabla_origen, field, nuevoValor, pkItem)
  }, [onChange, seccion.tabla_origen, pkItem])

  // Filtro de visibilidad reactivo: cuando cambia un valor del registro,
  // los campos con visible_if que dependen se recalculan.
  const camposVisibles = useMemo(
    () => (seccion.campos || []).filter(c => esVisible(c.visible_if, registro)),
    [seccion.campos, registro]
  )

  // Errores por campo (solo en modo edit; en view no hay errores).
  const errores = useMemo(() => {
    if (modo !== 'edit') return {}
    const out = {}
    for (const c of camposVisibles) {
      const e = validarCampo(c, registro?.[c.field], registro)
      if (e) out[c.field] = e
    }
    return out
  }, [modo, camposVisibles, registro])

  // PK del registro para auditoría (puede no estar configurada → no se muestra el ícono).
  const pk = seccion.id_pk_field ? registro?.[seccion.id_pk_field] : null

  return (
    <Grid container spacing={2}>
      {camposVisibles.map((campo) => {
        const Widget = getWidget(campo.widget)
        if (!Widget) {
          return (
            <Grid item xs={12} sm={6} key={campo.field}>
              <Alert severity="warning" sx={{ py: 0.5 }}>
                Widget no soportado: <code>{campo.widget}</code> (campo {campo.field})
              </Alert>
            </Grid>
          )
        }
        const ancho = (campo.widget === 'textarea' || campo.widget === 'photo') ? 12 : 6
        const auditoriaActiva =
          modo === 'view' &&
          campo.auditoria?.habilitada === true &&
          seccion.tabla_origen &&
          pk &&
          idOperacion

        return (
          <Grid item xs={12} sm={ancho} key={campo.field}>
            <Box sx={{ position: 'relative', pr: auditoriaActiva ? 3 : 0 }}>
              <Widget
                field={campo}
                value={registro?.[campo.field]}
                onChange={(v) => handleChange(campo.field, v)}
                modo={modo}
                ayuda={campo.ayuda}
                placeholder={campo.placeholder}
                validations={campo.validations}
                error={errores[campo.field] || null}
                idOperacion={idOperacion}
                registro={registro}
              />
              {auditoriaActiva && (
                <Box sx={{ position: 'absolute', top: 0, right: 0 }}>
                  <AuditoriaPopover
                    label={campo.label}
                    campo={campo.field}
                    tabla={seccion.tabla_origen}
                    pk={pk}
                    idOperacion={idOperacion}
                  />
                </Box>
              )}
            </Box>
          </Grid>
        )
      })}
    </Grid>
  )
}

export default memo(SeccionRegistroUnico)
