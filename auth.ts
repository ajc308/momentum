import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

export const { handlers, signIn, signOut, auth } = NextAuth({
  // F-13: explicit trustHost so the v5 host-check is predictable behind
  // Vercel/proxies; also documented secret source rather than implicit.
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const allowedEmail = process.env.ALLOWED_EMAIL
      if (!allowedEmail) {
        console.error('ALLOWED_EMAIL env var is not set — denying all logins')
        return false
      }
      if (user.email !== allowedEmail) {
        // F-07: do not log any portion of the rejected email — even a
        // 3-char prefix can fingerprint repeat attackers across logs.
        console.warn('Unauthorized login attempt rejected')
        return false
      }
      return true
    },
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub
      }
      return session
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id
      }
      return token
    },
  },
  pages: {
    signIn: '/login',
    // Show sign-in failures on the login page (?error=...) instead of the
    // bare Auth.js error page.
    error: '/login',
  },
  session: {
    strategy: "jwt",
  },
  // F-13: pin cookie options explicitly so version drift cannot loosen
  // them silently. NextAuth v5 already uses these defaults in prod, but
  // pinning makes the intent reviewable.
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-authjs.session-token'
          : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
})
