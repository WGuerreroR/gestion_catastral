select
nextval('{esquema_destino}.t_ili2db_seq'::regclass) t_id,
uuid_generate_v4() t_ili_tid,
st_force3d(st_force2d(ct.geometry)) as geometria,
cd.t_id  dimension,
ct.etiqueta ,
cr.t_id  relacion_superficie,
now() comienzo_vida_util_version,
null fin_vida_util_version,
'terreno' espacio_de_nombres,
ip.numero_predial_nacional local_id 
from {esquema_origen}.cr_terreno ct 
inner join {esquema_origen}.lc_predio_p lp on ct.npn = lp.numero_predial 
inner join {esquema_destino}.ilc_predio ip on lp.numero_predial = ip.numero_predial_nacional
inner join {esquema_destino}.col_relacionsuperficietipo cr on cr.ilicode = 'En_Rasante'
inner join {esquema_destino}.col_dimensiontipo cd on cd.ilicode = 'Dim2D' 