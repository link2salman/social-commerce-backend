import { escapeHtml } from '@utils/html';

/**
 * Transactional email bodies.
 *
 * ## Why a module rather than inline strings
 *
 * These are the only user-facing prose the backend owns, and they were previously
 * inline in `authService` — which meant the brand name lived in a service that has
 * no business knowing it, and there was nowhere to put a second email. Keeping the
 * copy here leaves the services holding only the decision to send.
 *
 * ## Why hand-written HTML and not a template engine
 *
 * Mail clients are not browsers. Gmail strips `<style>` blocks in some contexts and
 * Outlook renders through Word, so the reliable subset is table layout with
 * **inline** styles — which a templating library does not help with and mostly
 * obscures. One email does not justify the dependency.
 *
 * ## Why no logo image
 *
 * There is no domain yet (the API is served over HTTP on a bare IP — see the app's
 * .env), so there is no stable HTTPS origin to host an image at. A remote `<img>`
 * would be a broken icon in every client, and most clients block remote images by
 * default anyway until the reader opts in. The wordmark is therefore live text,
 * which also survives dark mode and screen readers. Revisit once a domain exists.
 *
 * ## Why every message ships a text part
 *
 * `text` is not a fallback nicety: a message with no plaintext alternative scores
 * as spam with most filters, and this mail carries a login-critical code.
 */

/** Brand pink-red — matches --color-primary in the app's theme tokens. */
const BRAND = '#FE2C55';
const INK = '#09090B';
const MUTED = '#71717A';

/**
 * Shared shell. `preheader` is the grey line clients show next to the subject in
 * the inbox list; left unset they helpfully substitute the first text they find,
 * which here would be the raw code — visible without opening the mail.
 */
const layout = (opts: { preheader: string; heading: string; body: string }): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head>
<body style="margin:0;padding:0;background:#F4F4F5;">
  <div style="display:none;font-size:1px;color:#F4F4F5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0 32px;">
          <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:${INK};">IO</span><span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:${BRAND};">Vibe</span>
        </td></tr>
        <tr><td style="padding:20px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:19px;font-weight:600;color:${INK};">${escapeHtml(opts.heading)}</td></tr>
        <tr><td style="padding:0 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#3F3F46;">${opts.body}</td></tr>
      </table>
      <div style="max-width:520px;padding:16px 8px 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${MUTED};">
        This is an automated message from IOVibe — please don't reply to it.
      </div>
    </td></tr>
  </table>
</body>
</html>`;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Password-reset one-time code.
 *
 * The code is rendered as text, never as a link: this app verifies a 6-digit code
 * typed back into the reset screen, so there is no URL to click. That also keeps
 * the mail useless to an email-scanning link prefetcher.
 */
export const passwordResetEmail = (code: string, ttlMinutes: number): RenderedEmail => {
  const safeCode = escapeHtml(code);
  return {
    subject: 'Your IOVibe password reset code',
    text: [
      'Reset your IOVibe password',
      '',
      `Your code is ${code}`,
      '',
      `It expires in ${ttlMinutes} minutes and can only be used once.`,
      "If you didn't ask to reset your password, you can ignore this email — nothing has changed.",
      '',
      "This is an automated message from IOVibe — please don't reply to it.",
    ].join('\n'),
    html: layout({
      preheader: `Your password reset code expires in ${ttlMinutes} minutes.`,
      heading: 'Reset your password',
      body: `
        <p style="margin:0 0 18px 0;">Enter this code in the app to choose a new password.</p>
        <div style="margin:0 0 18px 0;padding:16px;background:#FAFAFA;border:1px solid #E4E4E7;border-radius:12px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:7px;color:${INK};">${safeCode}</div>
        <p style="margin:0 0 12px 0;color:${MUTED};font-size:13px;line-height:19px;">It expires in ${ttlMinutes} minutes and can only be used once.</p>
        <p style="margin:0;color:${MUTED};font-size:13px;line-height:19px;">If you didn't ask to reset your password, you can safely ignore this email — nothing has changed.</p>
      `,
    }),
  };
};
