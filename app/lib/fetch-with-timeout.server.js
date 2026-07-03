/**
 * fetch() with an AbortController-based timeout.
 * Shared by mcp-client.js (MCP JSON-RPC calls) and chat.jsx (customer-account
 * well-known discovery calls) so a slow/unreachable host surfaces as a clear
 * timeout error instead of hanging the request indefinitely.
 * @param {string} url - The URL to fetch
 * @param {RequestInit} [options] - Standard fetch options (method, headers, body, ...)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>} The fetch response
 * @throws {Error} A descriptive timeout error if the request is aborted, or
 *   the original error for any other fetch failure
 */
export async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      const method = options?.method || "GET";
      const timeoutError = new Error(`Request to ${url} (${method}) timed out after ${timeoutMs}ms`);
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
