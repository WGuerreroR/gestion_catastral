select 
nextval('{esquema_destino}.t_ili2db_seq'::regclass) t_id, 
uuid_generate_v4() t_ili_tid, 
cu3.t_id  tipo_planta, 
planta_ubicacion  planta_ubicacion, 
altura  altura, 
st_force3d(st_force2d(geometry))  geometria, 
ic.t_id  cr_caracteristicasunidadconstruccion, 
cd.t_id  dimension, 
etiqueta  etiqueta, 
cr.t_id  relacion_superficie, 
now() comienzo_vida_util_version, 
null::timestamp  fin_vida_util_version, 
cu.id_operacion_uc_geo espacio_de_nombres, 
ic.local_id  local_id
from {esquema_origen}.cr_unidadconstruccion cu
inner join {esquema_origen}.cr_caracteristicasunidadconstruccion cc on cu.id_operacion_unidad_const = cc.id_operacion_unidad_cons
inner join {esquema_destino}.ilc_caracteristicasunidadconstruccion ic on ic.espacio_de_nombres = cc.id_operacion_unidad_cons 
left join {esquema_origen}.cr_construccion_planta  cu2 on cu.tipo_planta = cu2.code 
left join {esquema_destino}.cr_construccionplantatipo  cu3 on cu2.value = cu3.ilicode 
inner join {esquema_destino}.col_dimensiontipo cd on cd.ilicode = 'Dim2D'
inner join {esquema_destino}.col_relacionsuperficietipo cr on cr.ilicode = 'En_Rasante'
