import { createLLMGateway } from "./llm-gateway.server";

/**
 * Compatibility entry point for older imports. New domain code depends on
 * the provider-neutral LLM gateway.
 */
export function createClaudeService(options = {}) {
  return createLLMGateway({ ...options, provider: "anthropic" });
}
