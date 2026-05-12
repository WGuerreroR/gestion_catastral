with index_normalizados as
(
	select 
		tb1.index index_normalizado, 
		tb2.index index_sn 
	from temp_aux.interesado_index tb1 
	inner join {esquema_origen}.cr_interesado tb2
		on concat(tb1.nombre,tb1.tipo_documento,tb1.documento_identidad)=
		concat(tb2.nombre,tb2.tipo_documento,tb2.documento_identidad)
)
select 
	 nextval('{esquema_destino}.t_ili2db_seq'::regclass) as t_id
	,tb1.t_id as interesado_ilc_interesado
	,tb4.t_id as interesado_cr_agrupacioninteresados
	,tb4.t_id as agrupacion
	,tb3.porcentaje_propiedad as participacion
from {esquema_destino}.ilc_interesado tb1
inner join index_normalizados tb2 on tb1.local_id=cast(tb2.index_normalizado as VARCHAR)
inner join {esquema_origen}.cr_interesado tb3 on tb2.index_sn=tb3.index
inner join {esquema_destino}.cr_agrupacioninteresados tb4 on tb3.local_id =tb4.local_id
ORDER BY agrupacion
;
