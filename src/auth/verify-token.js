const { createRemoteJWKSet, jwtVerify, errors } = require('jose');

// Verifica el token de sesión emitido por Supabase Auth con sus claves públicas
// (JWKS). No necesita secretos: solo comprueba la firma, el emisor, la
// audiencia y la fecha de expiración.
function createTokenVerifier({ jwks, issuer }) {
  return async function verifyToken(token) {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
    return payload;
  };
}

function createSupabaseTokenVerifier(supabaseUrl = process.env.SUPABASE_URL) {
  if (!supabaseUrl) {
    throw new Error('Falta SUPABASE_URL en .env (Supabase → Project Settings → Data API → Project URL).');
  }
  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  return createTokenVerifier({
    jwks: createRemoteJWKSet(new URL(`${baseUrl}/auth/v1/.well-known/jwks.json`)),
    issuer: `${baseUrl}/auth/v1`,
  });
}

const isExpiredError = (error) => error instanceof errors.JWTExpired;

module.exports = { createTokenVerifier, createSupabaseTokenVerifier, isExpiredError };
