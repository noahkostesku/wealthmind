import { withAuth } from "next-auth/middleware";

export default withAuth(
  function middleware() {
    // auth check — redirect is handled by withAuth
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon).*)"],
};
