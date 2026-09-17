import { NextResponse, type NextRequest } from "next/server";

const MIN_PASSWORD_LENGTH = 16;

/** Compares every character, so response time does not reveal how much of a guess was right. */
function safeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/** Basic auth on every page and API route: the backoffice shows every client's prompts and usage. */
export function middleware(request: NextRequest) {
  const user = process.env.BACKOFFICE_USER;
  const password = process.env.BACKOFFICE_PASSWORD;
  if (!user || !password || password.length < MIN_PASSWORD_LENGTH) {
    return new NextResponse(`Configura BACKOFFICE_USER y BACKOFFICE_PASSWORD (mínimo ${MIN_PASSWORD_LENGTH} caracteres).`, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice("Basic ".length));
      const separator = decoded.indexOf(":");
      if (separator > 0 && safeEqual(decoded.slice(0, separator), user) && safeEqual(decoded.slice(separator + 1), password)) {
        return NextResponse.next();
      }
    } catch {
      // A malformed header gets the same challenge as a wrong password.
    }
  }
  return new NextResponse("Acceso restringido", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Pulso backoffice", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
