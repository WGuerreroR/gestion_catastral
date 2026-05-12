select
	nextval('{esquema_destino}.t_ili2db_seq'::regclass),
	fa.t_id as fuente_administrativa ,
	id.t_id as rrr
from {esquema_destino}.ilc_derecho id
inner join {esquema_destino}.ilc_fuenteadministrativa fa
on id.local_id = fa.local_id;