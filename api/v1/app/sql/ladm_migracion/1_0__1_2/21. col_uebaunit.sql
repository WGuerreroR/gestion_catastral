select
nextval('ladm.t_ili2db_seq'::regclass) t_id,
null ue_cr_terreno,
rt.t_id ue_cr_unidadconstruccion
, rp.t_id baunit 
from {esquema_destino}.cr_unidadconstruccion  rt  
inner join {esquema_destino}.ilc_predio  rp 
on rt.local_id =rp.local_id ;