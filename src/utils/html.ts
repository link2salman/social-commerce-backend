/**
 * Escape a string for interpolation into HTML text or a quoted attribute.
 *
 * Used by the email templates. Today every value they interpolate is server-generated
 * (a 6-digit code, a TTL), so nothing here is attacker-controlled — this exists so
 * that stays true by construction rather than by remembering. The moment a template
 * includes a username or caption, the escaping is already in the right place.
 *
 * Both quote forms are encoded so the same function is safe in `attr="…"` and
 * `attr='…'`; `&` is replaced first, or it would double-encode the entities the
 * later replacements introduce.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
