select 
nextval('{esquema_destino}.t_ili2db_seq'::regclass) as t_id
,fuente.t_id as fuente_administrativa
,predio.t_id as unidad
from {esquema_destino}.ilc_predio as predio
inner join {esquema_destino}.ilc_fuenteadministrativa as fuente
on predio.numero_predial_nacional =fuente.local_id