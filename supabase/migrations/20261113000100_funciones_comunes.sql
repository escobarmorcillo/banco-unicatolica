-- =====================================================================
-- Fase 2 · 01 · Funciones comunes
-- Funciones que usan varias tablas. Debe ejecutarse antes que las demás.
-- No modifica datos.
-- =====================================================================

-- Mantiene actualizada la columna fecha_actualizacion en cada UPDATE.
create or replace function public.actualizar_fecha_actualizacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.fecha_actualizacion := now();
  return new;
end;
$$;
