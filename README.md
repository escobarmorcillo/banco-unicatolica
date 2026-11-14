# NovaBank

NovaBank es una plataforma bancaria de simulación para gestionar clientes, cuentas y transacciones (depósitos y retiros). Las operaciones son simuladas: no mueven dinero real. La interfaz sigue los mockups de NovaBank y se adapta a pantallas pequeñas.

## Requisitos

- [Node.js](https://nodejs.org/) 22 o superior (incluye npm).
- [Git](https://git-scm.com/).
- Acceso al proyecto de Supabase (la contraseña de la base de datos).

## Primera vez

```bash
git clone https://github.com/escobarmorcillo/banco-unicatolica.git
cd banco-unicatolica
npm install
```

1. Copia `.env.example` como `.env`.
2. En `.env`, define `SUPABASE_DB_URL` con la URI del **Transaction pooler** (Supabase → botón **Connect**) y reemplaza `[YOUR-PASSWORD]` por la contraseña, sin corchetes.
3. Descarga el certificado CA (Supabase → **Database → Settings → SSL Configuration**) y guárdalo como `supabase-ca.crt` en la raíz del proyecto.
4. Ejecuta `npm start` y abre `http://localhost:3000`.

`.env` y `supabase-ca.crt` no se suben a GitHub (están en `.gitignore`). Nunca compartas la contraseña ni la incluyas en el frontend.

### Problemas comunes

- **`Falta SUPABASE_DB_URL`**: no existe `.env` o la variable está comentada con `#`.
- **`password authentication failed`**: la contraseña de `.env` no es la actual de Supabase.
- **`EADDRINUSE: address already in use`**: el puerto está ocupado. Cierra la otra app o cambia `PORT` en `.env`.

## Base de datos (Supabase)

Los scripts están en [`supabase/migrations/`](./supabase/migrations), un archivo por tabla o tema, y se ejecutan **en orden** en el SQL Editor de Supabase:

| Archivo | Contenido |
|---|---|
| `20261017000000_create_novabank_schema.sql` | Tablas iniciales: clientes, cuentas, transacciones |
| `20261113000100_funciones_comunes.sql` | Función que mantiene `fecha_actualizacion` |
| `20261113000200_clientes.sql` | `fecha_nacimiento` como fecha |
| `20261113000300_perfiles.sql` | Usuarios y roles (administrador, cajero, cliente) |
| `20261113000400_cuentas.sql` | El saldo solo cambia con depósitos o retiros |
| `20261113000500_transacciones.sql` | Operador, identificador contra reintentos, coherencia de saldos e historial inmodificable |
| `20261113000600_operaciones.sql` | Funciones `realizar_deposito` y `realizar_retiro` |
| `20261113000700_seguridad_rls.sql` | Permisos y políticas RLS |

Los scripts no borran datos y pueden ejecutarse más de una vez.

Los saldos y montos se guardan en centavos de COP. Cada depósito o retiro se hace dentro de una función de PostgreSQL que bloquea la cuenta, valida el saldo, actualiza el saldo y registra el movimiento en un solo paso atómico. Si se reintenta una operación con el mismo identificador (`idempotency_key`), no se duplica.

## Pruebas

```bash
npm test
```

Las pruebas usan [PGlite](https://pglite.dev/), un PostgreSQL real en memoria con las mismas migraciones de Supabase. No necesitan conexión y no tocan la base real.

## Versión publicada

NovaBank se despliega en [Render](https://render.com) con la configuración de [`render.yaml`](./render.yaml). En el servicio de Render hay que configurar:

- **Environment → Secret Files**: subir el certificado con el nombre `supabase-ca.crt`.
- **Environment Variables**: `SUPABASE_DB_URL` y `SUPABASE_DB_CA_CERT=/etc/secrets/supabase-ca.crt`.

La aplicación todavía no tiene inicio de sesión (llega en la Fase 3): úsala solo con datos de prueba.

## Estructura

- `server.js`: punto de entrada; carga `.env` y arranca el servidor.
- `src/app.js`: configuración de Express, rutas, archivos estáticos y manejo de errores.
- `src/routes/`: rutas de la API (`customers.js`, `accounts.js`, `transactions.js`).
- `src/database/`: conexión a Supabase PostgreSQL.
- `src/validation.js`: reglas de validación de clientes, cuentas y montos.
- `src/errors.js`: errores de negocio, respuestas 404 de la API y ocultamiento de errores internos.
- `public/`: interfaz (HTML, CSS y JavaScript).
- `supabase/migrations/`: scripts SQL de la base de datos.
- `tests/`: pruebas por módulo (`clientes`, `cuentas`, `transacciones`, `base-de-datos`, `api`) y sus utilidades en `tests/helpers/`.

## Variables de entorno

- `PORT`: puerto HTTP (por defecto `3000`; Render lo define automáticamente).
- `SUPABASE_DB_URL`: conexión PostgreSQL de Supabase (obligatoria).
- `SUPABASE_DB_CA_CERT`: ruta al certificado CA de Supabase.
