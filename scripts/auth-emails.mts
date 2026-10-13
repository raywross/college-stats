/**
 * Quad's Supabase Auth emails (specs/auth-emails.md, lib/emails/auth-templates.ts).
 *
 *   npm run auth-emails                      write supabase/templates/<name>.html (review them in a browser)
 *   npm run auth-emails -- --check           fail when the committed files differ from lib/emails/auth-templates.ts
 *   npm run auth-emails -- --push <ref>      set the subjects and templates on a Supabase project, nothing else
 *
 * --push needs SUPABASE_ACCESS_TOKEN (a personal access token, in .env.local) and sends only the mailer_subjects_* and
 * mailer_templates_*_content fields, so every other Auth setting on the project stays as it is.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_EMAIL_NAMES, authEmailConfigPatch, renderAuthEmail } from "../lib/emails/auth-templates.ts";

const DIR = join(import.meta.dirname, "..", "supabase", "templates");
const args = process.argv.slice(2);

if (args[0] === "--push") {
  const ref = args[1];
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) throw new Error("usage: npm run auth-emails -- --push <project ref>");
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not set (see .env.local).");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(authEmailConfigPatch()),
  });
  if (!res.ok) throw new Error(`Supabase answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const saved = (await res.json()) as Record<string, unknown>;
  const patch = authEmailConfigPatch();
  const differ = Object.keys(patch).filter((k) => saved[k] !== patch[k]);
  if (differ.length) throw new Error(`Saved, but these fields came back different: ${differ.join(", ")}`);
  console.log(`auth-emails: ${AUTH_EMAIL_NAMES.length} templates set on ${ref}.`);
} else {
  const check = args[0] === "--check";
  const stale: string[] = [];
  if (!check) mkdirSync(DIR, { recursive: true });
  for (const name of AUTH_EMAIL_NAMES) {
    const file = join(DIR, `${name}.html`);
    const { html } = renderAuthEmail(name);
    if (check) {
      let current = "";
      try {
        current = readFileSync(file, "utf8");
      } catch {}
      if (current !== html) stale.push(`supabase/templates/${name}.html`);
    } else {
      writeFileSync(file, html);
    }
  }
  if (stale.length) {
    console.error(`auth-emails: out of date (run npm run auth-emails): ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log(check ? "auth-emails: ok" : `auth-emails: wrote ${AUTH_EMAIL_NAMES.length} templates to supabase/templates/`);
}
