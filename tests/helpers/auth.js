// Sesiones de prueba: se firman con una clave propia de las pruebas (ES256,
// igual que Supabase) y la app las verifica con su clave pública.
const { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } = require('jose');
const { createTokenVerifier } = require('../../src/auth/verify-token');

const ISSUER = 'https://pruebas.supabase.co/auth/v1';

async function createTestAuth() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'clave-pruebas', alg: 'ES256' };
  const verifyToken = createTokenVerifier({ jwks: createLocalJWKSet({ keys: [jwk] }), issuer: ISSUER });

  async function sign(userId, { expiresIn = '1h', issuer = ISSUER, key = privateKey } = {}) {
    return new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'clave-pruebas' })
      .setSubject(userId)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(key);
  }

  return { verifyToken, sign };
}

// Crea un usuario en auth.users y su perfil, como lo haría la app con Supabase.
async function createUser(db, { rol, clienteId = null, email, activo = true }) {
  const [user] = await db.query('INSERT INTO auth.users (email) VALUES ($1) RETURNING id', [email || `${rol}-${Date.now()}-${Math.random()}@test.co`]);
  await db.query(
    'INSERT INTO public.perfiles (id, rol, nombre_completo, cliente_id, activo) VALUES ($1, $2, $3, $4, $5)',
    [user.id, rol, `Usuario ${rol}`, clienteId, activo]
  );
  return user.id;
}

// Sustituye a Supabase Auth en las pruebas de creación de usuarios.
function createTestUserAdmin(db) {
  return {
    async createUser({ email }) {
      const existing = await db.query('SELECT id FROM auth.users WHERE email = $1', [email]);
      if (existing.length) throw new Error('A user with this email address has already been registered');
      const [user] = await db.query('INSERT INTO auth.users (email) VALUES ($1) RETURNING id', [email]);
      return { id: user.id };
    },
    async deleteUser(id) {
      await db.query('DELETE FROM auth.users WHERE id = $1', [id]);
    },
  };
}

module.exports = { createTestAuth, createUser, createTestUserAdmin };
