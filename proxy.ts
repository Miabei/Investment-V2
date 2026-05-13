import { NextRequest, NextResponse } from 'next/server';

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow login page and Next.js internals through
  if (pathname.startsWith('/login')) return NextResponse.next();

  const secret = process.env.APP_SECRET;
  const session = req.cookies.get('session')?.value;

  if (secret && session === secret) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|api/health).*)',
  ],
};
