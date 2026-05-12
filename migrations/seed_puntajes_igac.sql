-- Seed de puntos IGAC (Res. 070/2011) para admin_puntaje_calificacion.
--
-- Estrategia: pattern matching sobre cuc_*tipo.value (la BD usa code/value,
-- no t_id/ilicode). Patrones usan stems para tolerar género/transliteración:
--   - "Buena" / "Bueno" → `buen`
--   - "Pequenia" / "Pequenio" → `pequen`
--   - "Mediana" / "Mediano" → `median`
--   - "Lujoso" / "Lujosa" / "Lujosos" → `lujo`
-- Si un value no matchea, cae al fallback (medio del subcomponente).
--
-- Fórmula IGAC (suma de 4 componentes = 100):
--   Estructura (35): armazon(10) + muros(10) + cubierta(8) + piso(7)
--   Acabados   (30): fachada(15) + cubrimiento_muros(15)
--   Baño       (17): tamanio(6) + enchape(6) + mobiliario(5)
--   Cocina     (18): tamanio(6) + enchape(6) + mobiliario(6)
--
-- ON CONFLICT DO NOTHING: respeta valores ya editados manualmente.
-- Para resembrar: TRUNCATE admin_puntaje_calificacion;
--
-- Uso: psql "$DATABASE_URL" -f migrations/seed_puntajes_igac.sql

-- Función temporal para normalizar el value (lowercase + sin tildes)
CREATE OR REPLACE FUNCTION pg_temp.norm_val(s text) RETURNS text AS $$
    SELECT translate(lower(coalesce(s, '')), 'áéíóúüñ', 'aeiouun');
$$ LANGUAGE sql IMMUTABLE;


-- ════════════════════════════════════════════════════════════════════
-- ARMAZÓN (max 10)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'armazon', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(concreto|hierro|acero|reforzad|metalic)' THEN 10
        WHEN pg_temp.norm_val(t.value) ~ '(ladrillo|bloque)'                        THEN 8
        WHEN pg_temp.norm_val(t.value) ~ '(madera).*?(fina|fino|inmunizad)'         THEN 7
        WHEN pg_temp.norm_val(t.value) ~ '(madera|prefabricad)'                     THEN 5
        WHEN pg_temp.norm_val(t.value) ~ '(bahareque|guadua|esterilla)'             THEN 3
        WHEN pg_temp.norm_val(t.value) ~ '(tapia|adobe|barro)'                      THEN 2
        WHEN pg_temp.norm_val(t.value) ~ '(desech|sin_|ningun|otro)'                THEN 1
        ELSE 5
    END
  FROM cuc_armazontipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- MUROS (max 10)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'muros', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(concreto|reforzad)'                      THEN 10
        WHEN pg_temp.norm_val(t.value) ~ '(ladrillo).*?(maciz|comun|tolet)'         THEN 9
        WHEN pg_temp.norm_val(t.value) ~ '(ladrillo|bloque)'                        THEN 8
        WHEN pg_temp.norm_val(t.value) ~ '(madera).*?(fina|fino)'                   THEN 6
        WHEN pg_temp.norm_val(t.value) ~ '(madera|prefabricad)'                     THEN 4
        WHEN pg_temp.norm_val(t.value) ~ '(bahareque|adobe|tapia)'                  THEN 3
        WHEN pg_temp.norm_val(t.value) ~ '(esterilla|guadua|pirca)'                 THEN 2
        WHEN pg_temp.norm_val(t.value) ~ '(zinc|carton|plastico|lata|desech)'       THEN 1
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun)'                            THEN 0
        ELSE 5
    END
  FROM cuc_murostipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- CUBIERTA (max 8)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'cubierta', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(placa).*?(impermeabiliz|lujo)'           THEN 8
        WHEN pg_temp.norm_val(t.value) ~ '(losa|placa|concreto|reforzad|azotea)'    THEN 7
        WHEN pg_temp.norm_val(t.value) ~ '(eternit|asbesto|fibrocemento|aluminio)'  THEN 6
        WHEN pg_temp.norm_val(t.value) ~ '(teja).*?(barro|ceramica|arcilla)'        THEN 5
        WHEN pg_temp.norm_val(t.value) ~ '(teja|metalic|zinc|lamina)'               THEN 4
        WHEN pg_temp.norm_val(t.value) ~ '(madera|esterilla|paja|palma)'            THEN 3
        WHEN pg_temp.norm_val(t.value) ~ '(plastico|carton|lona|asfaltic|desech)'   THEN 2
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun)'                            THEN 0
        ELSE 4
    END
  FROM cuc_cubiertatipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- PISO (max 7)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'piso', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(marmol|porcelan|parquet|madera.*?fina)'  THEN 7
        WHEN pg_temp.norm_val(t.value) ~ '(granito|tableta|baldosa.*?fina|alfombra)' THEN 6
        WHEN pg_temp.norm_val(t.value) ~ '(ceramica|baldosin|vinilo|caucho|acrilic|liston|machihembrad)' THEN 5
        WHEN pg_temp.norm_val(t.value) ~ '(baldosa|tablon)'                         THEN 4
        WHEN pg_temp.norm_val(t.value) ~ '(cemento|mortero|burda)'                  THEN 2
        WHEN pg_temp.norm_val(t.value) ~ '(tierra|arena|sin_)'                      THEN 0
        ELSE 3
    END
  FROM cuc_pisotipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- FACHADA (max 15)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'fachada', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(lujo|marmol|granito|piedra)'             THEN 15
        WHEN pg_temp.norm_val(t.value) ~ '(buen|estuco|graniplast)'                 THEN 12
        WHEN pg_temp.norm_val(t.value) ~ '(regular)'                                THEN 9
        WHEN pg_temp.norm_val(t.value) ~ '(sencill|simple|economic|paete|paniete)'  THEN 5
        WHEN pg_temp.norm_val(t.value) ~ '(pobre)'                                  THEN 2
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun|en_obra)'                    THEN 0
        ELSE 7
    END
  FROM cuc_fachadatipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- CUBRIMIENTO DE MUROS (interior) (max 15)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'cubrimiento_muros', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(marmol|lujo|granito|piedra.*?ornamen)'   THEN 15
        WHEN pg_temp.norm_val(t.value) ~ '(madera|piedra)'                          THEN 10
        WHEN pg_temp.norm_val(t.value) ~ '(estuco|ceramica|papel.*?fino)'           THEN 12
        WHEN pg_temp.norm_val(t.value) ~ '(buen|revoque)'                           THEN 9
        WHEN pg_temp.norm_val(t.value) ~ '(paniete|paete|papel|ladrillo.*?prensad)' THEN 5
        WHEN pg_temp.norm_val(t.value) ~ '(simple|regular)'                         THEN 7
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun)'                            THEN 0
        ELSE 7
    END
  FROM cuc_cubrimiento_murostipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- BAÑO — Tamaño (max 6)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'tamanio_banio', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(grand|ampli|lujo)'                       THEN 6
        WHEN pg_temp.norm_val(t.value) ~ '(median|normal)'                          THEN 4
        WHEN pg_temp.norm_val(t.value) ~ '(pequen|reducid|minim)'                   THEN 2
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun)'                            THEN 0
        ELSE 3
    END
  FROM cuc_tamanio_baniotipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- BAÑO — Enchape (max 6)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'enchape_banio', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(marmol|lujo|granito)'                    THEN 6
        WHEN pg_temp.norm_val(t.value) ~ '(ceramica|cristanac|papel.*?fino)'        THEN 5
        WHEN pg_temp.norm_val(t.value) ~ '(baldosin.*?decorad)'                     THEN 4
        WHEN pg_temp.norm_val(t.value) ~ '(baldosin|paniete|paete|baldosa)'         THEN 3
        WHEN pg_temp.norm_val(t.value) ~ '(simple|economic)'                        THEN 1
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun)'                            THEN 0
        ELSE 3
    END
  FROM cuc_enchape_baniotipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- BAÑO — Mobiliario (max 5)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'mobiliario_banio', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(lujo|jacuzzi|completo.*?lujo)'           THEN 5
        WHEN pg_temp.norm_val(t.value) ~ '(buen|completo)'                          THEN 4
        WHEN pg_temp.norm_val(t.value) ~ '(regular)'                                THEN 3
        WHEN pg_temp.norm_val(t.value) ~ '(sencill|basico|incomplet)'               THEN 2
        WHEN pg_temp.norm_val(t.value) ~ '(pobre|simple|economic)'                  THEN 1
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun)'                            THEN 0
        ELSE 2
    END
  FROM cuc_mobiliario_baniotipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- COCINA — Tamaño (max 6)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'tamanio_cocina', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(grand|ampli|lujo)'                       THEN 6
        WHEN pg_temp.norm_val(t.value) ~ '(median|normal)'                          THEN 4
        WHEN pg_temp.norm_val(t.value) ~ '(pequen|reducid|minim)'                   THEN 2
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun)'                            THEN 0
        ELSE 3
    END
  FROM cuc_tamanio_cocinatipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- COCINA — Enchape (max 6)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'enchape_cocina', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(marmol|lujo|granito)'                    THEN 6
        WHEN pg_temp.norm_val(t.value) ~ '(ceramica|cristanac|papel.*?fino)'        THEN 5
        WHEN pg_temp.norm_val(t.value) ~ '(baldosin.*?decorad)'                     THEN 4
        WHEN pg_temp.norm_val(t.value) ~ '(baldosin|paniete|paete|baldosa)'         THEN 3
        WHEN pg_temp.norm_val(t.value) ~ '(simple|economic)'                        THEN 1
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun)'                            THEN 0
        ELSE 3
    END
  FROM cuc_enchape_cocinatipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- COCINA — Mobiliario (max 6)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO admin_puntaje_calificacion (componente, tipo_id, puntos)
SELECT 'mobiliario_cocina', t.code,
    CASE
        WHEN pg_temp.norm_val(t.value) ~ '(lujo|empotrad|integral)'                 THEN 6
        WHEN pg_temp.norm_val(t.value) ~ '(buen|completo|meson.*?marmol)'           THEN 5
        WHEN pg_temp.norm_val(t.value) ~ '(regular)'                                THEN 3
        WHEN pg_temp.norm_val(t.value) ~ '(sencill|basico|incomplet)'               THEN 2
        WHEN pg_temp.norm_val(t.value) ~ '(pobre|simple|economic)'                  THEN 1
        WHEN pg_temp.norm_val(t.value) ~ '(sin_|ningun)'                            THEN 0
        ELSE 2
    END
  FROM cuc_mobiliario_cocinatipo t
ON CONFLICT (componente, tipo_id) DO NOTHING;


-- ─── Verificación rápida tras correr el seed ─────────────────────────
-- SELECT componente, COUNT(*) AS tipos,
--        MIN(puntos) AS min, MAX(puntos) AS max, ROUND(AVG(puntos), 1) AS prom
--   FROM admin_puntaje_calificacion
--  GROUP BY componente ORDER BY componente;
