// Tests may only use a disposable local database: its name must end in "_test" and it can never be a Supabase host.
export const forbiddenHostMessage = 'TEST_DATABASE_URL apunta a Supabase: las pruebas nunca se conectan a la base de producción.';

export const isForbiddenDatabaseUrl = (url: string) => /supabase\.co/i.test(url);

export const isUsableTestDatabaseUrl = (url: string | undefined): url is string => {
  if (!url) return false;
  if (isForbiddenDatabaseUrl(url)) throw new Error(forbiddenHostMessage);
  return /_test(\?.*)?$/.test(url);
};

const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Only the API under test (on localhost) can be reached; AI providers and other services must be simulated.
export const isLocalUrl = (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return localHosts.has(url.hostname);
};
