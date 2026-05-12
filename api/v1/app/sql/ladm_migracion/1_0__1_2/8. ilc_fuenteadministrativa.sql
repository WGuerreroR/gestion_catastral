select 
nextval('{esquema_destino}.t_ili2db_seq'::regclass),
uuid_generate_v4(),
COALESCE(cf.t_id, '376') AS tipo,
ld.ente_emisor as ente_emisor, 
'Fuente' as observacion, 
ld.numero_fuente as num_fuente, 
ce2.t_id as estado_disp , 
null, 
ld.fecha_fuente ,
lpp.numero_predial ,
lpp.numero_predial 
from {esquema_origen}.lc_derecho ld
left join {esquema_origen}.tipo_fteadm tf on ld.tipo_ftadmin = tf.code 
left join {esquema_destino}.col_fuenteadministrativatipo cf on tf.value = cf.ilicode 
inner join {esquema_origen}.lc_predio_p lpp on ld.npn = lpp.npn
inner join {esquema_destino}.col_estadodisponibilidadtipo ce2 on ce2.ilicode='Desconocido'
