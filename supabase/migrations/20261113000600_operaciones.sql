-- =====================================================================
-- Fase 2 · 06 · Funciones de depósito y retiro
-- Cada operación es atómica: valida, actualiza el saldo y registra el
-- movimiento en un solo paso. Si algo falla, no se guarda nada.
--
-- Concurrencia: la cuenta se bloquea (FOR UPDATE); las operaciones
-- simultáneas sobre la misma cuenta esperan su turno.
-- Reintentos: si llega otra vez la misma idempotency_key, se devuelve la
-- operación original sin repetirla.
--
-- Códigos de error (el backend los convierte en respuestas HTTP):
--   NB400 datos inválidos · NB403 sin permiso · NB404 no existe · NB409 conflicto
-- =====================================================================

create or replace function public.registrar_movimiento(
  p_tipo text,
  p_cuenta_id integer,
  p_monto bigint,
  p_descripcion text,
  p_operador_id uuid,
  p_idempotency_key uuid
)
returns public.transacciones
language plpgsql
set search_path = ''
as $$
declare
  v_cuenta public.cuentas%rowtype;
  v_existente public.transacciones%rowtype;
  v_resultado public.transacciones%rowtype;
  v_nuevo_saldo bigint;
begin
  if p_tipo is null or p_tipo not in ('deposito', 'retiro') then
    raise exception using errcode = 'NB400', message = 'Tipo de transacción no válido.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception using errcode = 'NB400', message = 'El monto debe ser mayor que cero.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = 'NB400', message = 'Falta el identificador único de la operación.';
  end if;

  -- Solo personal activo (administrador o cajero) puede operar.
  -- Mientras no exista inicio de sesión (Fase 3) el operador puede llegar vacío.
  if p_operador_id is not null and not exists (
    select 1 from public.perfiles
    where id = p_operador_id and activo and rol in ('administrador', 'cajero')
  ) then
    raise exception using errcode = 'NB403', message = 'El usuario no tiene permiso para realizar operaciones.';
  end if;

  -- Bloquea la cuenta hasta terminar la operación.
  select * into v_cuenta from public.cuentas where id = p_cuenta_id for update;
  if not found then
    raise exception using errcode = 'NB404', message = 'La cuenta no existe.';
  end if;

  -- Reintento de una operación ya registrada.
  select * into v_existente from public.transacciones where idempotency_key = p_idempotency_key;
  if found then
    if v_existente.cuenta_id <> p_cuenta_id
       or v_existente.tipo_transaccion <> p_tipo
       or v_existente.monto <> p_monto then
      raise exception using errcode = 'NB409', message = 'El identificador de la operación ya se usó con datos diferentes.';
    end if;
    return v_existente;
  end if;

  if v_cuenta.estado <> 'activo' then
    raise exception using errcode = 'NB409', message = 'No se puede operar sobre una cuenta inactiva.';
  end if;
  if p_tipo = 'retiro' and p_monto > v_cuenta.saldo then
    raise exception using errcode = 'NB400', message = 'El retiro excede el saldo disponible.';
  end if;

  v_nuevo_saldo := case when p_tipo = 'deposito' then v_cuenta.saldo + p_monto else v_cuenta.saldo - p_monto end;

  perform set_config('novabank.movimiento_autorizado', 'si', true);
  update public.cuentas set saldo = v_nuevo_saldo where id = p_cuenta_id;
  perform set_config('novabank.movimiento_autorizado', '', true);

  insert into public.transacciones (
    cuenta_id, tipo_transaccion, monto, saldo_anterior, saldo_resultante,
    descripcion, operador_id, idempotency_key
  )
  values (
    p_cuenta_id, p_tipo, p_monto, v_cuenta.saldo, v_nuevo_saldo,
    nullif(trim(p_descripcion), ''), p_operador_id, p_idempotency_key
  )
  returning * into v_resultado;

  return v_resultado;
end;
$$;

create or replace function public.realizar_deposito(
  p_cuenta_id integer,
  p_monto bigint,
  p_descripcion text,
  p_operador_id uuid,
  p_idempotency_key uuid
)
returns public.transacciones
language sql
set search_path = ''
as $$
  select * from public.registrar_movimiento('deposito', p_cuenta_id, p_monto, p_descripcion, p_operador_id, p_idempotency_key);
$$;

create or replace function public.realizar_retiro(
  p_cuenta_id integer,
  p_monto bigint,
  p_descripcion text,
  p_operador_id uuid,
  p_idempotency_key uuid
)
returns public.transacciones
language sql
set search_path = ''
as $$
  select * from public.registrar_movimiento('retiro', p_cuenta_id, p_monto, p_descripcion, p_operador_id, p_idempotency_key);
$$;

-- Solo el backend (conexión del servidor) puede ejecutar estas funciones;
-- nadie puede llamarlas desde el navegador con las claves públicas.
revoke execute on function public.registrar_movimiento(text, integer, bigint, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.realizar_deposito(integer, bigint, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.realizar_retiro(integer, bigint, text, uuid, uuid) from public, anon, authenticated;
