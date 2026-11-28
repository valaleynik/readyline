// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import AuthScreen, { friendlyAuthError, linkErrorFromUrl, passwordProblem, type AuthApi } from "../web/components/AuthScreen";

afterEach(cleanup);

function fakeApi(over: Partial<AuthApi> = {}) {
  const calls: string[] = [];
  const api: AuthApi = {
    signIn: async (e, p) => (calls.push(`signIn ${e}`), p === "right-password" ? { error: null } : { error: "Email or password is wrong." }),
    signUp: async (e) => (calls.push(`signUp ${e}`), e === "taken@x.com" ? { error: null, exists: true } : { error: null }),
    resendConfirm: async (e) => (calls.push(`resend ${e}`), null),
    forgot: async (e) => (calls.push(`forgot ${e}`), null),
    setPassword: async () => (calls.push("setPassword"), null),
    ...over,
  };
  return { api, calls };
}
const type = (label: RegExp | string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const press = async (name: string) => act(async () => { fireEvent.click(screen.getByRole("button", { name })); });

describe("accounts", () => {
  it("signs in, and says plainly when the password is wrong", async () => {
    const { api, calls } = fakeApi();
    render(<AuthScreen api={api} />);
    type("Email", " val@x.com ");
    type("Password", "nope");
    await press("Sign in");
    expect(screen.getByText(/Email or password is wrong/)).not.toBeNull();
    type("Password", "right-password");
    await press("Sign in");
    expect(calls).toEqual(["signIn val@x.com", "signIn val@x.com"]);
  });

  it("creates an account: weak passwords are stopped before sending, then 'check your email' with a resend wait", async () => {
    const { api, calls } = fakeApi();
    render(<AuthScreen api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    type("Email", "new@x.com");
    type("Password", "short");
    expect(screen.getByText(/Use at least 8 characters/)).not.toBeNull();
    await press("Create account");
    expect(calls).toEqual([]);
    type("Password", "password");
    expect(screen.getByText(/too easy to guess/)).not.toBeNull();
    type("Password", "a good long one");
    await press("Create account");
    expect(screen.getByText("Check your email")).not.toBeNull();
    expect(screen.getByText(/finish creating your account/)).not.toBeNull();
    expect((screen.getByRole("button", { name: /Send again in \d+s/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toEqual(["signUp new@x.com"]);
  });

  it("an email that already has an account goes back to sign in with a hint", async () => {
    const { api } = fakeApi();
    render(<AuthScreen api={api} initialMode="signup" />);
    type("Email", "taken@x.com");
    type("Password", "a good long one");
    await press("Create account");
    expect(screen.getByRole("heading", { name: "Sign in" })).not.toBeNull();
    expect(screen.getByText(/already exists/)).not.toBeNull();
  });

  it("signing in before confirming offers to resend the confirmation", async () => {
    const { api, calls } = fakeApi({ signIn: async () => ({ error: null, unconfirmed: true }) });
    render(<AuthScreen api={api} />);
    type("Email", "new@x.com");
    type("Password", "whatever123");
    await press("Sign in");
    expect(screen.getByText(/Confirm your email first/)).not.toBeNull();
    await press("Send the link again");
    expect(calls).toContain("resend new@x.com");
  });

  it("forgot password sends a reset link; the reset screen saves a new one", async () => {
    const { api, calls } = fakeApi();
    const r = render(<AuthScreen api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Forgot your password?" }));
    type("Email", "val@x.com");
    await press("Email me a reset link");
    expect(screen.getByText(/set a new password/)).not.toBeNull();
    r.unmount();
    render(<AuthScreen api={api} initialMode="reset" />);
    type("New password", "short");
    await press("Save password");
    expect(calls).not.toContain("setPassword");
    type("New password", "a brand new one");
    await press("Save password");
    expect(calls).toEqual(["forgot val@x.com", "setPassword"]);
  });

  it("show/hide password, and failed links and developer errors in plain words", async () => {
    const { api } = fakeApi();
    render(<AuthScreen api={api} linkError={linkErrorFromUrl("#error=access_denied&error_code=otp_expired", "")} />);
    expect(screen.getByText(/That link expired/)).not.toBeNull();
    const pw = screen.getByLabelText("Password") as HTMLInputElement;
    expect(pw.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pw.type).toBe("text");
    expect(linkErrorFromUrl("#access_token=abc&type=recovery", "")).toBeNull();
    expect(friendlyAuthError("Invalid login credentials")).toBe("Email or password is wrong.");
    expect(friendlyAuthError("email rate limit exceeded")).toMatch(/Too many tries/);
    expect(friendlyAuthError("Password should be at least 6 characters")).toMatch(/at least 8/);
    expect(passwordProblem("aaaaaaaaaa")).toMatch(/easy/);
    expect(passwordProblem("correct horse")).toBeNull();
  });
});
