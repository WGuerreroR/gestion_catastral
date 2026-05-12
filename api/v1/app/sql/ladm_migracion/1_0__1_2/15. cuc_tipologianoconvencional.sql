select 
c.t_id_anexo as t_id,
c.tipo_anexo ,
c.conservacion_anexo 
from {esquema_origen}.caracteristicas c 
where tipo_anexo is not null