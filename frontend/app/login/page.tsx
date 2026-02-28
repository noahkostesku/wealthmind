"use client";

import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 max-w-sm w-full px-6">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            WealthMind
          </h1>
          <p className="text-sm text-zinc-500 text-center">
            Financial intelligence for Wealthsimple clients
          </p>
        </div>

        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors cursor-pointer"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
