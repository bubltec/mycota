/**
 * The server-rendered pages the OAuth flow needs (consent, sign-in, error).
 * Plain HTML in a neutral dark theme; `css` lets the app restyle it. Every
 * value is escaped.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface PageBrand {
  appName: string;
  css?: string;
}

function page(brand: PageBrand, title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(brand.appName)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #111; color: #f4f4f4; font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 32rem; margin: 12vh auto; padding: 0 16px; }
  .logo { font-weight: 700; font-size: 20px; letter-spacing: .08em; }
  .panel { border: 2px solid #4a7fd4; border-radius: 6px; padding: 20px; margin-top: 20px; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p { color: #b8b8b8; margin: 0 0 12px; } strong { color: #f4f4f4; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
  button, a.btn { font: 600 14px ui-sans-serif, system-ui, sans-serif; padding: 10px 14px; border: 2px solid #6b9ae6;
    border-radius: 4px; background: #2a5db0; color: #f4f4f4; cursor: pointer; text-decoration: none; }
  button.ghost { background: transparent; border-color: #4a7fd4; }
  .err { border-color: #e05a3a; } .err h1 { color: #e05a3a; }
  code { color: #e8b84a; }
  ${brand.css ?? ''}
</style></head>
<body><main><div class="logo">${esc(brand.appName)}</div>${body}</main></body></html>`;
}

export function consentPage(
  brand: PageBrand,
  p: {
    clientName: string;
    redirectHost: string;
    user: string;
    /** Completes "<client> is asking to ___ as <user>". */
    grants: string;
    hidden: Record<string, string>;
    /** Form target for the allow / deny post. */
    action: string;
    /** Offered when the signed-in account is the wrong one. */
    signInAgain?: { label: string; href: string };
  },
): string {
  const fields = Object.entries(p.hidden)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  const again = p.signInAgain
    ? `<p>Wrong account? <a href="${esc(p.signInAgain.href)}">${esc(p.signInAgain.label)}</a> again.</p>`
    : '';
  return page(
    brand,
    'Connect',
    `<div class="panel"><h1>Connect ${esc(p.clientName)}?</h1>
<p><strong>${esc(p.clientName)}</strong> (returning to <code>${esc(p.redirectHost)}</code>) is asking to ${esc(p.grants)}
as <strong>${esc(p.user)}</strong>.</p>
<form method="post" action="${esc(p.action)}">${fields}
<div class="row"><button name="decision" value="allow">Allow</button>
<button class="ghost" name="decision" value="deny">Deny</button></div></form>
${again}</div>`,
  );
}

export function signInPage(
  brand: PageBrand,
  p: { clientName: string; links: { label: string; href: string }[]; localAction?: string },
): string {
  const links = p.links.map((l) => `<a class="btn" href="${esc(l.href)}">${esc(l.label)}</a>`).join('');
  const local = p.localAction
    ? `<form method="post" action="${esc(p.localAction)}"><button class="ghost">Local sign-in</button></form>`
    : '';
  return page(
    brand,
    'Sign in',
    `<div class="panel"><h1>Sign in to connect ${esc(p.clientName)}</h1>
<p>Sign in, and you'll come straight back here.</p>
<div class="row">${links}${local}</div>${!links && !local ? '<p>No sign-in method is configured.</p>' : ''}</div>`,
  );
}

export function errorPage(brand: PageBrand, title: string, message: string): string {
  return page(brand, title, `<div class="panel err"><h1>${esc(title)}</h1><p>${esc(message)}</p></div>`);
}
