/**
 * HTTP helpers for tests: run the Express app on an ephemeral port and call it with fetch.
 */
import app from '../../src/app.js';

/**
 * Starts the app on a random free port.
 *
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>} Base URL (ending in /api) and a close function.
 */
export function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}/api`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/**
 * Sends a JSON request and parses the JSON response.
 *
 * @param {string} url - Full request URL.
 * @param {{ method?: string, body?: unknown, token?: string, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number, headers: Headers, body: any }>} Status, headers and parsed body (null if empty).
 */
export async function request(url, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}
