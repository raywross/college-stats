import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Bot, Code2, ExternalLink, Plug, ShieldCheck, Sparkles } from "lucide-react";
import { ClaudeInstallButton, GeminiSnippets, McpAddress, QuadAddresses, SkillDownloadButton } from "@/components/connect/ConnectAddresses";

export const metadata: Metadata = {
  title: "Connect Quad to ChatGPT, Claude, and Gemini",
  description: "Give your assistant Quad's cited college data: one address for ChatGPT, Claude, and Gemini, plus a skill file and an open API.",
};

/**
 * /connect (specs/product/assistants.md): how to add Quad to each assistant, in the order a family is likely to use
 * them, with the exact menu paths as of this writing and a note that menus move. The addresses are filled in from
 * the browser's own origin (components/connect/ConnectAddresses.tsx).
 */
export default function ConnectPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-10">
        <p className="mb-2 hidden text-xs font-bold tracking-[0.18em] text-primary uppercase sm:block">Connect</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          Use Quad in <span className="highlight">ChatGPT, Claude, and Gemini</span>
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Quad can answer your assistant&apos;s college questions with the same cited numbers you see here: admissions,
          test ranges, cost and aid, outcomes, students, and academics for about 1,900 four-year colleges, each value
          with its source and year. One address works for all three; the steps for each are below.
        </p>
        <nav aria-label="On this page" className="mt-5 flex flex-wrap gap-2">
          {[
            ["#addresses", "Your Quad addresses"],
            ["#claude", "Claude"],
            ["#chatgpt", "ChatGPT"],
            ["#gemini", "Gemini"],
            ["#what", "What your assistant can see"],
            ["#developers", "For developers"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold hover:border-primary hover:text-primary">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Section id="addresses" eyebrow="Start here" title="Your Quad addresses" icon={<Plug className="size-4" />}>
        <P>
          Every assistant asks for one of these. The <strong>MCP server</strong> is the live connection (the Model
          Context Protocol, the standard the three assistants share). The <strong>skill file</strong> teaches an
          assistant how to use Quad even without a connection, by reading the public pages. The{" "}
          <strong>API document</strong> is for developers.
        </P>
        <div className="max-w-2xl rounded-3xl border bg-card p-4 sm:p-5">
          <QuadAddresses />
        </div>
        <P>
          No key or sign-in is needed. The connection is read-only and public: it has no access to your Quad account,
          your list, or your plan ({" "}
          <a href="#what" className="font-semibold text-foreground underline-offset-2 hover:underline">
            what your assistant can see
          </a>
          ).
        </P>
      </Section>

      <Section id="claude" eyebrow="Claude" title="Add Quad to Claude" icon={<Sparkles className="size-4" />}>
        <Steps title="The connection (any plan, including Free)">
          <li>
            Press <ClaudeInstallButton /> (it opens Claude with the form filled in), or in Claude open{" "}
            <b>Customize → Connectors</b> and choose <b>+ Add → Add custom connector</b>.
          </li>
          <li>
            Name it <b>Quad</b>; for the <b>MCP server URL</b> paste <McpAddress />
          </li>
          <li>
            Press <b>Continue</b>. Under authentication pick <b>No sign-in</b> (Quad&apos;s connection is public), then{" "}
            <b>Add</b>.
          </li>
          <li>
            In a chat, press <b>+</b> and turn on <b>Quad</b> under Connectors. Ask &quot;what does Quad say about Emory&apos;s
            admit rate?&quot; and Claude will cite the source and year.
          </li>
        </Steps>
        <Steps title="The skill (so Claude knows how to use Quad well)">
          <li>
            <SkillDownloadButton /> to your computer; keep it zipped.
          </li>
          <li>
            In Claude, open <b>Settings → Capabilities</b> and turn on <b>Code execution and file creation</b> if it
            isn&apos;t already.
          </li>
          <li>
            Open <b>Customize → Skills</b>, press <b>+ → Create skill → Upload a skill</b>, choose the zip, then turn the
            skill on.
          </li>
        </Steps>
        <Note>
          On a Team or Enterprise plan an owner can add the connector once for everyone under <b>Organization
          settings → Connectors</b>, and publish the skill to the organization. Claude also runs on your computer as
          Claude Code; a skill turned on in Claude syncs into it.
        </Note>
      </Section>

      <Section id="chatgpt" eyebrow="ChatGPT" title="Add Quad to ChatGPT" icon={<Bot className="size-4" />}>
        <Steps title="The connection (Business, Enterprise, and Edu workspaces; Pro accounts read-only)">
          <li>
            In ChatGPT&apos;s sidebar open <b>Plugins</b>, press <b>+</b>, and choose <b>Add custom MCP server</b>.
          </li>
          <li>
            Name it <b>Quad</b>; for the connection choose a public endpoint and paste <McpAddress />
          </li>
          <li>
            Under <b>Authentication</b> choose <b>No authentication</b>, accept the notice about third-party servers,
            and press <b>Create</b>.
          </li>
          <li>
            In a workspace an owner or admin creates the plugin, then shares or publishes it so everyone can install
            it from <b>Plugins</b>.
          </li>
        </Steps>
        <Steps title="The skill (Business, Enterprise, and Edu workspaces)">
          <li>
            <SkillDownloadButton />
          </li>
          <li>
            Open <b>Plugins → Skills → Create</b> and choose <b>Upload</b>; pick the zip. It may show &quot;Needs review&quot; for
            a moment while ChatGPT scans it.
          </li>
        </Steps>
        <Note>
          On a personal Plus account, look in <b>Plugins</b> for the <b>+</b> button; if it isn&apos;t there, your plan
          doesn&apos;t yet allow custom servers. Custom GPTs are being retired by OpenAI and personal accounts can no longer
          create them, so Quad doesn&apos;t offer one. Quad&apos;s connection is also usable by ChatGPT&apos;s deep research, which
          needs the <code className="rounded bg-muted px-1 py-0.5 text-xs">search</code> and{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">fetch</code> tools Quad provides.
        </Note>
      </Section>

      <Section id="gemini" eyebrow="Gemini" title="Add Quad to Gemini" icon={<Sparkles className="size-4" />}>
        <Steps title="The connection (Google AI Pro and Ultra, in the U.S.)">
          <li>
            On the web, open <b>gemini.google.com → Settings → Connected apps</b> and choose <b>add custom app</b>.
          </li>
          <li>
            Paste the MCP server address: <McpAddress />
          </li>
          <li>
            Save. Quad then works in Gemini on the web and in the mobile app. This needs a personal Google account,
            age 18 or over, with Gemini Apps Activity on; it is part of Google&apos;s Spark features.
          </li>
        </Steps>
        <Steps title="The skill (free)">
          <li>
            <SkillDownloadButton />
          </li>
          <li>
            In Gemini open <b>Customize → Skills</b> and choose <b>Upload</b>; pick the zip. Type <b>/quad</b> in a chat
            to use it, or let Gemini pick it up on its own.
          </li>
        </Steps>
        <Steps title="A Gem (until Gems become skills)">
          <li>
            Open <b>Gems → New Gem</b>, name it <b>Quad</b>, and paste the text of the skill file (unzip it and open{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">SKILL.md</code>) as the instructions. Google is
            converting Gems into skills starting in November; yours will follow.
          </li>
        </Steps>
        <details className="rounded-2xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">For the command line (Gemini CLI, Antigravity CLI)</summary>
          <div className="mt-3">
            <GeminiSnippets />
          </div>
        </details>
      </Section>

      <Section id="what" eyebrow="Privacy" title="What your assistant can see, and can't" icon={<ShieldCheck className="size-4" />}>
        <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>
            <strong className="text-foreground">Can see:</strong> the public facts on every college page, the Compare
            table, Explore&apos;s filters, and the glossary, each value with its source and year. The same things a visitor
            sees without signing in.
          </li>
          <li>
            <strong className="text-foreground">Can&apos;t see:</strong> your account, your household, your student&apos;s
            numbers, lists, plans, visits, or notes. The connection has no sign-in, so there is nothing of yours for it
            to reach.
          </li>
          <li>
            <strong className="text-foreground">Won&apos;t say:</strong> a person&apos;s chances. Quad&apos;s estimate of where a
            student stands lives in the signed-in plan only; the connection and the skill both tell the assistant not
            to invent odds on Quad&apos;s behalf.
          </li>
          <li>
            <strong className="text-foreground">What Quad records:</strong> request counts per address, to keep the
            service fair (about sixty requests a minute each). Not the questions, and not who asked.
          </li>
        </ul>
        <P>
          Menus move. These steps match the three assistants as of this writing; each one&apos;s help pages have the
          current wording:{" "}
          <Ext href="https://support.claude.com">Claude</Ext>, <Ext href="https://help.openai.com">ChatGPT</Ext>,{" "}
          <Ext href="https://support.google.com/gemini">Gemini</Ext>.
        </P>
      </Section>

      <Section id="developers" eyebrow="For developers" title="The same data as plain JSON" icon={<Code2 className="size-4" />}>
        <P>
          The MCP server&apos;s tools are also plain GET endpoints, documented in the OpenAPI document above. No key; about
          sixty requests a minute per address; every response carries{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">X-Dataset-Publish</code> with the data&apos;s date.
        </P>
        <ul className="max-w-3xl space-y-1.5 font-mono text-xs text-muted-foreground">
          <li>GET /api/v1/colleges?q=emory</li>
          <li>GET /api/v1/colleges?states=GA,NC&amp;maxAR=40&amp;sortBy=net_price</li>
          <li>GET /api/v1/colleges/139658</li>
          <li>GET /api/v1/compare?ids=139658,199120</li>
          <li>GET /api/v1/glossary?term=acceptance-rate</li>
          <li>POST /mcp (JSON-RPC 2.0; tools: search, fetch, find_colleges, college_facts, compare_colleges, explore_colleges, glossary)</li>
        </ul>
        <P>
          Please credit the data as Quad gives it: &quot;Data: Quad (College Scorecard, IPEDS, and each college&apos;s Common
          Data Set, as cited per value)&quot;. Where the numbers come from, and how often they update, is on the{" "}
          <Link href="/data" className="font-semibold text-foreground underline-offset-2 hover:underline">
            Data page
          </Link>
          .
        </P>
      </Section>
    </main>
  );
}

function Section({ id, eyebrow, title, icon, children }: { id: string; eyebrow: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-16 scroll-mt-24 space-y-4 first:mt-0">
      <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase">
        {icon}
        {eyebrow}
      </p>
      <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

function Steps({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-3xl rounded-3xl border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-bold">{title}</h3>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">{children}</ol>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl rounded-2xl bg-muted/60 px-4 py-3 text-sm leading-relaxed text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">{children}</p>;
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-foreground underline-offset-2 hover:underline">
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
