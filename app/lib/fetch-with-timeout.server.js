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
      const timeoutError = new Error("External request timed out");
      timeoutError.code = "EXTERNAL_TIMEOUT";
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function readJsonResponseWithLimit(response, maxBytes = 1_000_000) {
  if (!response.body) return null;
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw responseTooLargeError();

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (!complete) {
      const { done, value } = await reader.read();
      complete = done;
      if (complete) break;
      size += value.byteLength;
      if (size > maxBytes) throw responseTooLargeError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function responseTooLargeError() {
  const error = new Error("External response is too large");
  error.code = "EXTERNAL_RESPONSE_TOO_LARGE";
  error.status = 502;
  return error;
}
