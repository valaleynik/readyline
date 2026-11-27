"use client";
/**
 * Sign-in gate. With Supabase configured: email link sign-in, then the study app on the
 * synced store for that user. Without it: the study app on local storage.
 * Bare on purpose: the real signup screens come with onboarding.
 */
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import StudyApp from "./StudyApp";
import { supabase, syncedStore } from "../lib/sync";
import type { ExportedBank } from "../../src/content/export";

export default function AuthGate({ data }: { data: ExportedBank }) {
  const db = useMemo(() => supabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!db);

  useEffect(() => {
    if (!db) return;
    db.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [db]);

  const userId = session?.user.id;
  const store = useMemo(() => (db && userId ? syncedStore(db, userId) : undefined), [db, userId]);

  if (!db) return <StudyApp data={data} />;
  if (!ready) return null;
  if (!session || !store) return <SignIn onSend={(email) => sendLink(db, email)} />;
  return (
    <>
      <div className="account">
        <span>{session.user.email}</span>
        <button className="link" onClick={() => db.auth.signOut()}>
          Sign out
        </button>
      </div>
      <StudyApp key={userId} data={data} store={store} />
    </>
  );
}

async function sendLink(db: NonNullable<ReturnType<typeof supabase>>, email: string): Promise<string | null> {
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: globalThis.location?.origin },
  });
  return error ? error.message : null;
}

export function SignIn({ onSend }: { onSend: (email: string) => Promise<string | null> }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="app">
      <main>
        <section className="home">
          <h1>Sign in to Readyline</h1>
          {state === "sent" ? (
            <p className="lede">Check {email} for a sign-in link. Open it on this device.</p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setState("sending");
                const err = await onSend(email.trim());
                setError(err);
                setState(err ? "idle" : "sent");
              }}
            >
              <p className="lede">We'll email you a link. No password.</p>
              <label className="dateField">
                <span>Email</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="primary" type="submit" disabled={state === "sending"}>
                {state === "sending" ? "Sending..." : "Email me a sign-in link"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
