select 
nextval('{esquema_destino}.t_ili2db_seq'::regclass)as t_id, 
ip.t_id as t_seq,
etd.t_id as tipo_direccion,
    CASE 
        WHEN lpp.es_direccion_principal = 1 THEN TRUE
        WHEN lpp.es_direccion_principal = 2 THEN FALSE
        ELSE false  
    END AS es_direccion_principal,
null as localizacion,
null as codigo_postal,
ecvp.t_id as clase_via_principal ,
lpp.valor_via_principal ,
lpp.letra_via_principal ,
lpp.letra_via_generadora ,
esc.t_id as sector_ciudad,
lpp.valor_via_generadora,
lpp.numero_predio::numeric as numero_predio ,
esp.t_id as sector_predio ,
lpp.complemento,
lpp.nombre_predio ,
null as extunidadedificcnfsica_ext_direccion_id,
null as extinteresado_ext_direccion_id,
null as cr_terreno_ext_direccion_id,
null as cr_unidadconstruccion_ext_direccion_id,
ip.t_id as ilc_predio_direccion
from {esquema_origen}.lc_predio_p lpp 
left join {esquema_origen}.lc_direcciontipo ld on lpp.tipo_direccion = ld.code
left join {esquema_destino}.extdireccion_tipo_direccion etd on ld.value = etd.ilicode
left join {esquema_origen}.clase_viaprincipal cv  on lpp.clase_via_principal = cv.code 
left join {esquema_destino}.extdireccion_clase_via_principal ecvp on cv.value = ecvp.ilicode
left join {esquema_origen}.sector st on lpp.sector_ciudad = st.code 
left join {esquema_destino}.extdireccion_sector_ciudad esc on st.value = esc.ilicode 
left join {esquema_origen}.sector st1 on lpp.sector_predio = st1.code 
left join {esquema_destino}.extdireccion_sector_predio esp on st1.value = esp.ilicode 
inner join {esquema_destino}.ilc_predio ip on lpp.numero_predial = ip.numero_predial_nacional