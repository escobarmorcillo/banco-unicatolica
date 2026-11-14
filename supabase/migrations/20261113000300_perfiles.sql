-- =====================================================================
-- Fase 2 · 03 · Tabla perfiles (usuarios y roles)
-- Une cada usuario de Supabase Auth (auth.users) con su rol en NovaBank.
-- Roles: administrador, cajero, cliente.
-- Un perfil con rol "cliente" debe estar vinculado a un registro de clientes;
-- los perfiles de personal (administrador, cajero) no se vinculan.
-- Tabla nueva: no modifica tablas existentes.
-- =====================================================================

create table if not exists public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  rol text not null check (rol in ('administrador', 'cajero', 'cliente')),
  nombre_completo text not null check (length(trim(nombre_completo)) >= 2),
  cliente_id integer unique references public.clientes (id) on delete restrict,
  activo boolean not null default true,
  fecha_creacion timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  constraint perfiles_cliente_vinculado check ((rol = 'cliente') = (cliente_id is not null))
);

create or replace trigger perfiles_fecha_actualizacion
  before update on public.perfiles
  for each row execute function public.actualizar_fecha_actualizacion();
