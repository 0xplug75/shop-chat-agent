const PORT_METHODS = Object.freeze({
  catalog: ["search"],
  decision: ["decide"],
  experience: ["authorize"],
  commerce: ["prepare", "confirm"],
  projection: ["fromDecision", "fromAction", "fromCommerce"],
  observability: ["record"],
});

export function createSageIntegrationPorts(ports) {
  for (const [name, methods] of Object.entries(PORT_METHODS)) {
    const port = ports?.[name];
    if (!port) throw new Error(`Sage integration requires the ${name} port`);
    for (const method of methods) {
      if (typeof port[method] !== "function") {
        throw new Error(`Sage ${name} port is missing ${method}()`);
      }
    }
  }
  return Object.freeze({ ...ports });
}

export function createNoopSageObservabilityPort() {
  return Object.freeze({
    async record() {},
  });
}
