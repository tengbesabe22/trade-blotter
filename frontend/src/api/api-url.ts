// Vite supplies the origin at build time; leaving it unset keeps the local /api proxy.
export function apiUrl(path: string, origin: string = import.meta.env?.VITE_API_ORIGIN ?? '') {
  // Remove trailing slashes before appending /api.
  return `${origin.replace(/\/+$/, '')}/api${path}`;
}
