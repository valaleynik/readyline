"use client";
/**
import type React from "react";
 * Accounts with email and password. One email per person at sign-up (confirm the address) and
 * one per forgotten password; signing in costs no email.
 * The Supabase calls come in through `api`, so this screen is tested without a network.
 */
import { useEffect, useId, useState } from "react";
import { SiteHeader } from "./brand";

export type AuthMode = "signin" | "signup" | "forgot" | "confirm" | "reset-sent" | "reset";

export interface AuthApi {
  signIn(email: string, password: string): Promise<{ error: string | null; unconfirmed?: boolean }>;
  /** exists: an account with this email is already there */
  signUp(email: string, password: string): Promise<{ error: string | null; exists?: boolean }>;
  resendConfirm(email: string): Promise<string | null>;
  forgot(email: string): Promise<string | null>;
  /** sets the new password for the account signed in by the reset link */
  setPassword(password: string): Promise<string | null>;
}

export const MIN_PASSWORD = 8;
const RESEND_AFTER = 60;

/** Supabase's messages are for developers; these are for people. */
export function friendlyAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email or password is wrong.";
  if (m.includes("rate limit") || m.includes("security purposes") || m.includes("too many"))
    return "Too many tries. Wait a minute, then try again.";
  if (m.includes("password") && (m.includes("short") || m.includes("least") || m.includes("weak")))
    return `Use at least ${MIN_PASSWORD} characters.`;
  if (m.includes("same") && m.includes("password")) return "That's your current password. Choose a new one.";
  if (m.includes("invalid") && m.includes("email")) return "That email address doesn't look right.";
  if (m.includes("network") || m.includes("fetch")) return "Couldn't reach Readyline. Check your connection and try again.";
  return "Something went wrong. Try again in a minute.";
}

/** A link from an email that failed (expired, already used) comes back with an error in the URL. */
export function linkErrorFromUrl(hash: string, search: string): string | null {
  const p = new URLSearchParams((hash.startsWith("#") ? hash.slice(1) : hash) || search.replace(/^\?/, ""));
  const code = p.get("error_code") ?? p.get("error");
  if (!code) return null;
  if (code.includes("expired")) return "That link expired. Sign in to get a new confirmation link, or reset your password below.";
  return "That link didn't work. It may have been used already. Try signing in, or reset your password below.";
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (/^(.)\1+$/.test(pw) || ["password", "12345678", "123456789", "qwertyui", "readyline"].includes(pw.toLowerCase()))
    return "That password is too easy to guess.";
  return null;
}

function useCountdown() {
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  return [wait, () => setWait(RESEND_AFTER)] as const;
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className="rl-field">
      <label htmlFor={id}>{label}</label>
      <span className="au__pw">
        <input
          id={id}
          className="rl-input"
          type={show ? "text" : "password"}
          required
          autoComplete={autoComplete}
          value={value}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="au__show" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
          {show ? "Hide" : "Show"}
        </button>
      </span>
      {hint && (
        <span id={`${id}-hint`} className="au__hint">
          {hint}
        </span>
      )}
    </div>
  );
}

export default function AuthScreen({
  api,
  initialMode = "signin",
  linkError = null,
}: {
  api: AuthApi;
  initialMode?: AuthMode;
  linkError?: string | null;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, startWait] = useCountdown();
  const go = (m: AuthMode) => {
    setMode(m);
    setError(null);
    setInfo(null);
    setPassword("");
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const em = email.trim();

  const emailField = (
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
      />
    </label>
  );
  const err = error && <p className="rl-field__error au__error">▲ {error}</p>;

  let body: React.ReactNode;
  if (mode === "signin")
    body = (
      <>
        <h1 id="au-title" className="t-h3 au__title">
          Sign in
        </h1>
        <p className="au__lede">
          New to Readyline?{" "}
          <button className="link" onClick={() => go("signup")}>
            Create an account
          </button>
        </p>
        {linkError && <p className="au__banner">▲ {linkError}</p>}
        <form
          className="au__fields"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api.signIn(em, password);
              if (r.unconfirmed) {
                go("confirm");
                setInfo("Confirm your email first. We can send the link again.");
              } else if (r.error) setError(r.error);
            });
          }}
        >
          {emailField}
          <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          {err}
          <button className="rl-btn rl-btn--primary au__submit" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="au__alt">
          <button className="link" onClick={() => go("forgot")}>
            Forgot your password?
          </button>
        </p>
      </>
    );
  else if (mode === "signup") {
    const problem = password ? passwordProblem(password) : null;
    body = (
      <>
        <h1 id="au-title" className="t-h3 au__title">
          Create your account
        </h1>
        <p className="au__lede">
          Already have one?{" "}
          <button className="link" onClick={() => go("signin")}>
            Sign in
          </button>
        </p>
        <form
          className="au__fields"
          onSubmit={(e) => {
            e.preventDefault();
            const p = passwordProblem(password);
            if (p) return setError(p);
            void run(async () => {
              const r = await api.signUp(em, password);
              if (r.exists) {
                go("signin");
                setError("An account with this email already exists. Sign in, or reset your password.");
              } else if (r.error) setError(r.error);
              else {
                go("confirm");
                startWait();
              }
            });
          }}
        >
          {emailField}
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={problem ?? `At least ${MIN_PASSWORD} characters.`}
          />
          {err}
          <button className="rl-btn rl-btn--primary au__submit" type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create account"}
          </button>
        </form>
        <p className="rl-muted au__alt">Studying with an agency? Create your account first; you'll enter your agency code next.</p>
      </>
    );
  } else if (mode === "forgot")
    body = (
      <>
        <h1 id="au-title" className="t-h3 au__title">
          Reset your password
        </h1>
        <p className="au__lede">We'll email you a link to set a new one.</p>
        {linkError && <p className="au__banner">▲ {linkError}</p>}
        <form
          className="au__fields"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const e2 = await api.forgot(em);
              if (e2) setError(e2);
              else {
                go("reset-sent");
                startWait();
              }
            });
          }}
        >
          {emailField}
          {err}
          <button className="rl-btn rl-btn--primary au__submit" type="submit" disabled={busy}>
            {busy ? "Sending..." : "Email me a reset link"}
          </button>
        </form>
        <p className="au__alt">
          <button className="link" onClick={() => go("signin")}>
            Back to sign in
          </button>
        </p>
      </>
    );
  else if (mode === "confirm" || mode === "reset-sent")
    body = (
      <>
        <h1 id="au-title" className="t-h3 au__title">
          Check your email
        </h1>
        <p className="au__lede">
          {mode === "confirm" ? "To finish creating your account, open the link we sent to " : "We sent a link to set a new password to "}
          <strong>{em}</strong>. It works for one hour.
        </p>
        {info && <p className="au__banner">{info}</p>}
        <p className="rl-muted">Not there? Check spam, or the Promotions tab in Gmail. It comes from noreply@readylineprep.com.</p>
        {err}
        <div className="au__actions">
          <button
            className="rl-btn rl-btn--secondary"
            disabled={wait > 0 || busy}
            onClick={() =>
              run(async () => {
                const e2 = mode === "confirm" ? await api.resendConfirm(em) : await api.forgot(em);
                if (e2) setError(e2);
                else startWait();
              })
            }
          >
            {wait > 0 ? `Send again in ${wait}s` : "Send the link again"}
          </button>
          <button className="rl-btn rl-btn--ghost" onClick={() => go(mode === "confirm" ? "signup" : "forgot")}>
            Use a different email
          </button>
        </div>
      </>
    );
  else
    body = (
      <>
        <h1 id="au-title" className="t-h3 au__title">
          Set a new password
        </h1>
        <p className="au__lede">You'll stay signed in on this device.</p>
        <form
          className="au__fields"
          onSubmit={(e) => {
            e.preventDefault();
            const p = passwordProblem(password);
            if (p) return setError(p);
            void run(async () => {
              const e2 = await api.setPassword(password);
              if (e2) setError(e2);
            });
          }}
        >
          <PasswordField
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={(password && passwordProblem(password)) || `At least ${MIN_PASSWORD} characters.`}
          />
          {err}
          <button className="rl-btn rl-btn--primary au__submit" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save password"}
          </button>
        </form>
      </>
    );

  return (
    <div className="app">
      <SiteHeader />
      <main className="si">
        <section className="si__form" aria-labelledby="au-title">
          {body}
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
