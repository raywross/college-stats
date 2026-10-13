/**
 * Supabase Auth's emails in Quad's look (specs/auth-emails.md): sign-up confirmation, magic link, password reset,
 * email change, invitation, and the reauthentication code. Supabase sends these itself (through Resend's SMTP), so
 * they are Go templates with Supabase's variables ({{ .ConfirmationURL }}, {{ .Email }}, {{ .NewEmail }},
 * {{ .Token }}), not strings this app fills in. `npm run auth-emails` writes them to supabase/templates/ and pushes
 * them to a project. Pure: no secrets, no I/O.
 *
 * Email clients ignore most CSS and block SVG, so the layout is tables with inline styles, and the logo's four tiles
 * (components/layout/Logo.tsx) are table cells. Colors are the light theme's tokens (app/globals.css) as hex.
 */

export const AUTH_EMAIL_COLORS = {
  paper: "#faf9f5",
  card: "#ffffff",
  ink: "#131426",
  muted: "#5d5f6f",
  border: "#e3e1da",
  primary: "#613bf0",
  tiles: ["#6d4df2", "#c9fa4d", "#eb6834", "#c2378f"],
} as const;

/** Supabase's template names, as its Management API spells them (mailer_subjects_<name>, mailer_templates_<name>_content). */
export type AuthEmailName = "confirmation" | "magic_link" | "recovery" | "email_change" | "invite" | "reauthentication";

export interface AuthEmail {
  name: AuthEmailName;
  subject: string;
  html: string;
}

interface Copy {
  subject: string;
  /** Inbox preview text (hidden in the body). */
  preheader: string;
  heading: string;
  /** Paragraphs of HTML; may use Supabase's variables. */
  body: string[];
  /** The button: its label. Without one, `code` is shown instead. */
  button?: string;
  /** A one-time code shown large (reauthentication). */
  code?: string;
  /** Why they got this, and what to do if they didn't ask for it. */
  footnote: string;
}

const COPY: Record<AuthEmailName, Copy> = {
  confirmation: {
    subject: "Confirm your email for Quad",
    preheader: "One tap and your Quad account is ready.",
    heading: "Confirm your email",
    body: ["Tap the button to confirm <strong>{{ .Email }}</strong> and finish setting up your Quad account."],
    button: "Confirm email",
    footnote: "You're getting this because someone signed up for Quad with this address. If it wasn't you, ignore this email and no account is made.",
  },
  magic_link: {
    subject: "Your Quad sign-in link",
    preheader: "Sign in to Quad with one tap.",
    heading: "Sign in to Quad",
    body: ["Tap the button to sign in as <strong>{{ .Email }}</strong>. The link works once and expires in an hour."],
    button: "Sign in",
    footnote: "If you didn't ask to sign in, ignore this email. Nobody can sign in without this link.",
  },
  recovery: {
    subject: "Reset your Quad password",
    preheader: "Choose a new password for Quad.",
    heading: "Reset your password",
    body: ["We got a request to reset the password for <strong>{{ .Email }}</strong>. Tap the button to choose a new one. The link works once and expires in an hour."],
    button: "Choose a new password",
    footnote: "If you didn't ask for this, ignore this email. Your password stays the same.",
  },
  email_change: {
    subject: "Confirm your new email for Quad",
    preheader: "Confirm the new address for your Quad account.",
    heading: "Confirm your new email",
    body: ["Tap the button to change your Quad account's email from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>."],
    button: "Confirm new email",
    footnote: "If you didn't ask for this change, ignore this email and your account keeps its current address.",
  },
  invite: {
    subject: "You're invited to Quad",
    preheader: "Join Quad, where families plan the college search together.",
    heading: "You're invited to Quad",
    body: ["You've been invited to Quad, where families plan the college search together. Tap the button to accept and set up your account as <strong>{{ .Email }}</strong>."],
    button: "Accept the invitation",
    footnote: "If you weren't expecting this, ignore this email. Nothing happens unless you accept.",
  },
  reauthentication: {
    subject: "{{ .Token }} is your Quad verification code",
    preheader: "Your Quad verification code.",
    heading: "Your verification code",
    body: ["Enter this code in Quad to confirm it's you. It expires in an hour."],
    code: "{{ .Token }}",
    footnote: "If you didn't ask for a code, someone may know your password. Sign in and change it.",
  },
};

const FONT = "'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, Helvetica, sans-serif";
const BODY_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, Helvetica, sans-serif";

/** The four-tile mark, as a 2×2 table (rounded on clients that support border-radius, square elsewhere). */
function logoMark(): string {
  const [a, b, c, d] = AUTH_EMAIL_COLORS.tiles;
  const tile = (color: string, radius: number) =>
    `<td width="13" height="13" style="width:13px;height:13px;background:${color};border-radius:${radius}px;font-size:0;line-height:0;">&nbsp;</td>`;
  const gap = `<td width="3" style="width:3px;font-size:0;line-height:0;">&nbsp;</td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                <tr>${tile(a, 4)}${gap}${tile(b, 7)}</tr>
                <tr><td colspan="3" height="3" style="height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>${tile(c, 7)}${gap}${tile(d, 4)}</tr>
              </table>`;
}

function button(label: string): string {
  const c = AUTH_EMAIL_COLORS;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
                <tr>
                  <td style="border-radius:999px;background:${c.primary};">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:13px 26px;font-family:${BODY_FONT};font-size:16px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 4px;font-family:${BODY_FONT};font-size:13px;line-height:1.5;color:${c.muted};">Button not working? Paste this link into your browser:</p>
              <p style="margin:0;font-family:${BODY_FONT};font-size:13px;line-height:1.5;word-break:break-all;"><a href="{{ .ConfirmationURL }}" style="color:${c.primary};">{{ .ConfirmationURL }}</a></p>`;
}

function code(value: string): string {
  const c = AUTH_EMAIL_COLORS;
  return `<p style="margin:8px 0 8px;padding:16px 20px;background:${c.paper};border:1px solid ${c.border};border-radius:12px;font-family:'SFMono-Regular', Menlo, Consolas, monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:${c.ink};text-align:center;">${value}</p>`;
}

/** One email's full HTML document. */
export function renderAuthEmail(name: AuthEmailName): AuthEmail {
  const copy = COPY[name];
  const c = AUTH_EMAIL_COLORS;
  const paragraphs = copy.body
    .map((p) => `<p style="margin:0 0 16px;font-family:${BODY_FONT};font-size:16px;line-height:1.55;color:${c.ink};">${p}</p>`)
    .join("\n              ");
  const action = copy.button ? button(copy.button) : copy.code ? code(copy.code) : "";
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${copy.subject}</title>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&amp;display=swap" rel="stylesheet" />
  </head>
  <body style="margin:0;padding:0;background:${c.paper};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${copy.preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.paper};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
            <tr>
              <td style="padding:0 4px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;padding-right:10px;">
              ${logoMark()}
                    </td>
                    <td style="vertical-align:middle;font-family:${FONT};font-size:24px;font-weight:800;letter-spacing:-0.5px;color:${c.ink};">Quad</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:${c.card};border:1px solid ${c.border};border-radius:20px;padding:32px 28px;">
              <h1 style="margin:0 0 16px;font-family:${FONT};font-size:26px;font-weight:800;line-height:1.2;letter-spacing:-0.5px;color:${c.ink};">${copy.heading}</h1>
              ${paragraphs}
              ${action}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 4px 0;">
                <p style="margin:0 0 10px;font-family:${BODY_FONT};font-size:13px;line-height:1.5;color:${c.muted};">${copy.footnote}</p>
                <p style="margin:0;font-family:${BODY_FONT};font-size:13px;line-height:1.5;color:${c.muted};">Quad · College data, decoded. · <a href="https://usequad.app" style="color:${c.muted};">usequad.app</a> · Questions? Reply to this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
  return { name, subject: copy.subject, html };
}

export const AUTH_EMAIL_NAMES: readonly AuthEmailName[] = ["confirmation", "magic_link", "recovery", "email_change", "invite", "reauthentication"];

/** The Management API body that sets every template's subject and content (and nothing else). */
export function authEmailConfigPatch(): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const name of AUTH_EMAIL_NAMES) {
    const email = renderAuthEmail(name);
    patch[`mailer_subjects_${name}`] = email.subject;
    patch[`mailer_templates_${name}_content`] = email.html;
  }
  return patch;
}
