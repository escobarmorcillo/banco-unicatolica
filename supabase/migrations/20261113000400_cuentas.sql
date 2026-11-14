-- =====================================================================
-- Fase 2 · 04 · Tabla cuentas
-- - fecha_actualizacion se mantiene automáticamente.
-- - El saldo solo puede cambiar a través de las funciones de depósito y retiro
--   (archivo 06). Un UPDATE directo del saldo se rechaza.
-- No elimina filas ni columnas.
-- =====================================================================

create or replace trigger cuentas_fecha_actualizacion
  before update on public.cuentas
  for each row execute function public.actualizar_fecha_actualizacion();

-- Las funciones de movimiento activan la marca "novabank.movimiento_autorizado"
-- solo durante su propia transacción; cualquier otro cambio de saldo se bloquea.
create or replace function public.proteger_saldo_cuenta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.saldo is distinct from old.saldo
     and coalesce(current_setting('novabank.movimiento_autorizado', true), '') <> 'si' then
    raise exception using
      errcode = 'NB409',
      message = 'El saldo solo puede cambiar mediante depósitos o retiros.';
  end if;
  return new;
end;
$$;

create or replace trigger cuentas_proteger_saldo
  before update on public.cuentas
  for each row execute function public.proteger_saldo_cuenta();
