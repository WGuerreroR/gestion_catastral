select 
nextval('ladm.t_ili2db_seq'::regclass) t_id, 
ip.t_id unidad_predial, 
ip2.t_id matriz, 
p.porcentaje_copropiedad::numeric  coeficiente, 
0 area_coeficiente
from {esquema_origen}.lc_predio_p p
inner join {esquema_destino}.ilc_predio ip on p.numero_predial = ip.numero_predial_nacional
inner join {esquema_destino}.ilc_predio ip2 on p.npn_matriz = ip2.numero_predial_nacional
where p.porcentaje_copropiedad::numeric<1