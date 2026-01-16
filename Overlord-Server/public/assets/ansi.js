import AnsiToHtml from "https://cdn.jsdelivr.net/npm/ansi-to-html@0.7.2/+esm";

const converter = new AnsiToHtml({ newline: true, escapeHtml: true });

export function ansiToHtml(input = "") {
  return converter.toHtml(input);
}
