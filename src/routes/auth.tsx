import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMyAccess, bootstrapClaimAdmin } from "@/lib/admin.functions";
import { Button, Card, Field, Input, Badge } from "@/components/ui";
import { Loader2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Master Control — Sign in" },
      { name: "description", content: "Private multi-store e-commerce admin panel. Authorized access only." },
      { property: "og:title", content: "Master Control — Sign in" },
      { property: "og:description", content: "Private multi-store e-commerce admin panel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Phase = "form" | "checking" | "unauthorized";

function AuthPage() {
  const navigate = useNavigate();
  const getMyAccessFn = useServerFn(getMyAccess);
  const claimFn = useServerFn(bootstrapClaimAdmin);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");

  async function afterSignIn() {
    setPhase("checking");
    const access = await getMyAccessFn();
    if (access.isAdmin) {
      await navigate({ to: "/", replace: true });
      return;
    }
    // Bootstrap: the very first account may claim owner-admin while none exists
    const claim = await claimFn();
    if (claim.claimed) {
      await navigate({ to: "/", replace: true });
      return;
    }
    setPhase("unauthorized");
    await supabase.auth.signOut();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError(err.message === "Invalid login credentials" ? "Invalid email or password." : err.message);
      return;
    }
    try {
      await afterSignIn();
    } catch (ex) {
      setError((ex as Error).message);
      setPhase("form");
    }
  }

  return (
    <div className="surface-glow flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Master Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">Private multi-store admin panel</p>
        </div>

        {phase === "unauthorized" ? (
          <Card className="p-6 text-center">
            <Badge variant="danger" className="mx-auto">ACCESS NOT AUTHORIZED</Badge>
            <p className="mt-3 text-sm text-muted-foreground">
              This account is signed in but is not an authorized admin. Ask the panel owner to grant access, then sign in again.
            </p>
            <Button className="mt-5 w-full" onClick={() => setPhase("form")}>
              Back to sign in
            </Button>
          </Card>
        ) : (
          <Card className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" autoComplete="email" />
              </Field>
              <Field label="Password">
                <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </Field>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" loading={busy}>
                Sign in
              </Button>
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Admin accounts are created by the owner. There is no public sign-up.
            </p>
          </Card>
        )}

        {phase === "checking" ? (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verifying authorization…
          </div>
        ) : null}
      </div>
    </div>
  );
}
