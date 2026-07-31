import { createLogger } from "../lib/logger.server";

/**
 * Creates a StreamManager to handle SSE streams with proper backpressure
 * @param {TextEncoder} encoder - A TextEncoder instance
 * @param {ReadableStreamDefaultController} controller - The stream controller
 * @returns {Object} StreamManager with utility methods for handling streaming
 */
export function createStreamManager(encoder, controller, logger = createLogger()) {
  /**
   * Send a data message to the client
   * @param {Object} data - Data to send
   */
  const sendMessage = (data) => {
    try {
      const text = `data: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(text));
    } catch (error) {
      logger.warn("SSE message could not be sent", { error });
    }
  };

  /**
   * Send an error message to the client
   * @param {Object} error - Error object
   * @param {string} error.type - Error type
   * @param {string} error.error - Error title/message
   * @param {string} error.details - Error details
   */
  const sendError = ({ type, error, details }) => {
    sendMessage({ type, error, details });
  };

  /**
   * Close the stream
   */
  const closeStream = () => {
    try {
      controller.close();
    } catch (error) {
      logger.debug("SSE stream was already closed", { error });
    }
  };

  /**
   * Handle streaming errors by sending appropriate error messages
   * @param {Error} error - The error that occurred
   */
  const handleStreamingError = (error) => {
    logger.error("SSE stream failed", { error });

    if (error?.status === 429 || error?.status === 529) {
      sendError({
        type: "rate_limit_exceeded",
        error: "The shopping assistant is busy. Please try again shortly."
      });
    } else {
      sendError({
        type: "error",
        error: "The shopping assistant is temporarily unavailable."
      });
    }
  };

  return {
    sendMessage,
    sendError,
    closeStream,
    handleStreamingError
  };
}

/**
 * Creates a ReadableStream for SSE
 * @param {Function} streamHandler - Async function that handles the stream
 * @returns {ReadableStream} A readable stream for SSE
 */
export function createSseStream(streamHandler, { logger = createLogger() } = {}) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const streamManager = createStreamManager(encoder, controller, logger);

      try {
        await streamHandler(streamManager);
      } catch (error) {
        streamManager.handleStreamingError(error);
      } finally {
        streamManager.closeStream();
      }
    }
  });
}
