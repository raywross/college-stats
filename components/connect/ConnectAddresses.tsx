"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The addresses on /connect that depend on where the site is running: the MCP endpoint, the skill download, the API
 * document, Claude's prefilled install link, and the CLI snippets (specs/product/assistants.md). Read from the
 * browser's own origin so a preview deploy hands out its own address; the server renders a path until it knows.
 */

const noSubscription = () => () => {};

export function useOrigin(): string {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => "",
  );
}

export function mcpUrl(origin: string): string {
  return `${origin}/mcp`;
}
export function skillUrl(origin: string): string {
  return `${origin}/connect/quad-skill.zip`;
}
export function openApiUrl(origin: string): string {
  return `${origin}/api/v1/openapi.json`;
}
/** Claude's documented prefilled dialog: the person still reviews and confirms. */
export function claudeInstallLink(origin: string): string {
  return `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Quad&connectorUrl=${encodeURIComponent(mcpUrl(origin))}`;
}
export function geminiCliConfig(origin: string): string {
  return JSON.stringify({ mcpServers: { quad: { httpUrl: mcpUrl(origin), trust: true } } }, null, 2);
}
export function antigravityConfig(origin: string): string {
  return JSON.stringify({ mcpServers: { quad: { serverUrl: mcpUrl(origin) } } }, null, 2);
}
export function geminiCliCommand(origin: string): string {
  return `gemini mcp add --transport http quad ${mcpUrl(origin)}`;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        const ok = await writeClipboard(text);
        setCopied(ok);
        if (ok) setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold hover:bg-muted"
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** A read-only one-line address with a Copy button. */
export function AddressField({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 font-mono text-[16px] sm:text-xs"
      />
      <CopyButton text={value} label={label} />
    </div>
  );
}

/** A multi-line snippet (a config file) with a Copy button. */
export function SnippetBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 pr-24 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap" style={{ position: "relative" }}>
        {value}
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={value} label={label} />
      </div>
    </div>
  );
}

/** The three addresses at the top of the page. */
export function QuadAddresses() {
  const origin = useOrigin();
  const o = origin || "";
  return (
    <dl className="grid gap-3">
      <div>
        <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase">MCP server</dt>
        <dd className="mt-1"><AddressField label="MCP server address" value={mcpUrl(o)} /></dd>
      </div>
      <div>
        <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Skill file (SKILL.md, zipped)</dt>
        <dd className="mt-1"><AddressField label="Skill download address" value={skillUrl(o)} /></dd>
      </div>
      <div>
        <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase">API document (OpenAPI)</dt>
        <dd className="mt-1"><AddressField label="OpenAPI document address" value={openApiUrl(o)} /></dd>
      </div>
    </dl>
  );
}

export function ClaudeInstallButton() {
  const origin = useOrigin();
  return (
    <a
      href={claudeInstallLink(origin)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
    >
      Add Quad to Claude
    </a>
  );
}

export function SkillDownloadButton({ children = "Download the Quad skill" }: { children?: React.ReactNode }) {
  const origin = useOrigin();
  return (
    <a href={skillUrl(origin)} className="inline-flex h-11 items-center gap-2 rounded-full border px-5 text-sm font-semibold hover:bg-muted">
      {children}
    </a>
  );
}

export function GeminiSnippets() {
  const origin = useOrigin();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Gemini CLI, one command:</p>
      <SnippetBlock label="Gemini CLI command" value={geminiCliCommand(origin)} />
      <p className="text-sm text-muted-foreground">
        Or in <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.gemini/settings.json</code>:
      </p>
      <SnippetBlock label="Gemini CLI settings" value={geminiCliConfig(origin)} />
      <p className="text-sm text-muted-foreground">
        Antigravity CLI, in <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.gemini/config/mcp_config.json</code>:
      </p>
      <SnippetBlock label="Antigravity settings" value={antigravityConfig(origin)} />
    </div>
  );
}

export function McpAddress() {
  const origin = useOrigin();
  return <AddressField label="MCP server address" value={mcpUrl(origin)} className="max-w-xl" />;
}
