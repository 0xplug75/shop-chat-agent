export function toPublicMerchantConfig(config, { experimentAssignment } = {}) {
  const contextualSuggestion = Boolean(
    config.shopping.featureFlags.contextualLauncher &&
    experimentAssignment?.variant === "contextual",
  );

  return {
    assistant: {
      name: config.assistant.name,
      welcomeMessage: config.assistant.welcomeMessage,
      quickActions: config.assistant.quickActions,
    },
    widget: {
      position: config.widget.position,
      layout: config.widget.layout,
      colors: config.widget.colors,
      behavior: {
        ...config.widget.behavior,
        contextualSuggestion,
      },
    },
    experiment: experimentAssignment
      ? {
          key: experimentAssignment.experimentKey,
          variant: experimentAssignment.variant,
        }
      : null,
  };
}
