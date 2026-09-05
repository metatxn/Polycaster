// Issue #114 covers these exact hosts, not arbitrary self-hosted mail clients.
const WEBMAIL_ROUTES = [
  "mail.google.com/",
  "outlook.live.com/mail",
  "outlook.office.com/mail",
  "mail.zoho.com/",
  "mail.yahoo.com/",
  "www.icloud.com/mail",
  "mail.proton.me/",
  "app.fastmail.com/",
  "app.tuta.com/",
  "app.hey.com/",
  "mail.aol.com/",
  "www.gmx.com/",
  "www.mail.com/",
  "mail.yandex.com/",
  "e.mail.ru/",
  "mailfence.com/",
  "www.hushmail.com/",
  "www.startmail.com/",
  "mailbox.org/",
  "posteo.de/",
  "runbox.com/app",
  "kolabnow.com/",
  "countermail.com/",
  "webmail.disroot.org/",
  "mail.riseup.net/",
  "soverin.net/",
  "purelymail.com/",
  "webmail.migadu.com/",
  "app.titan.email/",
  "privateemail.com/",
  "mail.hostinger.com/",
  "mail.ionos.com/",
  "webmail.dreamhost.com/",
  "apps.rackspace.com/a/webmail",
  "aws.amazon.com/workmail",
  "www.icewarp.com/",
  "mail.qq.com/",
  "mail.163.com/",
  "mail.126.com/",
  "mail.naver.com/",
  "mail.daum.net/",
  "email.seznam.cz/",
  "mail.rediff.com/",
  "mail.rambler.ru/",
  "mail.ukr.net/",
  "roundcube.net/",
  "snappymail.eu/",
  "www.sogo.nu/",
  "www.horde.org/",
  "cypht.org/",
].map((route) => new URL(`https://${route}`));

// Path-scoped hosts keep the lightweight script so SPA navigation out of mail
// can restore normal behavior without a reload. Runtime checks suppress mail UI.
export const WEBMAIL_HOST_EXCLUDE_PATTERNS = WEBMAIL_ROUTES.filter(
  (url) => url.pathname === "/"
).map((url) => `*://${url.hostname}/*`);

export function isWebmailUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return WEBMAIL_ROUTES.some(
      (rule) =>
        hostname === rule.hostname &&
        (rule.pathname === "/" ||
          url.pathname === rule.pathname ||
          url.pathname.startsWith(`${rule.pathname}/`))
    );
  } catch {
    return false;
  }
}
