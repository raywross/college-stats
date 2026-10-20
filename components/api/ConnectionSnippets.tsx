import { connectionSnippets } from "@/lib/api-snippets";
import { CodeBlock } from "./CodeBlock";

/**
 * The three ways to connect, for `origin` and `apiKey` (the person's real key on /account/api-keys, the `quad_…`
 * placeholder on /developers): curl, Claude Code, and the mcpServers entry for Claude Desktop and Cursor.
 */
export function ConnectionSnippets({ origin, apiKey }: { origin: string; apiKey: string }) {
  const s = connectionSnippets(origin, apiKey);
  return (
    <div className="space-y-3">
      <CodeBlock title="curl" hint="One request from a terminal." code={s.curl} />
      <CodeBlock title="Claude Code" hint="Run once in a terminal." code={s.claudeCode} />
      <CodeBlock title="Claude Desktop and Cursor" hint="Add to the mcpServers section of the app's MCP settings. Needs Node.js." code={s.mcpJson} />
    </div>
  );
}
