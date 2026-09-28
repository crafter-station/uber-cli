export type GraphicsProtocol = "iterm" | "kitty" | null;

const ITERM_TERMINALS = new Set(["iTerm.app", "WezTerm", "WarpTerminal", "vscode"]);

export function graphicsProtocol(env: NodeJS.ProcessEnv = process.env): GraphicsProtocol {
  if (!process.stdout.isTTY || env.TMUX || env.TERM?.startsWith("screen")) return null;
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty" || env.GHOSTTY_RESOURCES_DIR || env.TERM === "xterm-ghostty") return "kitty";
  if (ITERM_TERMINALS.has(env.TERM_PROGRAM ?? "") || env.LC_TERMINAL === "iTerm2") return "iterm";
  return null;
}

export function inlineImage(bytes: Uint8Array, options: { cols: number; protocol: Exclude<GraphicsProtocol, null> }): string {
  const data = Buffer.from(bytes).toString("base64");
  if (options.protocol === "iterm") {
    return `\u001b]1337;File=inline=1;size=${bytes.byteLength};width=${options.cols};preserveAspectRatio=1:${data}\u0007`;
  }
  const chunks = data.match(/.{1,4096}/g) ?? [];
  return chunks
    .map((chunk, index) => {
      const more = index < chunks.length - 1 ? 1 : 0;
      const control = index === 0 ? `a=T,f=100,c=${options.cols},m=${more}` : `m=${more}`;
      return `\u001b_G${control};${chunk}\u001b\\`;
    })
    .join("");
}
