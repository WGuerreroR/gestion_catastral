select 
nextval('{esquema_destino}.t_ili2db_seq'::regclass) as t_id
,uuid_generate_v4() as t_ili_tid
,ci3.t_id as tipo
,cd1.t_id as tipo_documento
,CASE WHEN ci.documento_identidad IS NOT NULL THEN ci.documento_identidad ELSE '0' END as documento_identidad
,ci.primer_nombre as primer_nombre
,ci.segundo_nombre as segundo_nombre
,ci.primer_apellido as primer_apellido
,ci.segundo_apellido as segundo_apellido
,cs.t_id as sexo
,null as grupo_etnico
,case when ci.autorreconocimientocampesino is null then false 
else ci.autorreconocimientocampesino end as autorreconocimientocampesino
,ci.razon_social as razon_social
,ci.nombre as nombre
,now()::timestamp as comienzo_vida_util_version
,cast(null as timestamp) as fin_vida_util_version
,'Interesado' as espacio_de_nombres
,tb1.index as local_id
from temp_aux.interesado_index as tb1 
inner join {esquema_origen}.cr_interesado ci on tb1.index= ci.index
inner join {esquema_origen}.cr_interesadotipo ci2 on ci.tipo = ci2.code 
inner join {esquema_destino}.cr_interesadotipo ci3 on ci2.value = ci3.ilicode
inner join {esquema_origen}.cr_documentotipo cd on ci.tipo_documento = cd.code 
inner join {esquema_destino}.cr_documentotipo cd1 on cd.value = cd1.ilicode
left join {esquema_origen}.sexo s on ci.sexo = s.code
left join {esquema_destino}.cr_sexotipo cs on s.value=cs.ilicode;