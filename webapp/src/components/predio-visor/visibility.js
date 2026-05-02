/**
 * Evaluador de `visible_if` y `required_if` / `required_unless`.
 *
 * Operadores soportados:
 *   ==, !=, in, not_in, >, <, >=, <=, truthy, falsy
 *
 * Convención: si el operador no se reconoce, devuelve true (mostrar
 * por defecto) — política conservadora que evita "esconder" UI por un
 * typo en el JSON.
 */

const OPERADORES = {
  '==':     (a, b) => a == b,
  '!=':     (a, b) => a != b,
  'in':     (a, b) => Array.isArray(b) && b.map(String).includes(String(a)),
  'not_in': (a, b) => !(Array.isArray(b) && b.map(String).includes(String(a))),
  '>':      (a, b) => Number(a) >  Number(b),
  '<':      (a, b) => Number(a) <  Number(b),
  '>=':     (a, b) => Number(a) >= Number(b),
  '<=':     (a, b) => Number(a) <= Number(b),
  'truthy': (a) => Boolean(a) && a !== '',
  'falsy':  (a) => !a || a === '',
}

export function evaluarCondicion(condicion, formData) {
  if (!condicion || !formData) return true
  const { field, operator = '==', value } = condicion
  const fn = OPERADORES[operator]
  if (!fn) return true
  const actual = formData[field]
  if (operator === 'truthy' || operator === 'falsy') return fn(actual)
  return fn(actual, value)
}

export function esVisible(visibleIf, formData) {
  if (!visibleIf) return true
  return evaluarCondicion(visibleIf, formData)
}
