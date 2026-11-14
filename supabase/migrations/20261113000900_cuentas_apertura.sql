-- =====================================================================
-- Fase 4 · 09 · Apertura de cuentas
-- - Número de cuenta automático y único: 10 dígitos = prefijo del tipo
--   (10 Ahorros, 20 Corriente, 30 Nómina) + consecutivo de 8 dígitos.
--   Cada tipo tiene su propia secuencia, segura con aperturas simultáneas.
-- - Una cuenta nueva empieza con saldo cero; el saldo inicial se registra
--   como un depósito, para que saldo y movimientos siempre coincidan.
-- - Después de abrirla no cambian el tipo, el número ni el titular.
-- - Solo se inactiva con saldo cero y solo se reactiva si el cliente está activo.
-- - Función abrir_cuenta: apertura completa en un solo paso atómico.
-- No elimina ni modifica filas existentes.
-- =====================================================================

-- ---------- Secuencias por tipo ----------

create sequence if not exists public.cuentas_consecutivo_ahorros as bigint minvalue 1 maxvalue 99999999 no cycle;
create sequence if not exists public.cuentas_consecutivo_corriente as bigint minvalue 1 maxvalue 99999999 no cycle;
create sequence if not exists public.cuentas_consecutivo_nomina as bigint minvalue 1 maxvalue 99999999 no cycle;

revoke all on sequence public.cuentas_consecutivo_ahorros, public.cuentas_consecutivo_corriente, public.cuentas_consecutivo_nomina
  from public, anon, authenticated;

create or replace function public.generar_numero_cuenta(p_tipo text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_prefijo text;
  v_consecutivo bigint;
begin
  case p_tipo
    when 'Ahorros' then
      v_prefijo := '10';
      v_consecutivo := nextval('public.cuentas_consecutivo_ahorros');
    when 'Corriente' then
      v_prefijo := '20';
      v_consecutivo := nextval('public.cuentas_consecutivo_corriente');
    when 'Nomina' then
      v_prefijo := '30';
      v_consecutivo := nextval('public.cuentas_consecutivo_nomina');
    else
      raise exception using errcode = 'NB400', message = 'Tipo de cuenta no válido.';
  end case;
  return v_prefijo || lpad(v_consecutivo::text, 8, '0');
end;
$$;

-- ---------- Formato del número ----------

alter table public.cuentas
  drop constraint if exists cuentas_numero_formato;
alter table public.cuentas
  add constraint cuentas_numero_formato check (
    (tipo_cuenta = 'Ahorros' and numero_cuenta ~ '^10[0-9]{8}$')
    or (tipo_cuenta = 'Corriente' and numero_cuenta ~ '^20[0-9]{8}$')
    or (tipo_cuenta = 'Nomina' and numero_cuenta ~ '^30[0-9]{8}$')
  );

-- ---------- Reglas al crear una cuenta ----------

create or replace function public.preparar_nueva_cuenta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.clientes where id = new.cliente_id and estado = 'activo') then
    raise exception using errcode = 'NB409', message = 'No se puede crear una cuenta para un cliente inactivo o inexistente.';
  end if;
  if new.saldo <> 0 then
    raise exception using errcode = 'NB400', message = 'Una cuenta nueva empieza con saldo cero; el saldo inicial se registra como depósito.';
  end if;
  -- El número siempre lo asigna el sistema.
  new.numero_cuenta := public.generar_numero_cuenta(new.tipo_cuenta);
  return new;
end;
$$;

create or replace trigger cuentas_preparar_nueva
  before insert on public.cuentas
  for each row execute function public.preparar_nueva_cuenta();

-- ---------- Reglas al modificar una cuenta ----------

create or replace function public.validar_cambios_cuenta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tipo_cuenta is distinct from old.tipo_cuenta then
    raise exception using errcode = 'NB409', message = 'El tipo de cuenta no se puede cambiar después de abrirla.';
  end if;
  if new.numero_cuenta is distinct from old.numero_cuenta then
    raise exception using errcode = 'NB409', message = 'El número de cuenta no se puede cambiar.';
  end if;
  if new.cliente_id is distinct from old.cliente_id then
    raise exception using errcode = 'NB409', message = 'El titular de la cuenta no se puede cambiar.';
  end if;
  if old.estado = 'activo' and new.estado = 'inactivo' and new.saldo <> 0 then
    raise exception using errcode = 'NB409', message = 'La cuenta no puede inactivarse porque su saldo no es cero.';
  end if;
  if old.estado = 'inactivo' and new.estado = 'activo'
     and not exists (select 1 from public.clientes where id = new.cliente_id and estado = 'activo') then
    raise exception using errcode = 'NB409', message = 'No se puede activar la cuenta porque el cliente está inactivo. Activa primero el cliente.';
  end if;
  return new;
end;
$$;

create or replace trigger cuentas_validar_cambios
  before update on public.cuentas
  for each row execute function public.validar_cambios_cuenta();

-- ---------- Apertura completa ----------

create or replace function public.abrir_cuenta(
  p_cliente_id integer,
  p_tipo text,
  p_saldo_inicial bigint,
  p_operador_id uuid
)
returns public.cuentas
language plpgsql
set search_path = ''
as $$
declare
  v_cuenta public.cuentas%rowtype;
  v_estado_cliente text;
begin
  if p_operador_id is null or not exists (
    select 1 from public.perfiles where id = p_operador_id and activo and rol = 'administrador'
  ) then
    raise exception using errcode = 'NB403', message = 'Solo un administrador puede abrir cuentas.';
  end if;
  if p_saldo_inicial is null or p_saldo_inicial < 0 then
    raise exception using errcode = 'NB400', message = 'El saldo inicial no puede ser negativo.';
  end if;

  -- Bloquea al cliente para que no lo inactiven mientras se abre la cuenta.
  select estado into v_estado_cliente from public.clientes where id = p_cliente_id for share;
  if not found then
    raise exception using errcode = 'NB404', message = 'El cliente titular no existe.';
  end if;
  if v_estado_cliente <> 'activo' then
    raise exception using errcode = 'NB409', message = 'No se puede crear una cuenta para un cliente inactivo.';
  end if;

  insert into public.cuentas (cliente_id, tipo_cuenta)
  values (p_cliente_id, p_tipo)
  returning * into v_cuenta;

  if p_saldo_inicial > 0 then
    perform public.registrar_movimiento(
      'deposito', v_cuenta.id, p_saldo_inicial, 'Saldo inicial registrado', p_operador_id, gen_random_uuid()
    );
    select * into v_cuenta from public.cuentas where id = v_cuenta.id;
  end if;

  return v_cuenta;
end;
$$;

revoke execute on function public.generar_numero_cuenta(text) from public, anon, authenticated;
revoke execute on function public.preparar_nueva_cuenta() from public, anon, authenticated;
revoke execute on function public.validar_cambios_cuenta() from public, anon, authenticated;
revoke execute on function public.abrir_cuenta(integer, text, bigint, uuid) from public, anon, authenticated;
