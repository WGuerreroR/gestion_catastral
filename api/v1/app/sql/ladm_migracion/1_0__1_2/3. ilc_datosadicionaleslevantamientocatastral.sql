select 
nextval('{esquema_destino}.t_ili2db_seq'::regclass) t_id,
uuid_generate_v4() t_ili_tid,
lpp.observaciones observaciones,
lpp.fecha_visita_predial::timestamp  fecha_visita_predial,
coalesce(ir.t_id, ir2.t_id)  resultado_visita ,
false::boolean as comodato,  ----falta preguntarlo
false::boolean as beneficio_comunidades_indigenas,   ----falta preguntarlo
ip.t_id ilc_predio
from {esquema_origen}.lc_predio_p lpp
inner join {esquema_destino}.ilc_predio ip on lpp.numero_predial = ip.numero_predial_nacional
left join {esquema_origen}.lc_resultadovisitatipo lr on lpp.resultado_visita = lr.code 
left join {esquema_destino}.ilc_resultadovisitatipo ir on lr.value = ir.ilicode 
left join {esquema_destino}.ilc_resultadovisitatipo ir2  on ir2.ilicode = 'Sin_Visita'

