/**
 * Validaciones del visor de predios.
 *
 * El JSON declara las reglas en `validations`. Esta capa las
 * interpreta y devuelve un mensaje de error o null. Sin librerías
 * externas (ni Formik ni Yup) — un useState + esto basta.
 *
 * Validaciones soportadas:
 *   required, required_if, required_unless,
 *   min, max, minLength, maxLength, regex, custom
 *
 * Custom: el JSON referencia una función por nombre. Para registrar
 * una nueva, llamar a `registrarValidador(nombre, fn)` desde código
 * de aplicación. La firma es `(valor, registro) => null | string`.
 */
import { evaluarCondicion } from './visibility'

const CUSTOM_REGISTRY = {}

export function registrarValidador(nombre, fn) {
  CUSTOM_REGISTRY[nombre] = fn
}

function esVacio(v) {
  return v === null || v === undefined || v === ''
}

export function validarCampo(campo, valor, registro) {
  const v = campo?.validations
  if (!v) return null

  // Required (plain + condicional)
  let requerido = Boolean(v.required)
  if (v.required_if  && evaluarCondicion(v.required_if,  registro)) requerido = true
  if (v.required_unless && !evaluarCondicion(v.required_unless, registro)) requerido = true

  if (requerido && esVacio(valor)) return 'Este campo es obligatorio'
  if (esVacio(valor)) return null   // si no es requerido y está vacío, no más validaciones

  // Longitud (sobre la representación string)
  if (typeof v.minLength === 'number' || typeof v.maxLength === 'number') {
    const s = String(valor)
    if (typeof v.minLength === 'number' && s.length < v.minLength) {
      return `Mínimo ${v.minLength} caracteres`
    }
    if (typeof v.maxLength === 'number' && s.length > v.maxLength) {
      return `Máximo ${v.maxLength} caracteres`
    }
  }

  // Regex
  if (v.regex) {
    try {
      const re = new RegExp(v.regex)
      if (!re.test(String(valor))) {
        return v.regex_mensaje || 'Formato inválido'
      }
    } catch {
      // regex mal formado → ignorar para no bloquear el form
    }
  }

  // Rango numérico
  if (typeof v.min === 'number' && Number(valor) < v.min) return `Mínimo ${v.min}`
  if (typeof v.max === 'number' && Number(valor) > v.max) return `Máximo ${v.max}`

  // Custom
  if (v.custom) {
    const fn = CUSTOM_REGISTRY[v.custom]
    if (typeof fn === 'function') {
      const r = fn(valor, registro)
      if (r) return r
    }
  }

  return null
}

/**
 * Valida todos los campos visibles de una sección. Devuelve
 * { errores: { [field]: msg }, primerErrorField: string | null }.
 */
export function validarSeccion(campos, registro, evaluadorVisibilidad) {
  const errores = {}
  let primero = null
  for (const c of campos) {
    if (evaluadorVisibilidad && !evaluadorVisibilidad(c)) continue
    const e = validarCampo(c, registro?.[c.field], registro)
    if (e) {
      errores[c.field] = e
      if (!primero) primero = c.field
    }
  }
  return { errores, primerErrorField: primero }
}
