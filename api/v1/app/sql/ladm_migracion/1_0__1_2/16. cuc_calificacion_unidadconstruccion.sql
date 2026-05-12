SELECT
    nextval('{esquema_destino}.t_ili2db_seq'::regclass) AS t_id,
    ic.t_id AS ilc_caracteristicasunidadconstruccion,
    NULL::BIGINT AS cuc_clfccnndcnstrccion_cuc_tipologiaconstruccion,
    CASE
        WHEN cc.t_id IS NOT NULL THEN c.t_id_calificacionconvencional
        ELSE NULL
    END AS cuc_clfccnndcnstrccion_cuc_calificacionconvencional,
    CASE
        WHEN ct.t_id IS NOT NULL THEN c.t_id_anexo
        ELSE NULL
    END AS cuc_clfccnndcnstrccion_cuc_tipologianoconvencional
FROM {esquema_origen}.caracteristicas c
INNER JOIN {esquema_destino}.ilc_caracteristicasunidadconstruccion ic
    ON ic.espacio_de_nombres = c.source_id_uc
LEFT JOIN {esquema_destino}.cuc_calificacionconvencional cc ON c.t_id_calificacionconvencional = cc.t_id
LEFT JOIN {esquema_destino}.cuc_tipologianoconvencional ct ON ct.t_id = c.t_id_anexo
WHERE ct.t_id IS NOT NULL OR cc.t_id IS NOT NULL