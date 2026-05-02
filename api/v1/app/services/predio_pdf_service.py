"""
Generación de PDF del visor de predios con fpdf2.

Toma el form JSON + los datos del predio + el cliente de catálogos y
arma un documento siguiendo la misma estructura que el visor:
   header con metadata → secciones (registro_unico, lista) →
   subsecciones de cada item.

Esta iteración NO incluye el mapa (sería un screenshot server-side
que requiere Playwright o similar — fuera de scope). Sí incluye fotos.

Convenciones:
  - Codificación core fonts: latin-1. Se sanitizan strings no
    representables (caracteres asiáticos / emojis → '?').
  - Fotos: se resuelven via predio_fotos_service y se redimensionan
    con Pillow para que la imagen embebida pese < 200 KB y no infle
    el PDF resultante.
"""
import io
import json
from pathlib import Path
from typing import Any, Optional

from fpdf import FPDF
from PIL import Image
from sqlalchemy.orm import Session

from repositories import dominio_repo, predio_completo_repo
from services import predio_fotos_service, predio_form_loader
from routers.dominios import DOMINIOS_PERMITIDOS

# Path al logo Ingicat (mantener sincronizado con webapp/src/assets/ingicat.png)
ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
LOGO_PATH  = ASSETS_DIR / "ingicat.png"


# ─── Sanitización de texto (core fonts → latin-1) ──────────────────

def _safe(value: Any) -> str:
    if value is None or value == "":
        return "-"
    s = str(value)
    return s.encode("latin-1", "replace").decode("latin-1")


def _label_value(value: Any, campo: dict, dominios_cache: dict) -> str:
    """Convierte un valor a string para mostrar (descripción de catálogo
    si es select, número formateado, etc.). Siempre devuelve un string
    seguro para core fonts (latin-1)."""
    if value is None or value == "":
        return "-"

    widget = campo.get("widget")

    if widget == "select" and campo.get("domain") in dominios_cache:
        items = dominios_cache[campo["domain"]]
        for it in items:
            if str(it["code"]) == str(value):
                return _safe(it["description"])
        return _safe(f"{value} (sin descripcion)")

    if widget == "boolean":
        labels = campo.get("labels") or {"true": "Sí", "false": "No"}
        return _safe(labels["true"]) if value else _safe(labels["false"])

    if widget == "number":
        try:
            n = float(value)
            decimales = campo.get("decimales")
            if isinstance(decimales, int):
                return _safe(f"{n:,.{decimales}f}")
            return _safe(f"{n:,g}")
        except (TypeError, ValueError):
            return _safe(value)

    if widget == "date":
        return _safe(str(value)[:10])

    if widget == "geometry" and isinstance(value, dict) and value.get("type"):
        def _count(c):
            if not isinstance(c, list): return 0
            if c and isinstance(c[0], (int, float)): return 1
            return sum(_count(x) for x in c)
        return _safe(f"{value['type']} ({_count(value.get('coordinates'))} vertices)")

    return _safe(value)


# ─── Catálogos: cache por request ──────────────────────────────────

def _precargar_dominios(db: Session, form: dict) -> dict[str, list]:
    """Detecta todos los `domain` referenciados en widgets `select` y
    los carga una sola vez."""
    dominios = set()
    def visitar(seccion):
        for c in (seccion.get("campos") or []):
            if c.get("widget") == "select" and c.get("domain") in DOMINIOS_PERMITIDOS:
                dominios.add(c["domain"])
        if seccion.get("subseccion"):
            visitar(seccion["subseccion"])
    for s in form.get("secciones", []):
        visitar(s)

    return {d: dominio_repo.get_catalogo(db, d) for d in dominios}


# ─── Resolución de datos por sección ───────────────────────────────

_TABLA_A_PATH = {
    "lc_predio_p":                          "predio",
    "cr_terreno":                           "terreno",
    "cr_unidadconstruccion":                "unidades",
    "cr_caracteristicasunidadconstruccion": "caracteristicas",
    "cr_interesado":                        "interesados",
}


def _datos_seccion(predio_completo: dict, seccion: dict):
    path = _TABLA_A_PATH.get(seccion.get("tabla_origen"))
    if not path:
        return None
    return predio_completo.get(path)


# ─── Visibilidad (espejo simple del front, sin condicionales por ahora) ─

def _es_visible(campo: dict, registro: dict) -> bool:
    from services.predio_validators import es_visible
    return es_visible(campo.get("visible_if"), registro or {})


# ─── PDF ───────────────────────────────────────────────────────────

class PredioPDF(FPDF):
    def __init__(self, predio: dict):
        super().__init__(format="A4", unit="mm")
        self.predio = predio
        self.set_auto_page_break(auto=True, margin=15)
        self.set_margins(left=12, top=15, right=12)
        self.alias_nb_pages()

    def header(self):
        # Logo Ingicat (esquina superior izquierda). Si el archivo no
        # existe, se omite y el header sigue funcionando.
        logo_w_mm = 28
        if LOGO_PATH.exists():
            try:
                self.image(str(LOGO_PATH), x=12, y=10, w=logo_w_mm)
            except Exception:
                logo_w_mm = 0
        else:
            logo_w_mm = 0

        # Título y metadata desplazados a la derecha del logo
        x_texto = 12 + (logo_w_mm + 4 if logo_w_mm else 0)
        self.set_xy(x_texto, 12)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(40, 40, 40)
        titulo = _safe(
            self.predio.get("nombre_predio")
            or self.predio.get("id_operacion")
            or "Predio"
        )
        self.cell(0, 6, titulo, ln=True)

        self.set_x(x_texto)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(120, 120, 120)
        meta = (
            f"id_operacion: {_safe(self.predio.get('id_operacion'))}    "
            f"NP: {_safe(self.predio.get('numero_predial'))}"
        )
        self.cell(0, 4, meta, ln=True)

        # Línea separadora bajo el bloque de header (logo + texto)
        y_linea = max(self.get_y() + 1, 12 + 18)
        self.set_draw_color(220, 220, 220)
        self.line(12, y_linea, 198, y_linea)
        self.set_y(y_linea + 3)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "I", 7)
        self.set_text_color(150, 150, 150)
        self.cell(
            0, 6,
            f"Página {self.page_no()} / {{nb}}    Generado por Ingicat",
            align="C",
        )


def _embedir_foto(pdf: FPDF, ruta_abs: Path, max_w_mm: float = 75) -> bool:
    """Inserta una foto en la posición actual del PDF. Devuelve True
    si la insertó. Redimensiona con Pillow si el archivo es muy grande."""
    if not ruta_abs.exists() or not ruta_abs.is_file():
        return False
    try:
        img = Image.open(ruta_abs)
        img.load()
        # Limitar a ~1200 px de ancho para que el PDF no pese demasiado
        max_px = 1200
        if img.width > max_px:
            ratio = max_px / img.width
            img = img.resize((max_px, int(img.height * ratio)), Image.LANCZOS)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80, optimize=True)
        buf.seek(0)
        pdf.image(buf, w=max_w_mm, type="JPEG")
        return True
    except Exception:
        return False


def _render_campos(
    pdf: PredioPDF,
    campos: list[dict],
    registro: dict,
    dominios: dict,
    id_operacion: str,
    proyecto_clave: Optional[str],
):
    """Renderiza los campos de un registro como pares label / valor.
    Las fotos se renderean a ancho completo bajo el resto."""
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(40, 40, 40)

    fotos_pendientes = []

    for campo in campos:
        if not _es_visible(campo, registro):
            continue
        widget = campo.get("widget")
        label  = _safe(campo.get("label") or campo.get("field"))
        value  = registro.get(campo["field"])

        if widget == "photo":
            if value:
                fotos_pendientes.append((label, value))
            continue

        # Layout apilado: label (chico, gris) arriba, valor abajo. Evita
        # los conflictos de cell+multi_cell en la misma línea.
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(110, 110, 110)
        pdf.cell(0, 4, label, ln=True)

        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(40, 40, 40)
        txt = _label_value(value, campo, dominios)
        pdf.multi_cell(0, 4.5, txt)
        pdf.ln(0.5)

    if fotos_pendientes and proyecto_clave:
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 8)
        pdf.cell(0, 4, "Fotos:", ln=True)
        pdf.set_font("Helvetica", "", 8)
        for label, ruta_rel in fotos_pendientes:
            try:
                ruta_abs = predio_fotos_service.resolver_path_foto(proyecto_clave, ruta_rel)
            except ValueError:
                continue
            pdf.cell(0, 4, label, ln=True)
            if not _embedir_foto(pdf, ruta_abs):
                pdf.set_text_color(150, 150, 150)
                pdf.cell(0, 4, "  (foto no disponible)", ln=True)
                pdf.set_text_color(40, 40, 40)
            pdf.ln(2)


def _render_seccion(
    pdf: PredioPDF,
    seccion: dict,
    predio_completo: dict,
    dominios: dict,
    id_operacion: str,
    proyecto_clave: Optional[str],
):
    if seccion.get("tipo") == "mapa":
        return  # mapa no se incluye en esta iteración

    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(25, 118, 210)
    pdf.cell(0, 6, _safe(seccion.get("titulo") or seccion.get("id")), ln=True)
    pdf.set_text_color(40, 40, 40)
    pdf.set_draw_color(220, 220, 220)
    pdf.line(12, pdf.get_y(), 198, pdf.get_y())
    pdf.ln(2)

    datos = _datos_seccion(predio_completo, seccion)

    if seccion.get("tipo") == "registro_unico":
        if not datos:
            pdf.set_font("Helvetica", "I", 9)
            pdf.cell(0, 5, _safe(f'(sin datos para "{seccion.get("titulo")}")'), ln=True)
            return
        _render_campos(pdf, seccion.get("campos") or [], datos, dominios, id_operacion, proyecto_clave)
        return

    if seccion.get("tipo") == "lista":
        items = datos or []
        if not items:
            pdf.set_font("Helvetica", "I", 9)
            pdf.cell(0, 5, _safe(f'(sin registros en "{seccion.get("titulo")}")'), ln=True)
            return
        for i, item in enumerate(items):
            label_item = seccion.get("label_item") or f"Item {i+1}"
            # Sustituir {{campo}}
            for k, v in (item or {}).items():
                label_item = label_item.replace(f"{{{{{k}}}}}", str(v) if v is not None else "")
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(245, 124, 0)
            pdf.cell(0, 5, _safe(label_item), ln=True)
            pdf.set_text_color(40, 40, 40)
            _render_campos(pdf, seccion.get("campos") or [], item, dominios, id_operacion, proyecto_clave)

            sub = seccion.get("subseccion")
            if sub:
                data_key = sub.get("data_key", "caracteristicas")
                sub_data = (item or {}).get(data_key)
                if sub_data:
                    pdf.ln(1)
                    pdf.set_font("Helvetica", "B", 8)
                    pdf.cell(0, 4, _safe(sub.get("titulo") or "Detalle"), ln=True)
                    _render_campos(pdf, sub.get("campos") or [], sub_data, dominios, id_operacion, proyecto_clave)
            pdf.ln(2)
        return


# ─── Entrada principal ─────────────────────────────────────────────

def generar_pdf_predio(
    db: Session,
    id_operacion: str,
    form_id: str = "predio-completo-lectura",
) -> Optional[bytes]:
    form = predio_form_loader.cargar_form(form_id)
    if not form:
        return None

    predio_completo = predio_completo_repo.get_completo(db, id_operacion)
    if not predio_completo:
        return None

    dominios = _precargar_dominios(db, form)

    # Proyecto activo (para resolver paths de fotos). Si no hay, no se
    # embeben fotos pero el PDF se genera igual.
    proyecto = predio_fotos_service.resolver_proyecto_activo(db, id_operacion)
    proyecto_clave = proyecto["clave_proyecto"] if proyecto else None

    pdf = PredioPDF(predio_completo.get("predio") or {})
    pdf.add_page()

    for seccion in (form.get("secciones") or []):
        _render_seccion(pdf, seccion, predio_completo, dominios, id_operacion, proyecto_clave)

    # fpdf2 v2.8 devuelve bytes con bytes() (en lugar de output(dest='S'))
    raw = pdf.output()
    return bytes(raw)
