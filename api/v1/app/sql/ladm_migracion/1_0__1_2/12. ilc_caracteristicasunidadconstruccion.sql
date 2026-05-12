select distinct
nextval('{esquema_destino}.t_ili2db_seq'::regclass) t_id,
uuid_generate_v4() t_ili_tid,
LEFT(COALESCE(c.identificador, c.npn, c.id_operacion_unidad_cons), 20) identificador,
cu5.t_id tipo_unidad_construccion ,
coalesce(c.total_plantas::numeric,1) as total_plantas,
cu3.t_id uso 
,coalesce(c.anio_construccion ,2002)anio_construccion, --colocar año de ultima actualizacion
coalesce(c.area_construida,1) area_construida,  
c.area_privada_construida::numeric  area_privada_construida,
c.observaciones observaciones
,null usos_tradicionales_culturales
,now() comienzo_vida_util_version,
null fin_vida_util_version,
c.id_operacion_unidad_cons espacio_de_nombres,
COALESCE(c.npn, c.id_operacion_unidad_cons) as local_id
from {esquema_origen}.cr_caracteristicasunidadconstruccion  c 
inner join {esquema_origen}.cr_usoconstipo cu on c.uso = cu.code
inner join {esquema_destino}.cr_usouconstipo cu3 on cu.value = cu3.ilicode 
inner join {esquema_origen}.cr_unidadconstrucciontipo cu4 on c.tipo_unidad_construccion =cu4.code
inner join {esquema_destino}.cr_unidadconstrucciontipo cu5 on cu4.value = cu5.ilicode 