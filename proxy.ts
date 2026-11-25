import { clerkMiddleware } from "@clerk/nextjs/server";

// Convex's client talks to the deployment over HTTPS and a WebSocket; allow
// exactly that origin in the Content-Security-Policy, nothing broader.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexOrigins = convexUrl
  ? [new URL(convexUrl).origin, new URL(convexUrl).origin.replace(/^http/, "ws")]
  : [];

/**
 * Clerk runs on every request so server components can read the session, and
 * adds a Clerk-compatible CSP. Pages that need an account check it themselves
 * (app/(board)/layout.tsx); the data behind them is guarded again in Convex.
 */
export default clerkMiddleware({
  contentSecurityPolicy: {
    directives: {
      "connect-src": convexOrigins,
      // Clerk's components draw some decoration as inline SVG images. A data: image
      // can't run script or reach the network, so this widens nothing that matters.
      "img-src": ["data:"],
      "frame-ancestors": ["'none'"],
      "form-action": ["'self'"],
      "base-uri": ["'self'"],
      "object-src": ["'none'"],
    },
  },
});

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
