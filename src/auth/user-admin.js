const { createClient } = require('@supabase/supabase-js');

// Crea y elimina usuarios en Supabase Auth. Usa la clave SECRETA, por eso
// solo existe en el servidor y nunca se envía al navegador.
// Interfaz: createUser({ email, password }) -> { id } · deleteUser(id)
function createSupabaseUserAdmin({
  supabaseUrl = process.env.SUPABASE_URL,
  secretKey = process.env.SUPABASE_SECRET_KEY,
} = {}) {
  if (!supabaseUrl || !secretKey) {
    // Sin clave secreta la app funciona, pero no puede crear usuarios.
    return null;
  }
  const client = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async createUser({ email, password }) {
      const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) {
        const wrapped = new Error(error.message);
        wrapped.authCode = error.code;
        throw wrapped;
      }
      return { id: data.user.id };
    },
    async deleteUser(id) {
      const { error } = await client.auth.admin.deleteUser(id);
      if (error) throw new Error(error.message);
    },
  };
}

module.exports = { createSupabaseUserAdmin };
