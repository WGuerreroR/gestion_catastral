"""
UPDATE statements para el endpoint POST /predios/{id}/guardar.

Una función por tabla LADM editable. Todas son UPDATE (no INSERT) — el
visor de predios edita registros existentes, la creación de nuevas
unidades / interesados se hace por flujos separados (QField sync u
otro). Cada función:
  - Recibe `campos` ya validados y filtrados a la whitelist del JSON.
  - Setea `last_edited_date = NOW()` para auditoría básica.
  - NO commitea — el caller maneja la transacción.
"""
from sqlalchemy.orm import Session
from sqlalchemy import text


def _set_clause(campos: dict) -> str:
    return ", ".join(f"{k} = :{k}" for k in campos.keys())


def update_lc_predio_p(db: Session, id_operacion: str, campos: dict) -> None:
    if not campos:
        return
    db.execute(text(f"""
        UPDATE lc_predio_p
        SET {_set_clause(campos)}, last_edited_date = NOW()
        WHERE id_operacion = :_id
    """), {**campos, "_id": id_operacion})


def update_cr_terreno(db: Session, id_operacion: str, campos: dict) -> None:
    if not campos:
        return
    db.execute(text(f"""
        UPDATE cr_terreno
        SET {_set_clause(campos)}, last_edited_date = NOW()
        WHERE id_operacion_predio = :_id
    """), {**campos, "_id": id_operacion})


def update_cr_unidadconstruccion(db: Session, pk: str, campos: dict) -> None:
    if not campos:
        return
    db.execute(text(f"""
        UPDATE cr_unidadconstruccion
        SET {_set_clause(campos)}, last_edited_date = NOW()
        WHERE id_operacion_uc_geo = :_pk
    """), {**campos, "_pk": pk})


def update_cr_caracteristicas(db: Session, pk: str, campos: dict) -> None:
    if not campos:
        return
    db.execute(text(f"""
        UPDATE cr_caracteristicasunidadconstruccion
        SET {_set_clause(campos)}, last_edited_date = NOW()
        WHERE id_operacion_unidad_cons = :_pk
    """), {**campos, "_pk": pk})


def update_cr_interesado(db: Session, pk: str, campos: dict) -> None:
    if not campos:
        return
    db.execute(text(f"""
        UPDATE cr_interesado
        SET {_set_clause(campos)}, last_edited_date = NOW()
        WHERE globalid = :_pk
    """), {**campos, "_pk": pk})


# Mapeo declarativo tabla → updater. Si una tabla no está aquí, no es
# editable desde el visor (el endpoint devuelve 400).
UPDATERS_REGISTRO_UNICO = {
    "lc_predio_p":  update_lc_predio_p,
    "cr_terreno":   update_cr_terreno,
}

UPDATERS_LISTA = {
    "cr_unidadconstruccion":                update_cr_unidadconstruccion,
    "cr_caracteristicasunidadconstruccion": update_cr_caracteristicas,
    "cr_interesado":                        update_cr_interesado,
}
