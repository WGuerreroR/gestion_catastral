-- Catálogo de puntajes (componente, tipo_id) → puntos para calcular
-- total_calificacion en cr_caracteristicasunidadconstruccion según
-- IGAC Resolución 070/2011 (Estructura 35 + Acabados 30 + Baño 17 + Cocina 18).

CREATE TABLE IF NOT EXISTS public.admin_puntaje_calificacion (
    componente text   NOT NULL,
    tipo_id    int    NOT NULL,
    puntos     numeric NOT NULL,
    PRIMARY KEY (componente, tipo_id),
    CHECK (componente IN (
        'armazon', 'muros', 'cubierta', 'piso',
        'fachada', 'cubrimiento_muros',
        'tamanio_banio',  'enchape_banio',  'mobiliario_banio',
        'tamanio_cocina', 'enchape_cocina', 'mobiliario_cocina'
    ))
);

COMMENT ON TABLE public.admin_puntaje_calificacion IS
  'Puntos por (componente, tipo) para calcular total_calificacion según IGAC Res. 070/2011';
