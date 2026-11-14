-- =====================================================================
-- Fase 2 · 02 · Tabla clientes
-- - fecha_nacimiento pasa de texto a fecha real (los textos AAAA-MM-DD se convierten).
-- - fecha_actualizacion se mantiene automáticamente.
-- No elimina filas ni columnas.
-- =====================================================================

alter table public.clientes
  alter column fecha_nacimiento type date using fecha_nacimiento::date;

create or replace trigger clientes_fecha_actualizacion
  before update on public.clientes
  for each row execute function public.actualizar_fecha_actualizacion();
