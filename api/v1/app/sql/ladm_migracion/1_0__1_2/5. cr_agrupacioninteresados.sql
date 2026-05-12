with
	predios_grupos_propietarios as
	(
		select ci.local_id,count(ci.local_id) as conteo  from {esquema_origen}.cr_interesado ci 
		group by ci.local_id
		having count(ci.local_id) >1
	),
	predios_propietario_indiv as
	(
		select ci.local_id,count(ci.local_id) as conteo from {esquema_origen}.cr_interesado ci 
		group by ci.local_id
		having count(ci.local_id) <2
	),
	conteos as
	(
		select count(*) as conteo, 'grupos'  from predios_grupos_propietarios
		union all
		select count (*) as conteo, 'indiv' from predios_propietario_indiv
	),
	grupos_tipo as
	(
		select 
			tb1.*
			,count(case when tipo_documento=0 then 1 else null end) as count_natural
			,count(case when tipo_documento<>0 then 1 else null end) as count_juridico
			,case
				when count(case when tipo_documento=2 then 1 else null end)=0 and count(case when tipo_documento<>2 then 1 else null end)>0
					then 0
				when count(case when tipo_documento=2 then 1 else null end)>0 and count(case when tipo_documento<>2 then 1 else null end)=0
					then 1
				else 3
			 end as tipo
		from predios_grupos_propietarios tb1
		inner join {esquema_origen}.cr_interesado tb2
			on tb1.local_id=tb2.local_id
		group by tb1.local_id,tb1.conteo
	)
select
	nextval('{esquema_destino}.t_ili2db_seq'::regclass) as t_id
	,uuid_generate_v4() as t_ili_tid
	,git.t_id as tipo
	,gt.local_id as nombre
	,now()::timestamp as comienzo_vida_util_version
	,cast(null as timestamp) as fin_vida_util_version
	,'Agrupación' as espacio_de_nombres
	,gt.local_id as local_id
from grupos_tipo as gt
inner join {esquema_destino}.col_grupointeresadotipo git on gt.tipo=git.itfcode
;