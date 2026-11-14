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
4. Define `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY` (ver `.env.example`, que indica dónde está cada una).
5. Ejecuta `npm start`, abre `http://localhost:3000` e inicia sesión.

`.env` y `supabase-ca.crt` no se suben a GitHub (están en `.gitignore`). Nunca compartas la contraseña ni la clave secreta, ni las incluyas en el frontend. La clave *publishable* sí es pública: el navegador la necesita para iniciar sesión.

## Usuarios y roles

El inicio de sesión usa **Supabase Auth** (correo y contraseña). El registro público está desactivado: solo el administrador crea usuarios.

| Rol | Puede |
|---|---|
| Administrador | Todo: clientes, cuentas, transacciones y usuarios |
| Cajero | Consultar clientes, cuentas e historial; registrar depósitos y retiros |
| Cliente | Ver solo sus cuentas, saldos, movimientos y datos personales |

Los permisos se validan en tres capas: la interfaz oculta lo que no corresponde, el servidor rechaza la petición (401 sin sesión, 403 sin permiso) y Supabase aplica RLS.

### Crear el primer administrador

1. Supabase → **Authentication → Users → Add user → Create new user**: correo y contraseña, con **Auto Confirm User** marcado.
2. En el **SQL Editor**, asigna el rol (cambia el correo y el nombre):

```sql
insert into public.perfiles (id, rol, nombre_completo)
select id, 'administrador', 'Nombre del administrador'
from auth.users where email = 'admin@ejemplo.com';
```

Los demás usuarios (cajeros y clientes) se crean desde la app, en **Usuarios**. Un usuario cliente se vincula a un cliente ya registrado mediante su documento.

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
| `20261113000800_operador_obligatorio.sql` | Toda operación nueva debe registrar el usuario que la hizo |
| `20261113000900_cuentas_apertura.sql` | Número de cuenta automático, apertura con `abrir_cuenta` y reglas de estado de cuentas |
| `20261113001000_clientes_reglas.sql` | Mayoría de edad, tipos y formatos de documento e integridad cliente–cuentas |

Los scripts no borran datos y pueden ejecutarse más de una vez.

### Reglas de clientes y cuentas

- **Clientes:** mayores de 18 años, con Cédula o Pasaporte (documento de 1 a 10 dígitos) y teléfono de 10 dígitos. Un cliente con cuentas activas no se puede inactivar, y un cliente inactivo no se puede editar hasta activarlo. Los clientes no se eliminan: se inactivan.
- **Número de cuenta:** lo asigna el sistema. Tiene 10 dígitos: el prefijo del tipo (`10` Ahorros, `20` Corriente, `30` Nómina) y un consecutivo de 8 dígitos por tipo. Ejemplo: `1000000001`.
- **Cuentas:** se abren con saldo cero y el saldo inicial queda registrado como un depósito. El número, el tipo y el titular no cambian después de la apertura. Una cuenta solo se inactiva con saldo cero y solo se reactiva si su cliente está activo.

Los saldos y montos se guardan en centavos de COP. Cada depósito o retiro se hace dentro de una función de PostgreSQL que bloquea la cuenta, valida el saldo, actualiza el saldo y registra el movimiento en un solo paso atómico. Si se reintenta una operación con el mismo identificador (`idempotency_key`), no se duplica.

## Pruebas

```bash
npm test
```

Las pruebas usan [PGlite](https://pglite.dev/), un PostgreSQL real en memoria con las mismas migraciones de Supabase. No necesitan conexión y no tocan la base real.

## Versión publicada

NovaBank se despliega en [Render](https://render.com) con la configuración de [`render.yaml`](./render.yaml). En el servicio de Render hay que configurar:

- **Environment → Secret Files**: subir el certificado con el nombre `supabase-ca.crt`.
- **Environment Variables**: `SUPABASE_DB_URL`, `SUPABASE_DB_CA_CERT=/etc/secrets/supabase-ca.crt`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY`.

## Estructura

- `server.js`: punto de entrada; carga `.env` y arranca el servidor.
- `src/app.js`: configuración de Express, rutas públicas y protegidas, archivos estáticos y manejo de errores.
- `src/auth/`: verificación de la sesión (`verify-token.js`), roles y permisos (`middleware.js`) y creación de usuarios en Supabase Auth (`user-admin.js`).
- `src/routes/`: rutas de la API (`customers.js`, `accounts.js`, `transactions.js`, `users.js` y `me.js` para el usuario de la sesión).
- `src/database/`: conexión a Supabase PostgreSQL.
- `src/validation.js`: reglas de validación de clientes, cuentas y montos.
- `src/errors.js`: errores de negocio, respuestas 404 de la API y ocultamiento de errores internos.
- `public/`: interfaz. En `public/scripts/`: `auth.js` (inicio y cierre de sesión), `app.js` (clientes, cuentas y transacciones), `users.js` (usuarios) y `client-portal.js` (vista del cliente).
- `supabase/migrations/`: scripts SQL de la base de datos.
- `tests/`: pruebas por módulo (`autenticacion`, `clientes`, `cuentas`, `transacciones`, `base-de-datos`, `api`) y sus utilidades en `tests/helpers/`.

## Variables de entorno

- `PORT`: puerto HTTP (por defecto `3000`; Render lo define automáticamente).
- `SUPABASE_DB_URL`: conexión PostgreSQL de Supabase (obligatoria).
- `SUPABASE_DB_CA_CERT`: ruta al certificado CA de Supabase.
- `SUPABASE_URL`: URL del proyecto de Supabase.
- `SUPABASE_PUBLISHABLE_KEY`: clave pública para iniciar sesión desde el navegador.
- `SUPABASE_SECRET_KEY`: clave secreta, solo en el servidor; permite crear usuarios.
