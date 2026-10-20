// Las pruebas solo pueden usar una base local desechable: su nombre debe terminar en "_test" y nunca puede ser un host de Supabase.
export const forbiddenHostMessage = 'TEST_DATABASE_URL apunta a Supabase: las pruebas nunca se conectan a la base de producción.';

export const isForbiddenDatabaseUrl = (url: string) => /supabase\.co/i.test(url);

export const isUsableTestDatabaseUrl = (url: string | undefined): url is string => {
  if (!url) return false;
  if (isForbiddenDatabaseUrl(url)) throw new Error(forbiddenHostMessage);
  return /_test(\?.*)?$/.test(url);
};

const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Solo se puede llegar a la API que se prueba (en localhost); los proveedores de IA y los demás servicios deben simularse.
export const isLocalUrl = (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return localHosts.has(url.hostname);
};
