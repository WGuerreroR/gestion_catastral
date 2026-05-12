select
nextval('{esquema_destino}.t_ili2db_seq'::regclass) as t_id,
uuid_generate_v4() as t_ili_tid,
COALESCE(lpp.primer_nombre_quien_atendio, 'Sin información') as nombres_apellidos_quien_atendio,
cd2.t_id as tipo_documento_quien_atendio,
lpp.tipo_doc_quien_atendio as numero_documento_quien_atendio,
lpp.domicilio_notificaciones as domicilio_notificaciones,
CASE WHEN lpp.celular::BIGINT BETWEEN 1 AND 2147483647 THEN lpp.celular::INTEGER ELSE NULL END as celular,
lpp.correo_electronico as correo_electronico,
false as autoriza_notificaciones,
id.t_id as ilc_datos_adicionales
from {esquema_origen}.lc_predio_p lpp
inner join {esquema_origen}.cr_documentotipo cd on lpp.tipo_doc_quien_atendio = cd.code 
left join {esquema_destino}.cr_documentotipo cd2 on cd.value = cd2.ilicode 
inner join {esquema_destino}.ilc_predio ip on lpp.numero_predial = ip.numero_predial_nacional 
inner join {esquema_destino}.ilc_datosadicionaleslevantamientocatastral id on ip.t_id = id.ilc_predio 
