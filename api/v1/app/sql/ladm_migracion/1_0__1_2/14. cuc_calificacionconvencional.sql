select 
c.t_id_calificacionconvencional as t_id,
c.tipo_calificacion ,
c.armazon ,
c.muros ,
c.cubierta ,
c.conservacion_estructura ,
c.fachada ,
c.cubrimiento_muros::int, 
c.piso ,
c.conservacion_acabados ,
c.tamanio_banio ,
c.enchape_banio ,
c.mobiliario_banio ,
c.conservacion_banio ,
c.tamanio_cocina, 
c.enchape_cocina ,
c.mobiliario_cocina, 
c.conservacion_cocina, 
c.cerchas_complemento_industria::int, 
c.altura_cerchas_superior_6m, 
c.total_calificacion 
from {esquema_origen}.caracteristicas c 
where tipo_calificacion is not null
and armazon is not null and cubierta is not null
