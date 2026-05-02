/**
 * Sección tipo `lista`: array de items (ej. unidades de construcción,
 * interesados). Cada item se renderiza como card con sus campos +
 * (opcional) subsección anidada (ej. características de cada unidad).
 *
 * Si la sección está vinculada a una capa del mapa (`capaVinculada`),
 * se sincroniza con el feature seleccionado:
 *   - Click en card → selecciona el feature en el mapa (fit + highlight).
 *   - Si el feature seleccionado vino del mapa → scrollIntoView + clase
 *     `.resaltado-mapa` por ~2s.
 */
import { memo, useEffect, useRef } from 'react'
import {
  Box, Stack, Card, CardContent, Typography, Chip, Alert, Divider
} from '@mui/material'

import SeccionRegistroUnico from './SeccionRegistroUnico'
import { useMapaPredioSync } from './mapa/useMapaPredioSync'


// Sustituye {{campo}} en una plantilla con valores del item
function aplicarPlantilla(plantilla, item) {
  if (!plantilla) return ''
  return plantilla.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    item?.[key] !== undefined && item?.[key] !== null && item?.[key] !== ''
      ? String(item[key])
      : ''
  ).trim() || '(sin etiqueta)'
}


function ItemCard({ seccion, item, indice, modo, onChange, idOperacion, capaVinculada }) {
  const { selected, select } = useMapaPredioSync()
  const cardRef = useRef(null)
  const idItem = seccion.id_item || 'globalid'
  const itemId = item?.[idItem] != null ? String(item[idItem]) : null

  const estaSeleccionado = Boolean(
    capaVinculada && itemId &&
    selected?.capaId === capaVinculada.id &&
    selected?.featureId === itemId
  )

  // Cuando el feature seleccionado vino del mapa → scroll + flash
  useEffect(() => {
    if (
      estaSeleccionado &&
      selected?.source === 'map' &&
      cardRef.current
    ) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      cardRef.current.classList.add('resaltado-mapa')
      const t = setTimeout(() => {
        cardRef.current?.classList.remove('resaltado-mapa')
      }, 2000)
      return () => clearTimeout(t)
    }
  }, [estaSeleccionado, selected?.source])

  const clickeable = Boolean(capaVinculada && itemId)

  const handleClick = () => {
    if (!clickeable) return
    select(capaVinculada.id, itemId, 'list')
  }

  const titulo = aplicarPlantilla(
    seccion.label_item || `Item ${indice + 1}`,
    item
  )

  return (
    <Card
      ref={cardRef}
      variant="outlined"
      onClick={clickeable ? handleClick : undefined}
      sx={{
        cursor: clickeable ? 'pointer' : 'default',
        borderColor: estaSeleccionado ? 'warning.main' : 'divider',
        borderWidth: estaSeleccionado ? 2 : 1,
        transition: 'border-color 0.2s, box-shadow 0.2s, background-color 1.5s',
        '&:hover': clickeable ? {
          borderColor: 'primary.main',
          boxShadow: 1,
        } : undefined,
        '&.resaltado-mapa': {
          backgroundColor: 'warning.light',
          borderColor: 'warning.main',
        },
      }}
    >
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
            {titulo}
          </Typography>
          {clickeable && (
            <Chip
              size="small"
              variant="outlined"
              color={estaSeleccionado ? 'warning' : 'default'}
              label={estaSeleccionado ? 'Seleccionado' : 'Click → ver en mapa'}
            />
          )}
        </Stack>

        <SeccionRegistroUnico
          seccion={{ ...seccion, campos: seccion.campos || [] }}
          registro={item}
          modo={modo}
          onChange={modo === 'edit' ? onChange : undefined}
          idOperacion={idOperacion}
          pkItem={seccion.id_pk_field ? item?.[seccion.id_pk_field] : null}
        />

        {seccion.subseccion && item?.[subseccionDataKey(seccion)] && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="overline" color="text.secondary" display="block">
              {seccion.subseccion.titulo || 'Detalle'}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <SeccionRegistroUnico
                seccion={{
                  ...seccion.subseccion,
                  tabla_origen: seccion.subseccion.tabla_origen,
                }}
                registro={item[subseccionDataKey(seccion)]}
                modo={modo}
                onChange={modo === 'edit' ? onChange : undefined}
                idOperacion={idOperacion}
                pkItem={
                  seccion.subseccion.id_pk_field
                    ? item[subseccionDataKey(seccion)]?.[seccion.subseccion.id_pk_field]
                    : null
                }
              />
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  )
}


// Por convención, el backend anida la subsección bajo el key
// `caracteristicas` (única subsección actual). En el futuro, si hay
// más subsecciones, el JSON podría declarar `data_key` explícitamente.
function subseccionDataKey(seccion) {
  return seccion.subseccion?.data_key || 'caracteristicas'
}


function SeccionLista({ seccion, items = [], modo, onChange, idOperacion, capaVinculada }) {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <Alert severity="info">
        Este predio no tiene registros en "{seccion.titulo}".
      </Alert>
    )
  }

  return (
    <Stack spacing={1.5}>
      {items.map((item, i) => (
        <ItemCard
          key={(item?.[seccion.id_item] || item?.globalid || i)}
          seccion={seccion}
          item={item}
          indice={i}
          modo={modo}
          onChange={onChange}
          idOperacion={idOperacion}
          capaVinculada={capaVinculada}
        />
      ))}
    </Stack>
  )
}

export default memo(SeccionLista)
