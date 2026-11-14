# NovaBank

NovaBank permite gestionar clientes, cuentas y transacciones bancarias. La interfaz sigue los mockups de NovaBank y se adapta a pantallas pequeñas.

## Descargar y usar (equipo)

### Requisitos

- [Node.js](https://nodejs.org/) 18 o superior (incluye npm).
- [Git](https://git-scm.com/).

### Primera vez

```bash
git clone https://github.com/escobarmorcillo/banco-unicatolica.git
cd banco-unicatolica
npm install
npm start
```

Abre `http://localhost:3000`. No hace falta crear `.env`: sin configuración, NovaBank usa SQLite local.

> Si ya tenías el repositorio clonado antes del 6 de noviembre de 2026, el historial se reescribió. Borra tu carpeta antigua y vuelve a clonar; `git pull` fallará.

### Actualizar a la última versión

```bash
git pull
npm install
npm start
```

### Problemas comunes

- **`EADDRINUSE: address already in use :::3000`**: ya hay otro NovaBank (u otra app) usando el puerto 3000. Ciérralo con `Ctrl + C` en su terminal, o crea un `.env` con `PORT=3001`.
- **Error al instalar `sqlite3`**: usa una versión LTS de Node.js y vuelve a ejecutar `npm install`.

## ¿Dónde están los datos?

Con SQLite, los datos se guardan en `db/novabank.db`, **en el equipo de cada persona**. Ese archivo no se sube a GitHub (`db/` está en `.gitignore`), así que:

- Cada integrante tiene su propia base de datos, que empieza vacía.
- Hacer `git pull` actualiza el código, pero **no toca** los datos locales.
- Los clientes que crea una persona no los ve otra.

Para compartir los mismos datos entre todos hay que usar Supabase (ver abajo).

## Versión publicada

NovaBank se despliega en [Render](https://render.com) con la configuración de [`render.yaml`](./render.yaml). Cada push a `main` publica una versión nueva automáticamente.

En el plan gratuito, el disco de Render es temporal: **los datos de SQLite se borran** cada vez que el servicio se reinicia o se despliega, y el servicio se suspende tras 15 minutos sin visitas (la primera carga después tarda ~1 minuto). Para datos permanentes, conecta Supabase.

La aplicación no tiene inicio de sesión: cualquiera con el enlace puede crear y modificar registros. Úsala solo con datos de prueba.

### Publicar por primera vez

1. Entra en [render.com](https://render.com) e inicia sesión con GitHub.
2. **New → Blueprint** y elige el repositorio `banco-unicatolica`.
3. Render detecta `render.yaml`; pulsa **Apply**.
4. Al terminar, la URL pública aparece en el panel del servicio (`https://novabank-xxxx.onrender.com`).

## Usar Supabase

1. Crea un proyecto en Supabase.
2. En el SQL Editor del proyecto, ejecuta [`supabase/migrations/20261017000000_create_novabank_schema.sql`](./supabase/migrations/20261017000000_create_novabank_schema.sql).
3. En **Database Settings → SSL Configuration**, descarga el certificado CA de producción de Supabase.
4. Configura las variables:
   - **En local:** guarda el certificado como `supabase-ca.crt` en la raíz del proyecto, copia `.env.example` como `.env` y define `SUPABASE_DB_URL` con la URI del pooler en modo transacción.
   - **En Render:** en el servicio, **Environment → Secret Files**, sube el certificado con el nombre `supabase-ca.crt`; luego añade las variables `SUPABASE_DB_URL` y `SUPABASE_DB_CA_CERT=/etc/secrets/supabase-ca.crt`.
5. Reinicia NovaBank. Cuando `SUPABASE_DB_URL` está definida, el servidor usa Supabase; si no, mantiene SQLite. No desactives la validación TLS.

La cadena de conexión contiene la contraseña de la base de datos: guárdala solo en el `.env` local o en las variables de entorno de Render. No la incluyas en el frontend ni en el repositorio.

Las tablas guardan los saldos y montos en centavos de COP, conservan el historial de movimientos y aplican claves foráneas y restricciones de integridad. RLS está habilitado en las tres tablas; NovaBank accede desde el servidor mediante la conexión PostgreSQL, no desde el navegador.

## Funcionalidades

- Registro, consulta, actualización, inactivación y reactivación de clientes.
- Creación, consulta, actualización, inactivación y reactivación de cuentas (una cuenta solo se reactiva si su cliente está activo).
- Depósitos y retiros con validación del saldo y registro de historial.
- Persistencia local en SQLite o remota en Supabase PostgreSQL.

## Estructura

- `server.js`: punto de entrada; carga `.env` y arranca el servidor.
- `src/app.js`: configuración de Express, rutas, archivos estáticos y manejo de errores.
- `src/routes/`: rutas de la API (`customers.js`, `accounts.js`, `transactions.js`).
- `src/database/`: conexión a SQLite (`sqlite.js`) o Supabase (`postgres.js`) y utilidades de consulta (`index.js`).
- `src/validation.js`: reglas de validación de clientes, cuentas y montos.
- `src/errors.js`: errores de negocio, respuestas 404 de la API y ocultamiento de errores internos.
- `public/index.html`: interfaz.
- `public/styles/styles.css`: estilos.
- `public/scripts/app.js`: navegación, formularios y consultas.
- `supabase/migrations/`: esquema PostgreSQL para Supabase.
- `render.yaml`: configuración de despliegue en Render.
- `tests/`: pruebas (`npm test`).
- `db/novabank.db`: base local SQLite, creada al iniciar.

## Variables de entorno

- `PORT`: puerto HTTP (por defecto `3000`; Render lo define automáticamente).
- `SUPABASE_DB_URL`: conexión PostgreSQL de Supabase; si se omite, se usa SQLite.
- `SUPABASE_DB_CA_CERT`: ruta al certificado CA de Supabase (por defecto `./supabase-ca.crt`).
