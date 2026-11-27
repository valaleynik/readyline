"use client";
/**
 * Sign-in gate. With Supabase configured: email link sign-in, then the study app on the
 * synced store for that user. Without it: the study app on local storage.
 * Bare on purpose: the real signup screens come with onboarding.
 */
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import StudyApp from "./StudyApp";
import AgencyDashboard from "./AgencyDashboard";
import { supabase, syncedStore } from "../lib/sync";
import { joinAgency, leaveAgency, loadDashboard, loadMemberships, removeLearner, rotateCode, type Account, type Membership } from "../lib/agency";
import type { ExportedBank } from "../../src/content/export";

export default function AuthGate({ data, view = "study" }: { data: ExportedBank; view?: "study" | "agency" }) {
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
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const refreshMemberships = useMemo(
    () => async () => {
      if (db && userId) setMemberships(await loadMemberships(db, userId));
    },
    [db, userId],
  );
  useEffect(() => {
    void refreshMemberships();
  }, [refreshMemberships]);
  const account: Account | undefined = useMemo(
    () =>
      db && userId
        ? {
            memberships,
            join: async (code) => {
              const e = await joinAgency(db, code);
              await refreshMemberships();
              return e;
            },
            leave: async (orgId) => {
              const e = await leaveAgency(db, userId, orgId);
              await refreshMemberships();
              return e;
            },
          }
        : undefined,
    [db, userId, memberships, refreshMemberships],
  );
  const loadTeam = useMemo(() => () => loadDashboard(db!), [db]);
  const manages = memberships.some((m) => m.role === "manager");

  if (!db) return view === "agency" ? <p className="lede">Agency view needs an account.</p> : <StudyApp data={data} />;
  if (!ready) return null;
  if (!session || !store) return <SignIn onSend={(email) => sendLink(db, email)} />;
  return (
    <>
      <div className="account">
        {view === "agency" ? <a href="/">Study</a> : manages ? <a href="/agency">Agency dashboard</a> : null}
        <span>{session.user.email}</span>
        <button className="link" onClick={() => db.auth.signOut()}>
          Sign out
        </button>
      </div>
      {view === "agency" ? (
        <div className="app">
          <main>
            {manages ? (
              <AgencyDashboard
                load={loadTeam}
                onRotate={(org) => rotateCode(db, org)}
                onRemove={(org, uid) => removeLearner(db, org, uid)}
              />
            ) : (
              <p className="lede">This account doesn't manage an agency.</p>
            )}
          </main>
        </div>
      ) : (
        <StudyApp key={userId} data={data} store={store} account={account} />
      )}
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
