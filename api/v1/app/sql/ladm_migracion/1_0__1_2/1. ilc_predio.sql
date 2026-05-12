TRUNCATE TABLE {esquema_destino}.ilc_predio CASCADE;
SELECT                                      
    nextval('{esquema_destino}.t_ili2db_seq'::regclass) t_id, 
    uuid_generate_v4() t_ili_tid,                     
    lp.departamento departamento,               
    lp.municipio municipio,                  
    LEFT(lp.codigo_orip, 4) codigo_orip,                                     
   CASE
    WHEN lp.matricula_inmobiliaria ~ '^[0-9]+$' AND lp.matricula_inmobiliaria::numeric < 1
        THEN NULL
    WHEN lp.matricula_inmobiliaria ~ '^[0-9]+$'
        THEN lp.matricula_inmobiliaria::numeric
    ELSE NULL
END AS matricula_inmobiliaria,   
    lp.area_terreno_catastral area_catastral_terreno,     --tiene valor null                                 
    lp.numero_predial numero_predial_nacional,                                     
    ip.t_id as tipo ,                                      
    lc1.t_id condicion_predio,                                     
    id.t_id destinacion_economica,                                     
    lp.area_registral_m2 area_registral_m2,                                      
    lp.nombre_predio nombre,                                     
    now() comienzo_vida_util_version,                                     
    null fin_vida_util_version,                                     
    lp.id_operacion espacio_de_nombres,                                     
    lp.numero_predial local_id                                   
FROM {esquema_origen}.lc_predio_p as lp
left join {esquema_origen}.lc_condicionprediotipo lc on lp.condicion_predio = lc.code 
left join {esquema_destino}.ilc_condicionprediotipo lc1 on lc.value = lc1.ilicode 
left join {esquema_origen}.lc_destinacioneconomicatipo ld on lp.destinacion_economica = ld.code 
left join {esquema_destino}.ilc_destinacioneconomicatipo id on ld.value = id.ilicode 
left join {esquema_origen}.lc_prediotipo lp2 on lp.tipo = lp2.code 
left join {esquema_destino}.ilc_prediotipo ip on lp2.value = ip.ilicode;