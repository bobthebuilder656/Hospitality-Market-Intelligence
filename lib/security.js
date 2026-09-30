// Protections for running on the public internet: response headers, a request
// limit per visitor, and the rule for who may preview unpublished articles.

const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

// The page loads its own scripts and styles, Google Fonts, and pictures from
// anywhere (event pictures and company icons are hosted elsewhere). Nothing else
// is allowed to run, so text from a feed could not execute even if it slipped
// past the escaping in the page.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https: data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

function securityHeaders(isProduction) {
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    // Tells browsers to use https only. Sent on the live site, not on a laptop (which has no https).
    if (isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  };
}

// Allows `max` requests per `windowMs` from one address, then answers 429 until
// the window ends. On a developer's machine (not production) requests from the
// machine itself are not counted.
function rateLimit({ windowMs, max, isProduction, only = () => true }) {
  const hits = new Map(); // address -> { count, resetAt }
  setInterval(() => {
    const now = Date.now();
    for (const [key, h] of hits) if (h.resetAt <= now) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    if (!only(req)) return next();
    if (!isProduction && LOOPBACK.includes(req.socket.remoteAddress)) return next();
    const key = req.ip;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + windowMs };
      hits.set(key, h);
    }
    h.count++;
    if (h.count > max) {
      res.setHeader("Retry-After", Math.ceil((h.resetAt - now) / 1000));
      return res.status(429).json({ error: "Too many requests. Try again in a minute." });
    }
    next();
  };
}

// Who may see unpublished articles with ?preview=…
//  - anyone who sends the right ?key= (the PREVIEW_KEY setting), or
//  - the developer's own machine: not production, connected directly from the
//    same computer, and addressed as localhost.
// Everything else is refused, so a host set up without NODE_ENV=production
// still does not expose unpublished pieces.
function previewAllowed(req, { previewKey, isProduction }) {
  if (previewKey && req.query.key === previewKey) return true;
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  return !isProduction && LOOPBACK.includes(req.socket.remoteAddress) && !req.headers["x-forwarded-for"] && ["localhost", "127.0.0.1"].includes(host);
}

module.exports = { securityHeaders, rateLimit, previewAllowed };
