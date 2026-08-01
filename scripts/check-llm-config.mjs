/* eslint-env node */
import { createProviderRegistry } from "../app/services/llm/provider-registry.server.js";

const registry = createProviderRegistry();
const primary = registry.resolvePrimaryId();
const adapter = registry.create(primary);

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    primary: adapter.id,
    model: adapter.model,
    configuredProviders: registry.configuredProviders(),
    networkCallPerformed: false,
  })}\n`,
);
