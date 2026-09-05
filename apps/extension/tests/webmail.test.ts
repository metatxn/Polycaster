import { describe, expect, it } from "vitest";
import { getUnsupportedSiteHostname } from "../src/site-support";
import { isWebmailUrl } from "../src/webmail";

const listedUrls = [
  "https://mail.google.com/",
  "https://outlook.live.com/mail/",
  "https://outlook.office.com/mail/",
  "https://mail.zoho.com/",
  "https://mail.yahoo.com/",
  "https://www.icloud.com/mail/",
  "https://mail.proton.me/",
  "https://app.fastmail.com/",
  "https://app.tuta.com/",
  "https://app.hey.com/",
  "https://mail.aol.com/",
  "https://www.gmx.com/",
  "https://www.mail.com/",
  "https://mail.yandex.com/",
  "https://e.mail.ru/",
  "https://mailfence.com/",
  "https://www.hushmail.com/",
  "https://www.startmail.com/",
  "https://mailbox.org/",
  "https://posteo.de/",
  "https://runbox.com/app",
  "https://kolabnow.com/",
  "https://countermail.com/",
  "https://webmail.disroot.org/",
  "https://mail.riseup.net/",
  "https://soverin.net/",
  "https://purelymail.com/",
  "https://webmail.migadu.com/",
  "https://app.titan.email/",
  "https://privateemail.com/",
  "https://mail.hostinger.com/",
  "https://mail.ionos.com/",
  "https://webmail.dreamhost.com/",
  "https://apps.rackspace.com/a/webmail",
  "https://aws.amazon.com/workmail/",
  "https://www.icewarp.com/",
  "https://mail.qq.com/",
  "https://mail.163.com/",
  "https://mail.126.com/",
  "https://mail.naver.com/",
  "https://mail.daum.net/",
  "https://email.seznam.cz/",
  "https://mail.rediff.com/",
  "https://mail.rambler.ru/",
  "https://mail.ukr.net/",
  "https://roundcube.net/",
  "https://snappymail.eu/",
  "https://www.sogo.nu/",
  "https://www.horde.org/",
  "https://cypht.org/",
];

describe("webmail exclusions from issue #114", () => {
  it.each(listedUrls)("excludes %s and routes underneath it", (url) => {
    for (const candidate of [
      url,
      `${url.replace(/\/$/, "")}/inbox?view=all#message`,
    ]) {
      expect(isWebmailUrl(candidate)).toBe(true);
      expect(getUnsupportedSiteHostname(candidate)).toBeNull();
    }
  });

  it.each([
    "https://outlook.live.com/mail",
    "https://www.icloud.com/mail?x=1",
    "https://MAIL.GOOGLE.COM./inbox",
    "http://mail.google.com/inbox",
  ])("recognizes canonical equivalents: %s", (url) => {
    expect(isWebmailUrl(url)).toBe(true);
  });

  it.each([
    "https://outlook.live.com/calendar",
    "https://outlook.office.com/mailbox",
    "https://www.icloud.com/photos",
    "https://www.icloud.com/mail-preview",
    "https://runbox.com/application",
    "https://apps.rackspace.com/a/webmail-other",
    "https://aws.amazon.com/ec2/",
    "https://aws.amazon.com/workmailing/",
    "https://mail.google.com.example.org/",
    "https://notmail.google.com/",
    "https://example.com/?url=https://mail.google.com/",
    "https://mail.google.com@example.com/",
    "https://finance.yahoo.com/",
    "https://google.com/",
    "https://x.com/",
    "https://self-hosted.example.org/roundcube",
    "file:///mail.google.com/",
    "not a URL",
    "",
    undefined,
  ])("does not suppress unrelated URLs: %s", (url) => {
    expect(isWebmailUrl(url)).toBe(false);
  });
});
