-- =====================================================================
-- Fase 2 · 05 · Tabla transacciones
-- - operador_id: usuario que realizó la operación.
-- - idempotency_key: código único de cada operación; evita duplicar reintentos.
-- - Regla de coherencia: saldo_resultante = saldo_anterior ± monto.
-- - El historial es inmodificable: no se permite UPDATE ni DELETE.
-- No elimina filas. Las columnas nuevas quedan vacías (NULL) en filas existentes.
-- =====================================================================

alter table public.transacciones
  add column if not exists operador_id uuid references auth.users (id) on delete restrict,
  add column if not exists idempotency_key uuid;

-- Se elimina y se vuelve a crear para que el script pueda ejecutarse más de una vez.
alter table public.transacciones
  drop constraint if exists transacciones_idempotency_key_key;
alter table public.transacciones
  add constraint transacciones_idempotency_key_key unique (idempotency_key);

alter table public.transacciones
  drop constraint if exists transacciones_saldo_coherente;
alter table public.transacciones
  add constraint transacciones_saldo_coherente check (
    (tipo_transaccion = 'deposito' and saldo_resultante = saldo_anterior + monto)
    or (tipo_transaccion = 'retiro' and saldo_resultante = saldo_anterior - monto)
  );

create index if not exists transacciones_operador_idx
  on public.transacciones (operador_id);

create or replace function public.impedir_modificar_transacciones()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'NB409',
    message = 'El historial de transacciones no se puede modificar ni eliminar.';
end;
$$;

create or replace trigger transacciones_inmutables
  before update or delete on public.transacciones
  for each row execute function public.impedir_modificar_transacciones();
