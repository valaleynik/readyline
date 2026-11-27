/** Agency membership calls. All access rules live in the database and the edge function. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearnerSummary } from "../../src/agency/summary";

export interface Membership {
  orgId: string;
  orgName: string;
  role: "manager" | "learner";
}

export interface AgencyView {
  id: string;
  name: string;
  seats: number;
  joinCode: string;
  learners: LearnerSummary[];
}

/** What the study app needs to know about the account. Absent in local-only mode. */
export interface Account {
  memberships: Membership[];
  join(code: string): Promise<string | null>;
  leave(orgId: string): Promise<string | null>;
}

export async function loadMemberships(db: SupabaseClient, userId: string): Promise<Membership[]> {
  const { data, error } = await db.from("memberships").select("org_id, role, organizations(name)").eq("user_id", userId);
  if (error) return [];
  return (data as unknown as { org_id: string; role: "manager" | "learner"; organizations: { name: string } | null }[]).map((m) => ({
    orgId: m.org_id,
    orgName: m.organizations?.name ?? "Your agency",
    role: m.role,
  }));
}

export async function joinAgency(db: SupabaseClient, code: string): Promise<string | null> {
  const { error } = await db.rpc("redeem_join_code", { code });
  return error ? error.message : null;
}

export async function leaveAgency(db: SupabaseClient, userId: string, orgId: string): Promise<string | null> {
  const { error } = await db.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId).eq("role", "learner");
  return error ? error.message : null;
}

export async function loadDashboard(db: SupabaseClient): Promise<{ agencies: AgencyView[] } | { error: string }> {
  const { data, error } = await db.functions.invoke("agency-dashboard", { method: "POST" });
  if (error) {
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) return { error: body.error };
    } catch {
      /* fall through */
    }
    return { error: error.message };
  }
  return data as { agencies: AgencyView[] };
}

export async function rotateCode(db: SupabaseClient, orgId: string): Promise<string | null> {
  const { error } = await db.rpc("rotate_join_code", { org: orgId });
  return error ? error.message : null;
}

export async function removeLearner(db: SupabaseClient, orgId: string, userId: string): Promise<string | null> {
  const { error } = await db.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId).eq("role", "learner");
  return error ? error.message : null;
}
