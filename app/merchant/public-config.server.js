export function toPublicMerchantConfig(config) {
  return {
    assistant: {
      name: config.assistant.name,
      welcomeMessage: config.assistant.welcomeMessage,
      quickActions: config.assistant.quickActions
    },
    widget: {
      position: config.widget.position,
      layout: config.widget.layout,
      colors: config.widget.colors,
      behavior: config.widget.behavior
    }
  };
}
