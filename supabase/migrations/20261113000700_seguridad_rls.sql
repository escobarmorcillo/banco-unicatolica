-- =====================================================================
-- Fase 2 · 07 · Permisos y políticas RLS
-- El backend usa la conexión del servidor y no se ve afectado.
-- Estas reglas protegen la base si alguien intenta usar las claves públicas
-- de Supabase (roles anon y authenticated) directamente:
--   - anon (sin sesión): sin acceso.
--   - authenticated: solo lectura; el personal ve todo y cada cliente
--     solo sus propios datos. Nadie escribe directamente.
-- No modifica datos.
-- =====================================================================

-- ---------- Funciones auxiliares ----------
-- security definer: leen perfiles sin quedar bloqueadas por las propias políticas.

create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rol from public.perfiles where id = auth.uid() and activo;
$$;

create or replace function public.cliente_actual()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select cliente_id from public.perfiles where id = auth.uid() and activo;
$$;

revoke execute on function public.rol_actual() from public, anon;
revoke execute on function public.cliente_actual() from public, anon;
grant execute on function public.rol_actual() to authenticated;
grant execute on function public.cliente_actual() to authenticated;

-- ---------- Permisos sobre tablas ----------

revoke all on table public.clientes, public.cuentas, public.transacciones, public.perfiles from anon, authenticated;
grant select on table public.clientes, public.cuentas, public.transacciones, public.perfiles to authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Funciones internas de triggers: no se exponen.
revoke execute on function public.actualizar_fecha_actualizacion() from public, anon, authenticated;
revoke execute on function public.proteger_saldo_cuenta() from public, anon, authenticated;
revoke execute on function public.impedir_modificar_transacciones() from public, anon, authenticated;

-- ---------- RLS ----------

alter table public.clientes enable row level security;
alter table public.cuentas enable row level security;
alter table public.transacciones enable row level security;
alter table public.perfiles enable row level security;

-- Se eliminan y se vuelven a crear para que el script pueda ejecutarse más de una vez.
drop policy if exists perfiles_lectura on public.perfiles;
create policy perfiles_lectura on public.perfiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.rol_actual()) = 'administrador');

drop policy if exists clientes_lectura on public.clientes;
create policy clientes_lectura on public.clientes
  for select to authenticated
  using (
    (select public.rol_actual()) in ('administrador', 'cajero')
    or id = (select public.cliente_actual())
  );

drop policy if exists cuentas_lectura on public.cuentas;
create policy cuentas_lectura on public.cuentas
  for select to authenticated
  using (
    (select public.rol_actual()) in ('administrador', 'cajero')
    or cliente_id = (select public.cliente_actual())
  );

drop policy if exists transacciones_lectura on public.transacciones;
create policy transacciones_lectura on public.transacciones
  for select to authenticated
  using (
    (select public.rol_actual()) in ('administrador', 'cajero')
    or exists (
      select 1 from public.cuentas c
      where c.id = transacciones.cuenta_id
        and c.cliente_id = (select public.cliente_actual())
    )
  );
