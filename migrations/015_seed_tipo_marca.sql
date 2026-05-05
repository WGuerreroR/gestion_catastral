-- Migración 015 — Datos iniciales del catálogo `admin_tipo_marca`.
-- Idempotente: ON CONFLICT (codigo) DO NOTHING aprovecha el UNIQUE de la
-- migración 014, así que se puede re-ejecutar sin duplicar filas.

INSERT INTO public.admin_tipo_marca (categoria, codigo, significado) VALUES
    ('FISICA',         'FIS-DEMOLICION',    'Construcción desaparecida o demolida'),
    ('FISICA',         'FIS-AMPLIACION',    'Ampliación de construcción'),
    ('FISICA',         'FIS-LINDERO',       'Posible ajuste de lindero o cabida'),
    ('FISICA',         'FIS-OMISION',       'Omisión de predio o mejora'),
    ('JURIDICA',       'JUR-FMI-DIF',       'Folio de matrícula o titular no coincide'),
    ('JURIDICA',       'JUR-PH-NOREG',      'Propiedad horizontal sin desagregación o con unidades faltantes'),
    ('JURIDICA',       'JUR-POSESION',      'Posible posesión u ocupación'),
    ('ECONOMICA',      'ECO-USO-CAMBIO',    'Cambio de uso o destino económico'),
    ('ECONOMICA',      'ECO-MERCADO-ALTO',  'Zona con dinámica inmobiliaria atípica'),
    ('IDENTIFICACION', 'IDE-DIR-DUP',       'Dirección incompleta, duplicada o inconsistente'),
    ('IDENTIFICACION', 'IDE-NUM_PRED',      'No tiene número predial'),
    ('SIG',            'SIG-GEO-SOLAPE',    'Solape, hueco o inconsistencia gráfica')
ON CONFLICT (codigo) DO NOTHING;
