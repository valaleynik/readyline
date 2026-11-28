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
import { SiteHeader } from "./brand";
import { supabase, syncedStore } from "../lib/sync";
import { joinAgency, leaveAgency, loadDashboard, loadMemberships, removeLearner, rotateCode, type Account, type Membership } from "../lib/agency";
import type { ExportedBank } from "../../src/content/export";

// Read a failed-link error before the Supabase client starts: it cleans the URL as it loads.
const initialLinkError = typeof window === "undefined" ? null : linkErrorFromUrl(window.location.hash, window.location.search);

export default function AuthGate({ data, view = "study" }: { data: ExportedBank; view?: "study" | "agency" }) {
  const db = useMemo(() => supabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!db);

  useEffect(() => {
    if (!db) return;
    // Never leave the page blank: a failed link makes getSession reject, and a slow network can
    // stall it. Either way, fall back to the sign-in screen.
    const giveUp = setTimeout(() => setReady(true), 5000);
    db.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => {
        clearTimeout(giveUp);
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
  if (!session || !store)
    return (
      <SignIn
        onSend={(email) => sendLink(db, email)}
        linkError={initialLinkError}
      />
    );
  const accountLinks = (
    <>
      {view === "agency" ? <a href="/">Study</a> : manages ? <a href="/agency">Agency dashboard</a> : null}
      <span>{session.user.email}</span>
      <button className="link" onClick={() => db.auth.signOut()}>
        Sign out
      </button>
    </>
  );
  return (
    <>
      {view === "agency" ? (
        <div className="app">
          <SiteHeader>{accountLinks}</SiteHeader>
          <main className="main">
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
        <StudyApp key={userId} data={data} store={store} account={account} headerExtra={accountLinks} />
      )}
    </>
  );
}

async function sendLink(db: NonNullable<ReturnType<typeof supabase>>, email: string): Promise<string | null> {
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: globalThis.location?.origin },
  });
  return error ? friendlyAuthError(error.message) : null;
}

/** Supabase's messages are for developers; these are for people. */
export function friendlyAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("rate limit") || m.includes("security purposes") || m.includes("too many"))
    return "Too many links requested. Wait a minute, then try again.";
  if (m.includes("invalid") && m.includes("email")) return "That email address doesn't look right.";
  if (m.includes("network") || m.includes("fetch")) return "Couldn't reach Readyline. Check your connection and try again.";
  return "Something went wrong sending your link. Try again in a minute.";
}

/** A sign-in link that failed (expired, already used) comes back with an error in the URL. */
export function linkErrorFromUrl(hash: string, search: string): string | null {
  const p = new URLSearchParams((hash.startsWith("#") ? hash.slice(1) : hash) || search.replace(/^\?/, ""));
  const code = p.get("error_code") ?? p.get("error");
  if (!code) return null;
  if (code.includes("expired")) return "That link expired. Links work for one hour; send yourself a new one.";
  return "That link didn't work. It may have been used already. Send yourself a new one.";
}

const RESEND_AFTER = 60;

export function SignIn({ onSend, linkError = null }: { onSend: (email: string) => Promise<string | null>; linkError?: string | null }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send() {
    setState("sending");
    const err = await onSend(email.trim());
    setError(err);
    setState(err ? "idle" : "sent");
    if (!err) setWait(RESEND_AFTER);
  }

  return (
    <div className="app">
      <SiteHeader />
      <main className="si">
        <section className="si__form" aria-labelledby="si-title">
          {state === "sent" ? (
            <>
              <h1 id="si-title" className="t-h3 si__title">
                Check your email
              </h1>
              <p className="si__lede">
                We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on the device you want to study on. It works for one hour.
              </p>
              <p className="rl-muted">Not there? Check spam, or the Promotions tab in Gmail. It comes from noreply@readylineprep.com.</p>
              {error && <p className="rl-field__error si__error">▲ {error}</p>}
              <div className="si__actions">
                <button className="rl-btn rl-btn--secondary" disabled={wait > 0 || state !== "sent"} onClick={send}>
                  {wait > 0 ? `Send again in ${wait}s` : "Send the link again"}
                </button>
                <button
                  className="rl-btn rl-btn--ghost"
                  onClick={() => {
                    setState("idle");
                    setError(null);
                  }}
                >
                  Use a different email
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 id="si-title" className="t-h3 si__title">
                Sign in to Readyline
              </h1>
              <p className="si__lede">New here? The same link creates your account. No password to remember.</p>
              {linkError && <p className="si__banner">▲ {linkError}</p>}
              <form
                className="si__fields"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label className="rl-field">
                  Email
                  <input
                    className="rl-input"
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoFocus
                  />
                  {error && <span className="rl-field__error">▲ {error}</span>}
                </label>
                <button className="rl-btn rl-btn--primary si__submit" type="submit" disabled={state === "sending"}>
                  {state === "sending" ? "Sending..." : "Email me a sign-in link"}
                </button>
              </form>
              <p className="rl-muted si__fine">
                Studying with an agency? Sign in first; you'll enter your agency code next.
              </p>
            </>
          )}
        </section>
        <aside className="si__proof" aria-hidden="true">
          <div className="rl-card si__q">
            <p className="rl-overline">State law · Review</p>
            <p className="si__stem">A person collects premiums for an out-of-state insurer but never sells a policy. Under New Jersey law, this is:</p>
            <div className="rl-option rl-option--correct si__opt">
              <span className="rl-option__key">✓</span>
              <span>Prohibited: receiving premiums is transacting insurance</span>
            </div>
            <p className="si__cite">N.J.S.A. 17B:17-13 · quoted from the statute</p>
          </div>
          <div className="rl-card si__chance">
            <p className="rl-overline">Pass chance on exam day</p>
            <p className="si__big">Not yet</p>
            <p className="rl-muted">Unlocks when your own answers back it up. No number on day one.</p>
          </div>
        </aside>
      </main>
    </div>
  );
}
