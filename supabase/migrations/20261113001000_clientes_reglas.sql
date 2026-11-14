-- =====================================================================
-- Fase 4 · 10 · Reglas de clientes
-- - Tipos de documento permitidos: Cédula y Pasaporte (mayores de edad).
-- - Formato: documento de 1 a 10 dígitos, teléfono de 10 dígitos, correo con @.
-- - El cliente debe ser mayor de 18 años al registrarlo o al corregir su fecha.
-- - No se inactiva un cliente con cuentas activas.
-- - Un cliente inactivo no se puede editar; primero hay que activarlo.
-- No elimina ni modifica filas existentes.
-- =====================================================================

alter table public.clientes drop constraint if exists clientes_tipo_documento_valido;
alter table public.clientes
  add constraint clientes_tipo_documento_valido check (tipo_documento in ('Cedula', 'Pasaporte'));

alter table public.clientes drop constraint if exists clientes_documento_formato;
alter table public.clientes
  add constraint clientes_documento_formato check (documento ~ '^[0-9]{1,10}$');

alter table public.clientes drop constraint if exists clientes_telefono_formato;
alter table public.clientes
  add constraint clientes_telefono_formato check (telefono ~ '^[0-9]{10}$');

alter table public.clientes drop constraint if exists clientes_correo_formato;
alter table public.clientes
  add constraint clientes_correo_formato check (correo ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

create or replace function public.validar_cliente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.fecha_nacimiento is distinct from old.fecha_nacimiento then
    if new.fecha_nacimiento > (current_date - interval '18 years')::date then
      raise exception using errcode = 'NB400', message = 'El cliente debe ser mayor de 18 años. Verifica la fecha de nacimiento.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.estado = 'inactivo' and new.estado = 'inactivo' then
      raise exception using errcode = 'NB409', message = 'No se puede actualizar un cliente inactivo. Actívalo primero.';
    end if;
    if old.estado = 'activo' and new.estado = 'inactivo' and exists (
      select 1 from public.cuentas where cliente_id = new.id and estado = 'activo'
    ) then
      raise exception using errcode = 'NB409', message = 'No se puede inactivar el cliente porque tiene cuentas activas asociadas.';
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger clientes_validar
  before insert or update on public.clientes
  for each row execute function public.validar_cliente();

revoke execute on function public.validar_cliente() from public, anon, authenticated;
