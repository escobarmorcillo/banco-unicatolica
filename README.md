# NovaBank

NovaBank permite gestionar clientes, cuentas y transacciones bancarias. La interfaz sigue los mockups de NovaBank y se adapta a pantallas pequeñas.

## Requisitos

- Node.js 18+
- npm

## Instalación y ejecución

```bash
npm install
npm start
```

Abre `http://localhost:3000`. Sin configuración adicional, la aplicación usa SQLite y guarda los datos en `db/novabank.db`.

## Usar Supabase

1. Crea un proyecto en Supabase.
2. En el SQL Editor del proyecto, ejecuta [`supabase/migrations/20261017000000_create_novabank_schema.sql`](./supabase/migrations/20261017000000_create_novabank_schema.sql).
3. En **Database Settings → SSL Configuration**, descarga el certificado CA de producción de Supabase y guárdalo como `supabase-ca.crt` en la raíz del proyecto.
4. Copia `.env.example` como `.env` y configura `SUPABASE_DB_URL` con la cadena de conexión PostgreSQL del proyecto. Usa la URI del pooler en modo transacción, conserva el certificado CA indicado por `SUPABASE_DB_CA_CERT` y no desactives la validación TLS.
5. Reinicia NovaBank. Cuando `SUPABASE_DB_URL` está definida, el servidor usa Supabase; si no, mantiene SQLite.

La cadena de conexión contiene la contraseña de la base de datos: guárdala solo en el `.env` local o en el gestor de secretos del entorno de despliegue. No la incluyas en el frontend ni en el repositorio. El `.env` está excluido por `.gitignore`.

Las tablas guardan los saldos y montos en centavos de COP, conservan el historial de movimientos y aplican claves foráneas y restricciones de integridad. RLS está habilitado en las tres tablas; NovaBank accede desde el servidor mediante la conexión PostgreSQL, no desde el navegador.

## Funcionalidades

- Registro, consulta, actualización e inactivación de clientes.
- Creación, consulta, actualización e inactivación de cuentas.
- Depósitos y retiros con validación del saldo y registro de historial.
- Persistencia local en SQLite o remota en Supabase PostgreSQL.

## Estructura

- `server.js`: API REST y acceso a SQLite/Supabase.
- `public/index.html`: interfaz.
- `public/styles/styles.css`: estilos.
- `public/scripts/app.js`: navegación, formularios y consultas.
- `supabase/migrations/`: esquema PostgreSQL para Supabase.
- `db/novabank.db`: base local SQLite, creada al iniciar.

## Variables de entorno

- `PORT`: puerto HTTP (por defecto `3000`).
- `SUPABASE_DB_URL`: conexión PostgreSQL de Supabase; si se omite, se usa SQLite.
- `SUPABASE_DB_CA_CERT`: ruta al certificado CA de Supabase (por defecto `./supabase-ca.crt`).
