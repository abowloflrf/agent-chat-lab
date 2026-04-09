"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
      } else {
        const data = await res.json();
        setError(data.error || "认证失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-md bg-[var(--background)]/80">
      <form
        onSubmit={handleSubmit}
        className="glass-panel w-80 rounded-xl border border-[var(--border)] p-6 shadow-lg rise-in"
      >
        <h2 className="text-base font-medium mb-1">Agent Chat Lab</h2>
        <p className="text-[var(--muted)] text-xs mb-4">请输入密码以继续</p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          autoFocus
          className="w-full rounded-lg border border-[var(--border)] bg-white/60 px-3 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors"
        />

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !password}
          className="mt-4 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {submitting ? "验证中..." : "确认"}
        </button>
      </form>
    </div>
  );
}
