import { readProfile, mergeProfile, toResponse, isOnboarded, CURRENT_ONBOARDING_VERSION, type StoredProfile } from "@/lib/profile-store";
import { getClaudeConfig, detectPlan } from "@/lib/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const resp = toResponse(readProfile());
  const acct = getClaudeConfig().oauthAccount || {};
  // Pre-fill the name from their Claude account so the profile feels connected
  // out of the box (until they type their own).
  if (!resp.name) resp.name = acct.displayName || "";
  const plan = detectPlan();
  return Response.json({
    ...resp,
    account: {
      email: acct.emailAddress || null,
      org: acct.organizationName || null,
      plan: plan.name,
      multiplier: plan.multiplier,
      memberSince: acct.accountCreatedAt || null,
    },
  });
}

export async function POST(request: Request) {
  let body: { name?: unknown; bio?: unknown; brainPath?: unknown; onboardingComplete?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body */
  }
  const patch: Partial<StoredProfile> = {};
  if (typeof body.name === "string") patch.name = body.name.slice(0, 80);
  if (typeof body.bio === "string") patch.bio = body.bio.slice(0, 240);
  if (typeof body.brainPath === "string") patch.brainPath = body.brainPath.slice(0, 1000);
  // Stamp the first-run completion server-side (client never supplies the time).
  const completing = body.onboardingComplete === true;
  if (completing) {
    patch.onboardedAt = Date.now();
    patch.onboardingVersion = CURRENT_ONBOARDING_VERSION;
  }
  const merged = mergeProfile(patch);
  // Confirm the completion actually persisted to disk (re-read), so a read-only
  // data dir surfaces as an error the wizard can show instead of a false success.
  if (completing && !isOnboarded()) {
    return Response.json({ ...toResponse(merged), onboardedAt: null }, { status: 500 });
  }
  return Response.json(toResponse(merged));
}
