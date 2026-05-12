select
	nextval('{esquema_destino}.t_ili2db_seq'::regclass),
	uuid_generate_v4(),
	id.t_id as tipo,
	false as posesion_ancestral_y_o_tradicional,
	coalesce (lc.fecha_inicio_tenencia,'01/01/1900'::timestamp ) as fecha_inicio_tenencia ,-----arreglar fechas
	'Derecho' descripcion,
	ip.t_id  as unidad,
	now() comienzo_vida_util_version,
	null fin_vida_util_version,
	lc.id_operacion_derecho  espacio_de_nombres,
	ip.numero_predial_nacional 
from {esquema_origen}.lc_derecho lc 
left join {esquema_origen}.lc_derechotipo ld on lc.tipo = ld.code
left join {esquema_destino}.ilc_derechocatastraltipo id  on ld.value = id.ilicode 
inner join {esquema_origen}.lc_predio_p lpp on lc.id_operacion_predio = lpp.id_operacion 
inner join {esquema_destino}.ilc_predio ip on lpp.numero_predial = ip.numero_predial_nacional 
