from fastapi import APIRouter, Body, Depends, Query, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Any, Dict, Optional, List

from db.database import get_db
from core.deps import get_current_user, require_roles
from repositories import predio_repo, predio_completo_repo, predio_guardar_repo, marca_predio_repo
from schemas.predio import PredioResponse
from services import predio_fotos_service, predio_form_loader, predio_validators, predio_pdf_service

router = APIRouter(prefix="/predios", tags=["predios"])


# Tablas LADM cuya auditoría puede consultarse. Whitelist mínima — el
# endpoint hoy es stub (devuelve siempre cambios=[]) pero la lista evita
# que entren nombres arbitrarios cuando se conecte al sistema real.
TABLAS_AUDITABLES: set[str] = {
    "lc_predio_p",
    "cr_terreno",
    "cr_unidadconstruccion",
    "cr_caracteristicasunidadconstruccion",
    "cr_interesado",
}


@router.get("/", response_model=List[PredioResponse])
def listar_predios(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
    estado: Optional[str]     = Query(None),
    persona_id: Optional[int] = Query(None),
    municipio: Optional[str]  = Query(None),
    npn: Optional[str]        = Query(None)
):
    return predio_repo.get_all(db, estado, persona_id, municipio, npn)


@router.get("/geojson")
def predios_geojson(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
    persona_id: Optional[int] = Query(None)
):
    roles    = user.get("roles", [])
    es_admin = "admin" in roles or "gerente" in roles
    uid      = int(user["sub"])
    return predio_repo.get_geojson(db, persona_id, es_admin, uid)


@router.get("/{busqueda}/completo")
def get_predio_completo(
    busqueda: str,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    incluir_geometrias: bool = Query(True),
    incluir_fotos_metadata: bool = Query(True),
):
    """
    Devuelve el predio + terreno + N unidades (con características) +
    interesados. `busqueda` puede ser id_operacion o numero_predial; se
    detecta por formato (numero_predial son solo dígitos, ≥17 chars).
    """
    data = predio_completo_repo.get_completo(
        db, busqueda,
        incluir_geometrias=incluir_geometrias,
        incluir_fotos_metadata=incluir_fotos_metadata,
    )
    if not data:
        raise HTTPException(404, f"Predio no encontrado: {busqueda}")
    return data


@router.get("/{id_operacion}/fotos/{ruta_relativa:path}")
def servir_foto_predio(
    id_operacion: str,
    ruta_relativa: str,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """
    Sirve una foto del predio resolviendo internamente el último
    proyecto activo del predio (el visor no nace dentro de un
    contexto de proyecto). 404 si el predio no tiene proyecto
    asociado o si la foto no existe en disco.
    """
    proyecto = predio_fotos_service.resolver_proyecto_activo(db, id_operacion)
    if not proyecto:
        raise HTTPException(404, "Predio sin proyecto asociado")

    try:
        path_abs = predio_fotos_service.resolver_path_foto(
            proyecto["clave_proyecto"], ruta_relativa
        )
    except ValueError:
        raise HTTPException(400, "Ruta inválida")

    if not path_abs.exists() or not path_abs.is_file():
        raise HTTPException(404, "Foto no encontrada")

    return FileResponse(path_abs)


@router.get("/{id_operacion}/auditoria/{tabla}/{pk}")
def get_auditoria_campo(
    id_operacion: str,
    tabla: str,
    pk: str,
    _user=Depends(require_roles("administrador", "supervisor", "gerente")),
):
    """
    Stub temporal: devuelve siempre `cambios: []`. La implementación
    real con triggers SQL + tabla `audit_log` queda para una iteración
    posterior. El frontend renderiza "Sin cambios registrados aún"
    cuando el array viene vacío.
    """
    if tabla not in TABLAS_AUDITABLES:
        raise HTTPException(400, f"Tabla '{tabla}' no auditable")

    return {
        "tabla": tabla,
        "pk": pk,
        "id_operacion": id_operacion,
        "cambios": [],
    }


class GuardarRequest(BaseModel):
    form_id: str
    cambios: Dict[str, Any]   # tabla → dict (registro_unico) | list[dict] (lista)


@router.post("/{id_operacion}/guardar")
def guardar_predio(
    id_operacion: str,
    body: GuardarRequest = Body(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Guarda cambios del visor de predios.

    - Carga el form JSON desde `app/forms/{form_id}.json`.
    - Whitelist de tablas y campos: solo se aceptan los declarados en
      el form. Cualquier campo extraño → 400.
    - Permisos: cada sección debe tener `roles_edicion` que intersecte
      con los roles del usuario; si no, 403.
    - Re-aplica todas las reglas de validación del JSON (no se confía
      en cliente). Si hay errores → 422 con detalle por campo.
    - Aplica UPDATE por tabla en una transacción y devuelve el predio
      completo actualizado.
    """
    form = predio_form_loader.cargar_form(body.form_id)
    if not form:
        raise HTTPException(404, f"Form '{body.form_id}' no encontrado")

    secciones_idx = predio_form_loader.secciones_por_tabla(form)
    user_roles    = set(user.get("roles") or [])

    # Bypass por marca: si el usuario es responsable de una marca abierta del
    # predio, puede editar aunque no califique por roles_edicion.
    try:
        persona_id_actual = int(user["sub"])
    except (KeyError, TypeError, ValueError):
        persona_id_actual = None
    edita_por_marca = (
        persona_id_actual is not None
        and marca_predio_repo.has_marca_abierta_como_responsable(
            db, id_operacion, persona_id_actual
        )
    )

    # 1. Validar permisos + whitelist de campos + reglas server-side
    errores_globales: dict = {}
    cambios_normalizados: list[tuple[str, dict, list[dict]]] = []

    for tabla, payload in body.cambios.items():
        seccion = secciones_idx.get(tabla)
        if not seccion:
            raise HTTPException(
                400,
                f"Tabla '{tabla}' no está declarada en el form '{body.form_id}'",
            )

        roles_edicion = set(seccion.get("roles_edicion") or [])
        if roles_edicion and not (user_roles & roles_edicion) and not edita_por_marca:
            raise HTTPException(
                403,
                f"Sección '{seccion.get('id')}' requiere uno de estos "
                f"roles: {sorted(roles_edicion)}",
            )

        campos_declarados = {c["field"]: c for c in (seccion.get("campos") or [])}
        id_pk_field       = seccion.get("id_pk_field")
        registros         = payload if isinstance(payload, list) else [payload]
        regs_validos      = []

        for reg in registros:
            if not isinstance(reg, dict):
                raise HTTPException(400, f"Registro inválido para tabla '{tabla}'")

            # Whitelist de campos (excepto el pk, que solo identifica)
            for k in list(reg.keys()):
                if k == id_pk_field:
                    continue
                if k not in campos_declarados:
                    raise HTTPException(
                        400,
                        f"Campo '{k}' no está declarado en sección "
                        f"'{seccion.get('id')}' (tabla {tabla})",
                    )

            # Validación con reglas del JSON, considerando visibilidad
            errores_reg: dict = {}
            for c in campos_declarados.values():
                if not predio_validators.es_visible(c.get("visible_if"), reg):
                    continue
                if c["field"] not in reg:
                    continue   # campo no editado en este request
                err = predio_validators.validar_campo(c, reg.get(c["field"]), reg)
                if err:
                    errores_reg[c["field"]] = err
            if errores_reg:
                key = reg.get(id_pk_field) if id_pk_field else "_"
                errores_globales.setdefault(tabla, {})[str(key)] = errores_reg

            regs_validos.append(reg)

        cambios_normalizados.append((tabla, seccion, regs_validos))

    if errores_globales:
        raise HTTPException(
            status_code=422,
            detail={"mensaje": "Errores de validación", "errores": errores_globales},
        )

    # 2. Aplicar UPDATEs en una transacción
    try:
        for tabla, seccion, registros in cambios_normalizados:
            id_pk_field = seccion.get("id_pk_field")

            if tabla in predio_guardar_repo.UPDATERS_REGISTRO_UNICO:
                # Único registro por predio (lc_predio_p, cr_terreno)
                reg = registros[0] if registros else {}
                campos = {k: v for k, v in reg.items() if k != id_pk_field}
                predio_guardar_repo.UPDATERS_REGISTRO_UNICO[tabla](db, id_operacion, campos)

            elif tabla in predio_guardar_repo.UPDATERS_LISTA:
                # Múltiples registros (cr_unidad..., cr_interesado, etc.)
                updater = predio_guardar_repo.UPDATERS_LISTA[tabla]
                for reg in registros:
                    pk = reg.get(id_pk_field)
                    if not pk:
                        raise HTTPException(
                            400,
                            f"Falta PK '{id_pk_field}' en un registro de '{tabla}'",
                        )
                    campos = {k: v for k, v in reg.items() if k != id_pk_field}
                    updater(db, pk, campos)

            else:
                raise HTTPException(
                    400,
                    f"Tabla '{tabla}' no es editable desde el visor",
                )

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Error al guardar: {e}") from e

    # 3. Devolver el predio completo actualizado
    actualizado = predio_completo_repo.get_completo(db, id_operacion)
    if not actualizado:
        raise HTTPException(404, "Predio no encontrado tras guardar")
    return actualizado


@router.get("/{id_operacion}/export-pdf")
def export_predio_pdf(
    id_operacion: str,
    form_id: str = Query("predio-completo-lectura"),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """
    Genera un PDF con la información del predio según el form_id
    indicado. Stream `application/pdf`. No incluye mapa en esta
    iteración; sí incluye fotos disponibles en el paquete offline.
    """
    pdf_bytes = predio_pdf_service.generar_pdf_predio(db, id_operacion, form_id)
    if pdf_bytes is None:
        raise HTTPException(404, "Predio o form no encontrado")

    filename = f"predio_{id_operacion}.pdf".replace("/", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
