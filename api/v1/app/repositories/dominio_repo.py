from sqlalchemy.orm import Session
from sqlalchemy import text


def get_catalogo(db: Session, tabla: str) -> list[dict]:
    """
    Devuelve los items de un catálogo LADM (tabla *tipo).

    Las tablas LADM siguen el patrón `code` (int) + `value` (text).
    Normalizamos a `{ code: str, description: str }` para que el
    frontend reciba el contrato uniforme que espera el widget select
    (siempre strings).

    El nombre de tabla DEBE estar validado contra la whitelist en el
    caller — esta función asume que `tabla` ya es seguro para
    interpolar en SQL.
    """
    resultado = db.execute(text(f"""
        SELECT
            CAST(code AS TEXT)  AS code,
            value               AS description
        FROM {tabla}
        WHERE value IS NOT NULL
        ORDER BY code
    """)).fetchall()
    return [dict(r._mapping) for r in resultado]
