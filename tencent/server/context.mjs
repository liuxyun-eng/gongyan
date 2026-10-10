import { AsyncLocalStorage } from 'node:async_hooks';
export const context = new AsyncLocalStorage();
export async function headers() {
  const current = context.getStore();
  if (!current) throw new Error('No request context');
  return current.request.headers;
}
export function redirect(location) { throw new Error('Unexpected server redirect: ' + location); }
