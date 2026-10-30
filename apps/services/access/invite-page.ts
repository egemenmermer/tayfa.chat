import { createHash } from 'node:crypto';

/** Inline style only; the page runs no script, so a CSP hash is the whole style allowance. */
const STYLE = `
:root{color-scheme:dark;--bg:#0f0f14;--panel:#191922;--line:#2a2a38;--text:#ecebf5;--muted:#a3a1b8;--accent:#8b5cf6}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
main{width:100%;max-width:440px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px 24px}
.brand{margin:0 0 20px;font-size:13px;letter-spacing:.12em;color:var(--muted)}
h1{margin:0 0 6px;font-size:22px;line-height:1.3}
.meta{margin:0 0 24px;color:var(--muted);font-size:14px}
ol{margin:0;padding:0;list-style:none;display:grid;gap:18px}
li{display:grid;gap:8px}
.step{font-weight:600}
.step span{display:inline-block;min-width:22px;color:var(--accent)}
a.button{display:block;text-align:center;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:600;background:var(--accent);color:#fff}
a.secondary{background:transparent;border:1px solid var(--line);color:var(--text)}
.hint{margin:0;color:var(--muted);font-size:13px}
.lead{margin:0 0 24px;display:grid;gap:8px}
h2{margin:0 0 14px;padding-top:20px;border-top:1px solid var(--line);font-size:15px}
.note{margin:24px 0 0;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
`;
export const INVITE_PAGE_STYLE_HASH = createHash('sha256').update(STYLE).digest('base64');

export const INVITE_PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
  vary: 'accept-language',
  'content-security-policy': `default-src 'none'; style-src 'sha256-${INVITE_PAGE_STYLE_HASH}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
} as const;

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

export type InviteLocale = 'tr' | 'en';

/**
 * Turkish when the most preferred language is Turkish; English for any other preference. A request
 * that states no preference (link-preview crawlers, scripts) gets Turkish, the source language.
 * Self-contained on purpose: this service does not import the desktop catalog.
 */
export function inviteLocale(acceptLanguage?: string | readonly string[]): InviteLocale {
  const header = Array.isArray(acceptLanguage) ? acceptLanguage.join(',') : acceptLanguage;
  const preferred = String(header ?? '')
    .split(',')
    .map((entry, index) => {
      const [tag = '', ...params] = entry.trim().split(';');
      const q = params.map((param) => /^\s*q=([\d.]+)\s*$/i.exec(param)?.[1]).find(Boolean);
      return { tag: tag.trim().toLowerCase(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => entry.tag && entry.tag !== '*' && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)[0];
  if (!preferred) return 'tr';
  return preferred.tag.split('-')[0] === 'tr' ? 'tr' : 'en';
}

interface InviteCopy {
  lang: InviteLocale;
  pageTitle: string;
  previewDescription: string;
  invalidTitle: string;
  invalidMeta: string;
  invalidHint: string;
  titleNamed: (name: string) => string;
  titleAnonymous: string;
  expires: (date: string) => string;
  openInApp: string;
  existingAccount: string;
  existingFallback: string;
  existingPasteOnly: string;
  newUsers: string;
  stepInstall: string;
  download: string;
  platforms: string;
  stepRegister: string;
  registerAfterInstall: string;
  pasteOnly: string;
  note: string;
}

const copy: Record<InviteLocale, InviteCopy> = {
  tr: {
    lang: 'tr',
    pageTitle: 'Tayfa daveti',
    previewDescription: "Arkadaşların seni Tayfa'ya davet etti.", // i18n-ignore: Turkish copy of the page
    invalidTitle: 'Bu davet bağlantısı artık geçerli değil', // i18n-ignore: Turkish copy of the page
    invalidMeta: 'Süresi dolmuş, kişi sınırı dolmuş ya da iptal edilmiş olabilir.', // i18n-ignore: Turkish copy of the page
    invalidHint: 'Seni davet eden kişiden yeni bir bağlantı iste.', // i18n-ignore: Turkish copy of the page
    titleNamed: (name) => `${name} topluluğuna davet edildin`, // i18n-ignore: Turkish copy of the page
    titleAnonymous: 'Bir Tayfa topluluğuna davet edildin', // i18n-ignore: Turkish copy of the page
    expires: (date) => `Son geçerlilik: ${date}`, // i18n-ignore: Turkish copy of the page
    openInApp: "Tayfa'da aç", // i18n-ignore: Turkish copy of the page
    existingAccount:
      "Zaten hesabın varsa: <b>Tayfa'da aç</b> → topluluğa katıl. Uygulamada <b>Daveti kabul et</b> düğmesine basman yeterli.", // i18n-ignore: Turkish copy of the page
    existingFallback:
      "Açılmazsa Tayfa'da topluluk menüsünden <b>Davet bağlantısıyla katıl</b> seçeneğine (eski sürümlerde Topluluklar → <b>Davetle katıl</b>) bu sayfanın adresini yapıştır.", // i18n-ignore: Turkish copy of the page
    existingPasteOnly:
      "Zaten hesabın varsa: Tayfa'da topluluk menüsünden <b>Davet bağlantısıyla katıl</b> seçeneğine (eski sürümlerde Topluluklar → <b>Davetle katıl</b>) bu sayfanın adresini yapıştır.", // i18n-ignore: Turkish copy of the page
    newUsers: 'Henüz hesabın yok mu?', // i18n-ignore: Turkish copy of the page
    stepInstall: "Tayfa'yı bilgisayarına kur", // i18n-ignore: Turkish copy of the page
    download: 'Uygulamayı indir', // i18n-ignore: Turkish copy of the page
    platforms: 'macOS (Apple Silicon) ve Windows için.', // i18n-ignore: Turkish copy of the page
    stepRegister: 'Davetle kayıt ol', // i18n-ignore: Turkish copy of the page
    registerAfterInstall:
      "Kurduktan sonra yukarıdaki <b>Tayfa'da aç</b> düğmesine yeniden bas; <b>Kayıt ol</b> ekranı bu davetle açılır. Açılmazsa <b>Kayıt ol</b> sekmesine bu sayfanın adresini yapıştır.", // i18n-ignore: Turkish copy of the page
    pasteOnly: "Tayfa'da <b>Kayıt ol</b> sekmesine bu sayfanın adresini yapıştır.", // i18n-ignore: Turkish copy of the page
    note: 'Tayfa masaüstünde çalışır. Bu bağlantıyı telefondan açtıysan bilgisayarına gönder.', // i18n-ignore: Turkish copy of the page
  },
  en: {
    lang: 'en',
    pageTitle: 'Tayfa invite',
    previewDescription: 'Your friends invited you to Tayfa.',
    invalidTitle: 'This invite link is no longer valid',
    invalidMeta: 'It may have expired, reached its member limit or been canceled.',
    invalidHint: 'Ask the person who invited you for a new link.',
    titleNamed: (name) => `You’ve been invited to join ${name}`,
    titleAnonymous: 'You’ve been invited to a Tayfa community',
    expires: (date) => `Valid until: ${date}`,
    openInApp: 'Open in Tayfa',
    existingAccount:
      'Already have an account? <b>Open in Tayfa</b> → join the community. In the app, just press <b>Accept invite</b>.',
    existingFallback:
      'If it doesn’t open, choose <b>Join with an invite link</b> in Tayfa’s community menu (in older versions: Communities → <b>Join with an invite</b>) and paste this page’s address.',
    existingPasteOnly:
      'Already have an account? Choose <b>Join with an invite link</b> in Tayfa’s community menu (in older versions: Communities → <b>Join with an invite</b>) and paste this page’s address.',
    newUsers: 'New to Tayfa?',
    stepInstall: 'Install Tayfa on your computer',
    download: 'Download the app',
    platforms: 'For macOS (Apple Silicon) and Windows.',
    stepRegister: 'Sign up with this invite',
    registerAfterInstall:
      'After installing, press <b>Open in Tayfa</b> above again; the <b>Sign up</b> screen opens with this invite. If it doesn’t open, paste this page’s address into the <b>Sign up</b> tab.',
    pasteOnly: 'Paste this page’s address into the <b>Sign up</b> tab in Tayfa.',
    note: 'Tayfa runs on desktop. If you opened this link on your phone, send it to your computer.',
  },
};

const formatExpiry = (iso: string, locale: InviteLocale) =>
  locale === 'tr'
    ? new Intl.DateTimeFormat('tr-TR', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'Europe/Istanbul',
      }).format(new Date(iso))
    : new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Europe/Istanbul',
        timeZoneName: 'short',
      }).format(new Date(iso));

function page(text: InviteCopy, body: string) {
  // Generic preview metadata: link previews never reveal the community name.
  return `<!doctype html>
<html lang="${text.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta property="og:title" content="${text.pageTitle}">
<meta property="og:description" content="${text.previewDescription}">
<title>${text.pageTitle}</title>
<style>${STYLE}</style>
</head>
<body><main><p class="brand">Tayfa</p>${body}</main></body>
</html>`;
}

export type InvitePageState =
  | {
      kind: 'valid';
      communityName: string | null;
      expiresAt: string;
      appLink: string | null;
      downloadUrl: string;
    }
  | { kind: 'invalid' };

/** `acceptLanguage` is the request's Accept-Language header; see inviteLocale. */
export function renderInvitePage(
  state: InvitePageState,
  acceptLanguage?: string | readonly string[],
): { status: number; html: string } {
  const text = copy[inviteLocale(acceptLanguage)];
  if (state.kind === 'invalid')
    return {
      status: 404,
      html: page(
        text,
        `<h1>${text.invalidTitle}</h1>
<p class="meta">${text.invalidMeta}</p>
<p class="hint">${text.invalidHint}</p>`,
      ),
    };
  const title = state.communityName
    ? text.titleNamed(escape(state.communityName))
    : text.titleAnonymous;
  // Everyone starts with the app link: it joins an existing account and opens Kayıt ol otherwise.
  const lead = state.appLink
    ? `<div class="lead"><a class="button" href="${escape(state.appLink)}">${text.openInApp}</a>
<p class="hint">${text.existingAccount}</p>
<p class="hint">${text.existingFallback}</p></div>`
    : `<div class="lead"><p class="hint">${text.existingPasteOnly}</p></div>`;
  const register = state.appLink ? text.registerAfterInstall : text.pasteOnly;
  return {
    status: 200,
    html: page(
      text,
      `<h1>${title}</h1>
<p class="meta">${text.expires(escape(formatExpiry(state.expiresAt, text.lang)))}</p>
${lead}
<h2>${text.newUsers}</h2>
<ol>
<li><p class="step"><span>1</span>${text.stepInstall}</p>
<a class="button secondary" href="${escape(state.downloadUrl)}">${text.download}</a>
<p class="hint">${text.platforms}</p></li>
<li><p class="step"><span>2</span>${text.stepRegister}</p>
<p class="hint">${register}</p></li>
</ol>
<p class="note">${text.note}</p>`,
    ),
  };
}
