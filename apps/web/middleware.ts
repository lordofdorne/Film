import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps a session alive across navigations.
 *
 * Access tokens are short-lived and refresh tokens are single-use, so
 * something has to do the refresh and write the new pair back. A Server
 * Component cannot set cookies, which means a page that only reads the session
 * would let it quietly expire — and somebody would be signed out in the middle
 * of recording an interview.
 *
 * `getClaims()` rather than `getSession()`: it verifies the token's signature
 * rather than trusting what the browser sent, and on the way it refreshes an
 * expired session, which is what this exists for. It used to be `getUser()`,
 * which asked the auth server on every request — prefetches included — for
 * 200–535 ms each (see `sessionClaims` in src/server/auth.ts). Do nothing else here — middleware runs on every
 * matched request, and authorisation decisions belong next to the data they
 * protect, not in a file that is easy to forget when adding a route.
 */
export async function middleware(request: NextRequest) {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
  // Not configured: the app runs with no sign-in at all and says so on the
  // page. Nothing to refresh.
  if (url === "" || key === "") return NextResponse.next();

  const response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and media.
     *
     * `api/media` is excluded deliberately: it streams video, a page can pull
     * dozens of ranges from it, and refreshing a token on every byte range is
     * work for nothing. It does its own ownership check.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/media).*)",
  ],
};
