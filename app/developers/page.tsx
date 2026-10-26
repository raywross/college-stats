import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Bot, Code2, Fingerprint, KeyRound, Route, Scale, ShieldCheck, Table2 } from "lucide-react";
import { ConnectionSnippets } from "@/components/api/ConnectionSnippets";
import { CodeBlock } from "@/components/api/CodeBlock";
import { Term } from "@/components/ui/info-tip";
import { API_KEY_LIMITS, API_KEY_PREFIX } from "@/lib/api/keys";
import { API_BASE, API_ROUTES, MCP_PATH, MCP_PUBLIC_PATH, MCP_TOOLS, type ApiParam } from "@/lib/api/routes";
import { fieldRegistry, type FieldRow } from "@/lib/api/serialize";
import { DOCS_ORIGIN, KEY_PLACEHOLDER } from "@/lib/api-snippets";
import { API_TERMS, attributionLine } from "@/lib/api-terms";
import { getData } from "@/lib/data";
import { num } from "@/lib/format";
import { dateLabel } from "@/lib/releases";
import { TOPIC_LABELS } from "@/lib/topic-labels";
import type { Topic } from "@/lib/types";

export const metadata: Metadata = {
  title: "Developers",
  description: "Quad's college data as a REST API and an MCP server for AI assistants, with the source and year of every value. Free with an account.",
};

// The field registry's years follow the dataset, so re-render daily like the Data page.
export const revalidate = 86400;

const link = "font-semibold text-primary hover:underline";
const code = "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";

const TOC = [
  ["what", "What this is"],
  ["key", "Get a key"],
  ["authentication", "Authentication"],
  ["endpoints", "Endpoints"],
  ["mcp", "MCP tools"],
  ["fields", "Fields"],
  ["lineage", "Lineage"],
  ["terms", "Terms"],
] as const;

/** Same shell as the Data and Privacy pages: eyebrow, display heading, body. */
function Section({ id, eyebrow, title, icon, children }: { id: string; eyebrow: string; title: ReactNode; icon: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-14 scroll-mt-24 space-y-4 first:mt-0">
      <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase">
        {icon} {eyebrow}
      </p>
      <h2 id={`${id}-h`} className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <div className="min-w-0 space-y-3 text-[15px] leading-relaxed text-muted-foreground [&_b]:text-foreground">{children}</div>
    </section>
  );
}

/*
 * Tables on this page are real tables from `md`; on a phone each row becomes a block with its cells stacked and the
 * column heads hidden (each cell that needs a label carries one), so nothing scrolls sideways.
 */
const TABLE = "w-full text-left text-sm max-md:block";
const THEAD = "text-xs font-semibold text-muted-foreground max-md:sr-only";
const TBODY = "max-md:block";
const TR = "border-t align-top max-md:block max-md:py-3";
const TH = "py-2 pr-4 font-semibold";
const TD = "py-2.5 pr-4 max-md:block max-md:py-1 max-md:pr-0";
/** Field rows are many, so on a phone their cells sit tight. */
const FIELD_TD = "py-2.5 pr-4 max-md:block max-md:py-0 max-md:pr-0";

function ParamList({ params }: { params: readonly ApiParam[] }) {
  if (params.length === 0) return <span className="text-muted-foreground">None</span>;
  return (
    <ul className="space-y-1.5">
      {params.map((p) => (
        <li key={`${p.in}:${p.name}`}>
          <code className={code}>{p.name}</code>{" "}
          <span className="text-xs text-muted-foreground">
            {p.in} · {p.type}
            {p.required ? " · required" : ""}
          </span>
          <span className="block text-muted-foreground">
            {p.description}
            {p.enum && p.enum.length > 0 && (
              <>
                {" "}
                One of {p.enum.map((v, i) => (
                  <span key={v}>
                    {i > 0 && ", "}
                    <code className={code}>{v}</code>
                  </span>
                ))}
                .
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Registry rows grouped by topic, in the order the Data page lists topics. */
function groupByTopic(rows: FieldRow[]): { topic: Topic; label: string; rows: FieldRow[] }[] {
  return (Object.keys(TOPIC_LABELS) as Topic[])
    .map((topic) => ({ topic, label: TOPIC_LABELS[topic], rows: rows.filter((r) => r.topic === topic) }))
    .filter((g) => g.rows.length > 0);
}

const ERRORS: { status: string; code: string; meaning: string }[] = [
  { status: "400", code: "bad_request", meaning: "A parameter is missing or not valid. The message names it." },
  { status: "401", code: "missing_key", meaning: "No Authorization header, or it isn't a Bearer token." },
  { status: "401", code: "invalid_key", meaning: "The key is unknown or revoked, or its owner's account is paused. Make a new one on your account page." },
  { status: "404", code: "not_found", meaning: "No such college, or no history for it." },
  { status: "429", code: "rate_limited", meaning: "Over the per-minute or the daily limit. Retry-After says how many seconds to wait." },
  { status: "503", code: "unavailable", meaning: "The key check couldn't be answered just now. The data is fine; try again shortly." },
];

export default async function DevelopersPage() {
  const { getAllSchools, getMeta } = await getData();
  const meta = getMeta();
  const collegeCount = getAllSchools().length;
  const groups = groupByTopic(fieldRegistry(meta));
  const fieldCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const openapi = API_ROUTES.find((r) => r.id === "openapi");
  const retrieved = dateLabel(meta.retrieved);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-10">
        <p className="mb-2 hidden text-xs font-bold tracking-[0.18em] text-primary uppercase sm:block">Developers</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          The same <span className="highlight">numbers</span>, by API
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          A REST API and an MCP server for people with a Quad account. Every answer is the number the site shows, with its source and the year
          it describes. Data last retrieved <b className="text-foreground">{retrieved}</b>.
        </p>
        <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold hover:border-primary hover:text-primary">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Section id="what" eyebrow="Overview" title="What this is" icon={<Code2 className="size-4" aria-hidden />}>
        <p className="max-w-3xl">
          Quad&apos;s dataset covers {num(collegeCount)} four-year colleges: admissions, costs, outcomes, and the values calculated from them, built from the{" "}
          <Term term="scorecard">College Scorecard</Term>, <Term term="ipeds">IPEDS</Term>, and colleges&apos; own{" "}
          <Term term="cds">Common Data Sets</Term>, with years of history for most. There are two ways in, and both read the same code the pages use, so they
          can&apos;t disagree with the site.
        </p>
        <ul className="max-w-3xl list-disc space-y-1 pl-5">
          <li>
            <b>The REST API</b> at <code className={code}>{API_BASE}</code>: JSON over GET, for scripts, notebooks, and spreadsheets.
          </li>
          <li>
            <b>The MCP server</b> at <code className={code}>{MCP_PATH}</code>: lets an AI assistant such as Claude or Cursor look up a college, compare
            several, and read a value&apos;s source on your behalf.
          </li>
        </ul>
        <p className="max-w-3xl">
          Both need a key from your account. The one exception is the assistants&apos; connector menus (Claude, ChatGPT, Gemini), which can&apos;t
          send a header: the same MCP server answers them without a key at <code className={code}>{MCP_PUBLIC_PATH}</code>, limited per address;{" "}
          <Link href="/connect" className={link}>
            Connect
          </Link>{" "}
          has those steps. Apart from that address and the OpenAPI document, nothing is open to anonymous callers.
        </p>
      </Section>

      <Section id="key" eyebrow="Start" title="Get a key" icon={<KeyRound className="size-4" aria-hidden />}>
        <ol className="max-w-3xl list-decimal space-y-1.5 pl-5">
          <li>
            <Link href="/login" className={link}>
              Sign up or sign in
            </Link>
            . Accounts are for people 13 and older.
          </li>
          <li>
            Open{" "}
            <Link href="/account/api-keys" className={link}>
              API keys
            </Link>{" "}
            on your account, name the key (&ldquo;My notebook&rdquo;), and make it.
          </li>
          <li>Copy it then. It&apos;s shown once; Quad keeps only a fingerprint of it.</li>
          <li>Send it with every request, as below.</li>
        </ol>
      </Section>

      <Section id="authentication" eyebrow="Access" title="Authentication, limits, and errors" icon={<ShieldCheck className="size-4" aria-hidden />}>
        <p className="max-w-3xl">
          Send the key as a bearer token. A key looks like <code className={code}>{API_KEY_PREFIX}</code> followed by 40 lowercase letters and digits.
        </p>
        <CodeBlock title="Request header" code={`Authorization: Bearer ${KEY_PLACEHOLDER}`} />
        <h3 className="pt-2 font-display text-lg font-bold text-foreground">Limits</h3>
        <ul className="max-w-3xl list-disc space-y-1 pl-5">
          <li>
            <b>{API_KEY_LIMITS.perDay.toLocaleString("en-US")}</b> requests a day per key. The count starts over each day (UTC).
          </li>
          <li>
            <b>{API_KEY_LIMITS.perMinute}</b> requests a minute per key.
          </li>
          <li>
            Up to <b>{API_KEY_LIMITS.keysPerUser}</b> active keys per account. Each MCP tool call counts as one request.
          </li>
        </ul>
        <p className="max-w-3xl">
          Answers carry an <code className={code}>X-Dataset-Retrieved</code> date and an <code className={code}>ETag</code>; send{" "}
          <code className={code}>If-None-Match</code> to get a 304 when nothing changed. They are never cached by a shared cache.
        </p>
        <h3 className="pt-2 font-display text-lg font-bold text-foreground">Errors</h3>
        <p className="max-w-3xl">
          Errors are JSON in one shape: <code className={code}>{`{ "error": { "code": "invalid_key", "message": "…" } }`}</code>.
        </p>
        <table className={TABLE}>
          <thead className={THEAD}>
            <tr>
              <th className={TH}>Status</th>
              <th className={TH}>Code</th>
              <th className={TH}>Meaning</th>
            </tr>
          </thead>
          <tbody className={TBODY}>
            {ERRORS.map((e) => (
              <tr key={e.code} className={TR}>
                <td className={`${TD} font-semibold text-foreground`}>{e.status}</td>
                <td className={TD}>
                  <code className={code}>{e.code}</code>
                </td>
                <td className={TD}>{e.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="endpoints" eyebrow="REST" title="Endpoints" icon={<Route className="size-4" aria-hidden />}>
        <p className="max-w-3xl">
          Every endpoint is a GET and answers JSON. Query parameters follow the site&apos;s own: an Explore page&apos;s filters work as API parameters.
          {openapi && (
            <>
              {" "}
              The whole API is also described as OpenAPI 3.1, which needs no key:{" "}
              <a href={openapi.path} className={link}>
                <code className={code}>{openapi.path}</code>
              </a>
              .
            </>
          )}
        </p>
        <table className={TABLE}>
          <thead className={THEAD}>
            <tr>
              <th className={TH}>Endpoint</th>
              <th className={TH}>Returns</th>
              <th className={TH}>Parameters</th>
            </tr>
          </thead>
          <tbody className={TBODY}>
            {API_ROUTES.map((r) => (
              <tr key={r.id} id={`endpoint-${r.id}`} className={TR}>
                <td className={`${TD} whitespace-nowrap max-md:whitespace-normal md:w-64`}>
                  <span className="font-mono text-xs font-semibold text-foreground">{r.method}</span>{" "}
                  <code className="font-mono text-xs break-all text-foreground">{r.path}</code>
                  {!r.keyed && <span className="mt-1 block text-xs">No key needed</span>}
                </td>
                <td className={`${TD} md:w-72`}>
                  <b>{r.summary}</b>
                  <span className="mt-0.5 block">{r.description}</span>
                </td>
                <td className={TD}>
                  <ParamList params={r.params} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="mcp" eyebrow="MCP" title="MCP tools" icon={<Bot className="size-4" aria-hidden />}>
        <p className="max-w-3xl">
          The Model Context Protocol lets an assistant call tools. Point a client at <code className={code}>{MCP_PATH}</code> with your key, and ask it
          about colleges in plain words; it calls these tools and can quote each value&apos;s source and year.
        </p>
        {MCP_TOOLS.length === 0 ? (
          <p className="rounded-xl bg-muted/60 px-3.5 py-3 text-sm">The tool list isn&apos;t published yet.</p>
        ) : (
          <table className={TABLE}>
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Tool</th>
                <th className={TH}>What it does</th>
                <th className={TH}>Inputs</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {MCP_TOOLS.map((t) => (
                <tr key={t.name} id={`tool-${t.name}`} className={TR}>
                  <td className={`${TD} md:w-56`}>
                    <code className="font-mono text-xs font-semibold break-all text-foreground">{t.name}</code>
                  </td>
                  <td className={`${TD} md:w-72`}>{t.summary}</td>
                  <td className={TD}>
                    <ParamList params={t.inputs} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3 className="pt-2 font-display text-lg font-bold text-foreground">Connect</h3>
        <p className="max-w-3xl">
          Replace <code className={code}>{KEY_PLACEHOLDER}</code> with your key. On your{" "}
          <Link href="/account/api-keys" className={link}>
            API keys page
          </Link>{" "}
          the same snippets appear with a new key already in them.
        </p>
        <ConnectionSnippets origin={DOCS_ORIGIN} apiKey={KEY_PLACEHOLDER} />
      </Section>

      <Section id="fields" eyebrow="Registry" title="Fields" icon={<Table2 className="size-4" aria-hidden />}>
        <p className="max-w-3xl">
          {fieldCount} fields, each with the source it comes from and the year that release describes (as of data retrieved {retrieved}). The same list is
          the fields endpoint. Calculated values show their formula. Where a field has no single release, each value is dated on its own.
        </p>
        <div className="space-y-3">
          {groups.map((g) => (
            <details key={g.topic} className="group rounded-3xl border bg-card px-4 py-3 sm:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1 font-display text-lg font-bold text-foreground">
                <span>{g.label}</span>
                <span className="text-sm font-medium text-muted-foreground">{g.rows.length} fields</span>
              </summary>
              <table className={`${TABLE} mt-2`}>
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>Path</th>
                    <th className={TH}>Field</th>
                    <th className={TH}>Source and year</th>
                  </tr>
                </thead>
                <tbody className={TBODY}>
                  {g.rows.map((r) => (
                    <tr key={r.path} className={`${TR} max-md:py-2`}>
                      <td className={`${FIELD_TD} md:w-72`}>
                        <code className="font-mono text-xs break-all text-foreground">{r.path}</code>
                      </td>
                      <td className={FIELD_TD}>
                        <span className="text-foreground">{r.label}</span>
                        {r.formula && (
                          <span className="mt-0.5 block text-xs">
                            Calculated: <code className="font-mono">{r.formula}</code>
                          </span>
                        )}
                      </td>
                      <td className={`${FIELD_TD} md:w-64`}>
                        <span className="max-md:text-xs">{r.source_label}</span>
                        <span className="text-xs max-md:before:content-['_·_'] md:block">{r.year ?? "Dated on each value"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      </Section>

      <Section id="lineage" eyebrow="Trust" title="Lineage" icon={<Fingerprint className="size-4" aria-hidden />}>
        <p className="max-w-3xl">
          Every value carries its source and the year it describes, and the API hands that record over with the number. A college&apos;s admissions figures are
          the newest it has published anywhere: the federal release, or a newer Common Data Set or class profile from its own site when it has one. Years can
          differ between colleges, since each publishes on its own schedule.
        </p>
        <p className="max-w-3xl">
          The lineage endpoint resolves each field a college has a value for to its source, year, and, for calculated values, the formula and the
          inputs. Fields used only inside Quad&apos;s own method are never listed or returned. How new each dataset is, and when the next releases are due,
          is on the{" "}
          <Link href="/data" className={link}>
            Data page
          </Link>
          .
        </p>
      </Section>

      <Section id="terms" eyebrow="Rules" title="Terms" icon={<Scale className="size-4" aria-hidden />}>
        <p className="max-w-3xl">You accept these when you make a key.</p>
        <ul className="max-w-3xl space-y-2">
          {API_TERMS.map((t) => (
            <li key={t.title}>
              <b>{t.title}.</b> {t.body}
            </li>
          ))}
        </ul>
        <p className="max-w-3xl">
          For example: <code className={code}>{attributionLine(retrieved)}</code>
        </p>
      </Section>
    </div>
  );
}
