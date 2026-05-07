"""Seed inicial de reglas para el módulo Validación de Calidad.

Lee la lógica de las 20 reglas históricas en `ETL/validacion/reglas/` y las
inserta normalizadas en `validacion_calidad_regla` con:
  - alias estandarizados (p, t, ci, uc) según la entidad objetivo,
  - placeholder {{filtro_alcance}} en la posición correcta,
  - INSERT INTO validacion_calidad_log con :job_id,
  - tipo_marca_id resuelto por código contra admin_tipo_marca (migration 015).

Idempotente vía ON CONFLICT (codigo) DO NOTHING. Una vez sembradas, los
usuarios crean/editan nuevas reglas desde la UI (la tabla es dinámica).

Requiere migrations 014, 015 y 019 aplicadas (admin_tipo_marca + columna
tipo_marca_id).

Uso:
    python scripts/seed_validacion_calidad_reglas.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api", "v1", "app"))

from sqlalchemy import text
from db.database import SessionLocal


# IMPORTANTE: cada regla declara SOLO el cuerpo SELECT que produce las 4
# columnas (job_id, numero_predial, regla, descripcion). El backend antepone
# `INSERT INTO validacion_calidad_log (...)` en runtime — en BD nunca se
# almacena el INSERT (evita inyección de DML a otras tablas).


# Mapeo regla → código de tipo de marca (admin_tipo_marca.codigo).
# Mantenerlo sincronizado con el bloque de backfill en
# migrations/019_validacion_calidad_marcas_y_gate.sql.
TIPO_MARCA_POR_REGLA = {
    "Regla 01": "IDE-NUM_PRED",
    "Regla 02": "IDE-NUM_PRED",
    "Regla 03": "IDE-NUM_PRED",
    "Regla 04": "IDE-NUM_PRED",
    "Regla 06": "IDE-NUM_PRED",
    "Regla 05": "FIS-OMISION",
    "Regla 14": "FIS-OMISION",
    "Regla 15": "FIS-OMISION",
    "Regla 18": "FIS-OMISION",
    "Regla 19": "FIS-OMISION",
    "Regla 07": "JUR-FMI-DIF",
    "Regla 08": "JUR-FMI-DIF",
    "Regla 13": "JUR-FMI-DIF",
    "Regla 09": "IDE-DIR-DUP",
    "Regla 10": "IDE-DIR-DUP",
    "Regla 11": "IDE-DIR-DUP",
    "Regla 12": "IDE-DIR-DUP",
    "Regla 16": "SIG-GEO-SOLAPE",
    "Regla 17": "SIG-GEO-SOLAPE",
    "Regla 20": "JUR-POSESION",
}


# (codigo, nombre, descripcion, entidad, sql_template)
REGLAS = [
    # ── Reglas sobre lc_predio_p ─────────────────────────────────────────────
    (
        "Regla 01",
        "Campo 22 del número predial inválido",
        "El carácter 22 del número predial no debe ser 1, 5 o 6",
        "predio",
        """SELECT :job_id, p.numero_predial, 'Regla 01', 'Campo 22 del número predial no debe ser 1, 5 o 6'
FROM lc_predio_p p
{{filtro_alcance}}
WHERE substring(p.numero_predial, 22, 1) IN ('1', '5', '6');""",
    ),
    (
        "Regla 02",
        "Prefijo del número predial",
        "Los dos primeros caracteres del número predial deben ser '15' (Boyacá)",
        "predio",
        """SELECT :job_id, p.numero_predial, 'Regla 02', 'Prefijos del número predial no coinciden con el código de departamento'
FROM lc_predio_p p
{{filtro_alcance}}
WHERE substring(p.numero_predial, 1, 2) <> '15';""",
    ),
    (
        "Regla 03",
        "Número predial duplicado",
        "Existen registros con el mismo número predial",
        "predio",
        """SELECT :job_id, p.numero_predial, 'Regla 03', 'Número predial duplicado'
FROM lc_predio_p p
{{filtro_alcance}}
WHERE p.numero_predial IN (
  SELECT numero_predial FROM lc_predio_p GROUP BY numero_predial HAVING COUNT(*) > 1
);""",
    ),
    (
        "Regla 04",
        "Matrícula inmobiliaria duplicada entre predios",
        "Una matrícula inmobiliaria está asociada a más de un número predial",
        "predio",
        """SELECT DISTINCT :job_id, p.numero_predial, 'Regla 04', 'Matrícula inmobiliaria asociada a más de un número predial'
FROM lc_predio_p p
{{filtro_alcance}}
WHERE p.matricula_inmobiliaria IN (
    SELECT matricula_inmobiliaria FROM lc_predio_p
    GROUP BY matricula_inmobiliaria
    HAVING COUNT(DISTINCT numero_predial) > 1
);""",
    ),
    (
        "Regla 05",
        "Lote no construido con construcciones",
        "Predio tipo lote urbanizado no construido (destinación 18 o 19) no debe tener construcciones",
        "predio",
        """SELECT DISTINCT :job_id, p.numero_predial, 'Regla 05', 'Predio tipo lote urbanizado no construido no debe tener construcciones'
FROM lc_predio_p p
INNER JOIN cr_caracteristicasunidadconstruccion cc ON cc.id_operacion_predio = p.id_operacion
{{filtro_alcance}}
WHERE p.destinacion_economica IN ('18','19');""",
    ),
    (
        "Regla 06",
        "Matrícula inmobiliaria mal formada",
        "Matrícula debe ser numérica de 1 a 7 dígitos y distinta de 0/NULL",
        "predio",
        """SELECT :job_id, p.numero_predial, 'Regla 06', 'Matrícula diferente de NULL o 0, y debe ser numérica entre 1 y 7 caracteres'
FROM lc_predio_p p
{{filtro_alcance}}
WHERE p.matricula_inmobiliaria IS NULL
   OR NOT (p.matricula_inmobiliaria ~ '^[0-9]+$')
   OR p.matricula_inmobiliaria::numeric = 0
   OR LENGTH(p.matricula_inmobiliaria) < 1
   OR LENGTH(p.matricula_inmobiliaria) > 7;""",
    ),
    # ── Reglas sobre interesados ────────────────────────────────────────────
    (
        "Regla 07",
        "Tenencia formal: participación = 100%",
        "Predios con matrícula (formales) deben sumar 100% de participación entre propietarios",
        "interesado",
        """SELECT :job_id, p.numero_predial, 'Regla 07', 'Tenencia formal: la suma de Datos:Propietario.Participacion debe ser 100'
FROM lc_predio_p p
LEFT JOIN cr_interesado ci ON ci.id_operacion_predio = p.id_operacion
{{filtro_alcance}}
WHERE p.matricula_inmobiliaria IS NOT NULL
GROUP BY p.numero_predial
HAVING SUM(COALESCE(ci.porcentaje_propiedad::numeric, 0)) <> 1;""",
    ),
    (
        "Regla 08",
        "Tenencia informal: 0 < participación ≤ 100",
        "Predios sin matrícula (informales) deben tener participación entre 0 y 100 (excluyente)",
        "interesado",
        """SELECT :job_id, p.numero_predial, 'Regla 08', 'Tenencia informal: la participación debe ser >0 y <100'
FROM lc_predio_p p
LEFT JOIN cr_interesado ci ON ci.id_operacion_predio = p.id_operacion
{{filtro_alcance}}
WHERE p.matricula_inmobiliaria IS NULL
GROUP BY p.numero_predial
HAVING SUM(COALESCE(ci.porcentaje_propiedad::numeric, 0)) >= 1
    OR SUM(COALESCE(ci.porcentaje_propiedad::numeric, 0)) <= 0;""",
    ),
    (
        "Regla 09",
        "Persona jurídica con tipo documento ≠ NIT",
        "Si el interesado es JURIDICA (tipo=1), su tipo_documento debe ser NIT (=2)",
        "interesado",
        """SELECT :job_id, p.numero_predial, 'Regla 09', 'Tipo Persona JURIDICA debe tener Tipo Documento NIT'
FROM cr_interesado ci
LEFT JOIN lc_predio_p p ON p.id_operacion = ci.id_operacion_predio
{{filtro_alcance}}
WHERE ci.tipo = 1 AND ci.tipo_documento <> 2;""",
    ),
    (
        "Regla 10",
        "Persona natural con tipo documento inválido",
        "Si interesado es NATURAL (tipo=0), tipo_documento debe ser CC, CE, P, TI o RC (0,1,3,4,5,6)",
        "interesado",
        """SELECT :job_id, p.numero_predial, 'Regla 10', 'Tipo Persona NATURAL debe tener Tipo Documento CC, CE, P, TI o RC'
FROM cr_interesado ci
LEFT JOIN lc_predio_p p ON p.id_operacion = ci.id_operacion_predio
{{filtro_alcance}}
WHERE ci.tipo = 0 AND ci.tipo_documento NOT IN (0, 1, 3, 4, 5, 6);""",
    ),
    (
        "Regla 11",
        "Persona jurídica con nombres/apellidos no nulos",
        "Si interesado es JURIDICA, los campos de nombres/apellidos deben ser NULL",
        "interesado",
        """SELECT :job_id, p.numero_predial, 'Regla 11', 'Tipo Persona JURIDICA: nombres y apellidos deben ser nulos'
FROM cr_interesado ci
LEFT JOIN lc_predio_p p ON p.id_operacion = ci.id_operacion_predio
{{filtro_alcance}}
WHERE ci.tipo = 1
  AND (ci.primer_nombre IS NOT NULL OR ci.segundo_nombre IS NOT NULL
    OR ci.primer_apellido IS NOT NULL OR ci.segundo_apellido IS NOT NULL);""",
    ),
    (
        "Regla 12",
        "Persona natural con sigla societaria",
        "Si interesado es NATURAL, no debe contener LTDA, S.A., & CIA, S. EN C., S.C.A. o S.A.S. en su nombre",
        "interesado",
        """SELECT :job_id, p.numero_predial, 'Regla 12', 'NATURAL no debe contener siglas societarias (LTDA, S.A., & CIA, S. EN C., S.C.A., S.A.S.)'
FROM lc_predio_p p
LEFT JOIN cr_interesado ci ON ci.id_operacion_predio = p.id_operacion
{{filtro_alcance}}
WHERE ci.tipo = 0 AND (
     ci.primer_nombre   ILIKE '%LTDA%' OR ci.primer_nombre   ILIKE '%& CIA%' OR ci.primer_nombre   ILIKE '%S. EN C%' OR ci.primer_nombre   ILIKE '%S.C.A%' OR ci.primer_nombre   ILIKE '%S.A.S%'
  OR ci.segundo_nombre  ILIKE '%LTDA%' OR ci.segundo_nombre  ILIKE '%& CIA%' OR ci.segundo_nombre  ILIKE '%S. EN C%' OR ci.segundo_nombre  ILIKE '%S.C.A%' OR ci.segundo_nombre  ILIKE '%S.A.S%'
  OR ci.primer_apellido ILIKE '%LTDA%' OR ci.primer_apellido ILIKE '%& CIA%' OR ci.primer_apellido ILIKE '%S. EN C%' OR ci.primer_apellido ILIKE '%S.C.A%' OR ci.primer_apellido ILIKE '%S.A.S%'
  OR ci.segundo_apellido ILIKE '%LTDA%' OR ci.segundo_apellido ILIKE '%& CIA%' OR ci.segundo_apellido ILIKE '%S. EN C%' OR ci.segundo_apellido ILIKE '%S.C.A%' OR ci.segundo_apellido ILIKE '%S.A.S%'
);""",
    ),
    (
        "Regla 13",
        "Predio sin propietarios",
        "Todo predio debe tener al menos un registro en cr_interesado",
        "predio",
        """SELECT :job_id, p.numero_predial, 'Regla 13', 'El predio no tiene propietarios asociados'
FROM lc_predio_p p
LEFT JOIN cr_interesado ci ON ci.id_operacion_predio = p.id_operacion
{{filtro_alcance}}
WHERE ci.id_operacion_predio IS NULL;""",
    ),
    # ── Reglas sobre unidades de construcción ───────────────────────────────
    (
        "Regla 14",
        "Unidad convencional sin calificación",
        "Si la unidad de construcción es convencional (1..4) debe tener total_calificacion > 0",
        "predio",
        """SELECT DISTINCT :job_id, p.numero_predial, 'Regla 14', 'Unidad convencional sin calificación'
FROM cr_caracteristicasunidadconstruccion cc
INNER JOIN lc_predio_p p ON p.id_operacion = cc.id_operacion_predio
{{filtro_alcance}}
WHERE cc.tipo_unidad_construccion IN (1,2,3,4)
  AND (cc.total_calificacion = 0 OR cc.total_calificacion IS NULL);""",
    ),
    (
        "Regla 15",
        "Unidad no convencional sin calificación o tipo de anexo",
        "Si la unidad de construcción es no convencional, debe tener calificación y tipo de anexo",
        "predio",
        """SELECT DISTINCT :job_id, p.numero_predial, 'Regla 15', 'Unidad no convencional sin calificación o tipo de anexo'
FROM cr_caracteristicasunidadconstruccion cc
INNER JOIN lc_predio_p p ON p.id_operacion = cc.id_operacion_predio
{{filtro_alcance}}
WHERE cc.tipo_unidad_construccion IN (1,2,3,4)
  AND (cc.tipo_anexo IS NULL OR cc.total_calificacion = 0 OR cc.total_calificacion IS NULL);""",
    ),
    # ── Reglas espaciales sobre terreno ─────────────────────────────────────
    (
        "Regla 16",
        "Traslape entre terrenos",
        "Dos predios cuyos terrenos se traslapan",
        "terreno",
        """SELECT :job_id, p.numero_predial, 'Regla 16', 'Traslape con el predio ' || p2.numero_predial
FROM cr_terreno t
JOIN cr_terreno b ON t.id_operacion_predio < b.id_operacion_predio
                  AND ST_Overlaps(t.geometry, b.geometry)
INNER JOIN lc_predio_p p  ON p.id_operacion  = t.id_operacion_predio
INNER JOIN lc_predio_p p2 ON p2.id_operacion = b.id_operacion_predio
{{filtro_alcance}};""",
    ),
    (
        "Regla 17",
        "Huecos entre terrenos",
        "Existen huecos > 1.5 m² entre terrenos colindantes",
        "terreno",
        """WITH predios_buffer AS (SELECT ST_Buffer(geometry, 3) AS geom FROM cr_terreno),
     union_buffer   AS (SELECT ST_Union(geom) AS geom FROM predios_buffer),
     shrink_back    AS (SELECT ST_Buffer(geom, -3) AS geom FROM union_buffer),
     huecos AS (
       SELECT (ST_Dump(ST_Difference(s.geom, u.geom))).geom AS gap_geom
       FROM shrink_back s
       CROSS JOIN (SELECT ST_Union(geometry) AS geom FROM cr_terreno) u
       WHERE ST_Area(s.geom) > 0
     )
SELECT :job_id, p.numero_predial, 'Regla 17',
       'Hueco detectado cerca del predio (área ≈ ' || ROUND(ST_Area(h.gap_geom)::numeric, 2) || ' m²)'
FROM huecos h
JOIN cr_terreno t ON ST_DWithin(h.gap_geom, t.geometry, 0.5)
JOIN lc_predio_p p ON p.id_operacion = t.id_operacion_predio
{{filtro_alcance}}
WHERE ST_Area(h.gap_geom) > 1.5;""",
    ),
    (
        "Regla 18",
        "Característica sin unidad de construcción",
        "cr_caracteristicasunidadconstruccion sin registro en cr_unidadconstruccion",
        "predio",
        """SELECT DISTINCT :job_id, p.numero_predial, 'Regla 18',
       'Característica sin unidad de construcción asociada (id ' || cc.id_operacion_unidad_cons || ')'
FROM cr_caracteristicasunidadconstruccion cc
LEFT JOIN cr_unidadconstruccion cu ON cu.id_operacion_unidad_const = cc.id_operacion_unidad_cons
INNER JOIN lc_predio_p p ON p.id_operacion = cc.id_operacion_predio
{{filtro_alcance}}
WHERE cu.id_operacion_unidad_const IS NULL;""",
    ),
    (
        "Regla 19",
        "Unidad de construcción sin característica",
        "cr_unidadconstruccion sin registro en cr_caracteristicasunidadconstruccion",
        "unidad_construccion",
        """SELECT DISTINCT :job_id, p.numero_predial, 'Regla 19',
       'Unidad dibujada sin característica (id ' || uc.id_operacion_unidad_const || ')'
FROM cr_unidadconstruccion uc
LEFT JOIN cr_caracteristicasunidadconstruccion cc ON cc.id_operacion_unidad_cons = uc.id_operacion_unidad_const
INNER JOIN lc_predio_p p ON p.id_operacion = uc.id_operacion_predio
{{filtro_alcance}}
WHERE cc.id_operacion_unidad_cons IS NULL;""",
    ),
    (
        "Regla 20",
        "Predio informal sin registro de informalidad",
        "Si campo 22 del número predial es '2' (informal), debe existir registro en lc_informalidad",
        "predio",
        """SELECT :job_id, p.numero_predial, 'Regla 20', 'Informalidades debe estar diligenciado en tabla lc_informalidad'
FROM lc_predio_p p
LEFT JOIN lc_informalidad li ON li.id_operacion_predio_informal = p.id_operacion
{{filtro_alcance}}
WHERE substring(p.numero_predial, 22, 1) = '2'
  AND li.id_operacion_predio_informal IS NULL;""",
    ),
]


def _resolver_tipo_marca_ids(db) -> dict:
    """Devuelve {codigo_tipo_marca: id} para los códigos del mapeo.
    Útil para evitar 20 SELECTs uno por regla."""
    codigos = sorted(set(TIPO_MARCA_POR_REGLA.values()))
    rows = db.execute(text(
        "SELECT codigo, id FROM admin_tipo_marca WHERE codigo = ANY(:cs)"
    ), {"cs": codigos}).fetchall()
    return {r.codigo: r.id for r in rows}


def main() -> None:
    db = SessionLocal()
    insertados = 0
    saltados = 0
    sin_tipo = 0
    try:
        tipo_marca_ids = _resolver_tipo_marca_ids(db)
        faltantes = sorted(set(TIPO_MARCA_POR_REGLA.values()) - tipo_marca_ids.keys())
        if faltantes:
            print(f"⚠  Tipos de marca no encontrados en admin_tipo_marca: {faltantes}")
            print("   Esas reglas se insertarán con tipo_marca_id=NULL.")
            print("   Aplica migrations/015_seed_tipo_marca.sql primero.\n")

        for orden, (codigo, nombre, descripcion, entidad, sql) in enumerate(REGLAS, start=1):
            tipo_codigo = TIPO_MARCA_POR_REGLA.get(codigo)
            tipo_id = tipo_marca_ids.get(tipo_codigo) if tipo_codigo else None
            if tipo_codigo and not tipo_id:
                sin_tipo += 1

            res = db.execute(text("""
                INSERT INTO validacion_calidad_regla
                  (codigo, nombre, descripcion, entidad, sql_template, activa, orden,
                   tipo_marca_id, creado_por, actualizado_por)
                VALUES
                  (:codigo, :nombre, :descripcion, :entidad, :sql, TRUE, :orden,
                   :tipo_marca_id, 'seed', 'seed')
                ON CONFLICT (codigo) DO NOTHING
                RETURNING id
            """), {
                "codigo": codigo, "nombre": nombre, "descripcion": descripcion,
                "entidad": entidad, "sql": sql, "orden": orden,
                "tipo_marca_id": tipo_id,
            }).fetchone()
            if res:
                insertados += 1
                marca_info = f" → {tipo_codigo}" if tipo_id else (
                    f" → {tipo_codigo} (tipo no encontrado)" if tipo_codigo else " (sin tipo)"
                )
                print(f"  ✔ {codigo} ({entidad}){marca_info}")
            else:
                saltados += 1
                print(f"  · {codigo} ya existe — sin cambios")
        db.commit()
        print(f"\nSeed completado: {insertados} insertadas, {saltados} ya existían.")
        if sin_tipo:
            print(f"⚠  {sin_tipo} regla(s) quedaron con tipo_marca_id=NULL — verifica admin_tipo_marca.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
