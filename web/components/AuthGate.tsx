"use client";
/**
 * Account gate. With Supabase configured: email and password accounts (AuthScreen), then the
 * study area on the synced store for that user. Without it: the study area on local storage.
 */
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import StudyApp from "./StudyApp";
import AgencyDashboard from "./AgencyDashboard";
import { SiteHeader } from "./brand";
import { supabase, syncedStore } from "../lib/sync";
import { joinAgency, leaveAgency, loadDashboard, loadMemberships, removeLearner, rotateCode, type Account, type Membership } from "../lib/agency";
import type { ExportedBank } from "../../src/content/export";
import AuthScreen, { friendlyAuthError, linkErrorFromUrl, type AuthApi } from "./AuthScreen";
import type { SupabaseClient } from "@supabase/supabase-js";

function authApi(db: SupabaseClient): AuthApi {
  const back = () => globalThis.location?.origin;
  return {
    async signIn(email, password) {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (!error) return { error: null };
      if (/not confirmed/i.test(error.message)) return { error: null, unconfirmed: true };
      return { error: friendlyAuthError(error.message) };
    },
    async signUp(email, password) {
      const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: back() } });
      if (error) return /already registered/i.test(error.message) ? { error: null, exists: true } : { error: friendlyAuthError(error.message) };
      // With email confirmation on, an existing address comes back as a user with no identities.
      if (data.user && data.user.identities?.length === 0) return { error: null, exists: true };
      return { error: null };
    },
    async resendConfirm(email) {
      const { error } = await db.auth.resend({ type: "signup", email, options: { emailRedirectTo: back() } });
      return error ? friendlyAuthError(error.message) : null;
    },
    async forgot(email) {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: back() });
      return error ? friendlyAuthError(error.message) : null;
    },
    async setPassword(password) {
      const { error } = await db.auth.updateUser({ password });
      return error ? friendlyAuthError(error.message) : null;
    },
  };
}

// Read a failed-link error before the Supabase client starts: it cleans the URL as it loads.
const initialLinkError = typeof window === "undefined" ? null : linkErrorFromUrl(window.location.hash, window.location.search);

export default function AuthGate({ data, view = "study" }: { data: ExportedBank; view?: "study" | "agency" }) {
  const db = useMemo(() => supabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!db);
  /** opened from a reset-password email: ask for the new password before anything else */
  const [recovering, setRecovering] = useState(false);
  const api = useMemo(() => (db ? authApi(db) : null), [db]);

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
    const { data: sub } = db.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
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
  if (recovering && api)
    return (
      <AuthScreen
        api={{ ...api, setPassword: async (pw) => { const e = await api.setPassword(pw); if (!e) setRecovering(false); return e; } }}
        initialMode="reset"
      />
    );
  if (!session || !store) return <AuthScreen api={api!} linkError={initialLinkError} />;
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
