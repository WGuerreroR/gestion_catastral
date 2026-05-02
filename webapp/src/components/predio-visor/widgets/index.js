/**
 * Registry de widgets del visor de predios.
 *
 * Cada widget recibe (mínimo):
 *   - field         (obj): la definición JSON del campo
 *   - value         (any): el valor actual
 *   - onChange      (fn) : callback con el nuevo valor (solo modo edit)
 *   - modo          ('view' | 'edit')
 *   - error         (string | null)
 *   - ayuda         (string | undefined)
 *   - placeholder   (string | undefined)
 *   - validations   (obj | undefined)
 *
 * Para agregar un widget nuevo: registrarlo acá. El componente
 * principal no necesita cambios.
 */
import TextWidget       from './TextWidget'
import TextareaWidget   from './TextareaWidget'
import NumberWidget     from './NumberWidget'
import BooleanWidget    from './BooleanWidget'
import DateWidget       from './DateWidget'
import DatetimeWidget   from './DatetimeWidget'
import SelectWidget          from './SelectWidget'
import PhotoWidget           from './PhotoWidget'
import GeometrySummaryWidget from './GeometrySummaryWidget'

const REGISTRY = {
  text:     TextWidget,
  textarea: TextareaWidget,
  number:   NumberWidget,
  boolean:  BooleanWidget,
  date:     DateWidget,
  datetime: DatetimeWidget,
  select:   SelectWidget,
  photo:    PhotoWidget,
  geometry: GeometrySummaryWidget,
}

export function getWidget(nombre) {
  return REGISTRY[nombre]
}

export const WIDGETS_DISPONIBLES = Object.keys(REGISTRY)
