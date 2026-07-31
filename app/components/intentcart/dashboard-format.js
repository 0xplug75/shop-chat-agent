export function formatPolicy(value) {
  return titleCase(value.replaceAll("_", " "));
}

export function formatPosition(value) {
  return titleCase(value.replaceAll("-", " "));
}

export function formatLayout(value) {
  const labels = {
    bubble: "Compact button",
    "side-panel": "Floating assistant",
    inline: "Inline shopping block",
    fullscreen: "Full-screen shopping"
  };

  return labels[value] || titleCase(value.replaceAll("-", " "));
}

function titleCase(value) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
