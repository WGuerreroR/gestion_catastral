select
nextval('ladm.t_ili2db_seq'::regclass) t_id, 
uuid_generate_v4() t_ili_tid, 
0 area_total_terreno, 
0 area_total_terreno_privada, 
0 area_total_terreno_comun, 
0 area_total_construida, 
0 area_total_construida_privada, 
0 area_total_construida_comun, 
0 numero_torres, 
0 total_unidades_privadas, 
ip.t_id  ilc_predio
from public.lc_predio_p lpp 
inner join {esquema_destino}.ilc_predio ip on ip.espacio_de_nombres = lpp.id_operacion
where substring(ip.numero_predial_nacional,22,8) in ('900000000','800000000') 
