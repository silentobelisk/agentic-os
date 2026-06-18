import Header from "@/components/Header";
import Profile from "@/components/Profile";
import Terminal from "@/components/Terminal";
import UsagePanel from "@/components/UsagePanel";
import SkillsRail from "@/components/SkillsRail";
import SocialBoard from "@/components/SocialBoard";
import IndustryBoard from "@/components/IndustryBoard";
import Onboarding from "@/components/Onboarding";
import { ensureLoaded } from "@/lib/transcripts";
import { isOnboarded } from "@/lib/profile-store";

// Render per request: the first-run gate below reads ~/.nerve-center from disk,
// which is NOT a dynamic signal to Next — without this the page would be
// statically prerendered at build time and the onboarding/dashboard branch
// would freeze (an onboarded user would be stuck on the wizard forever).
export const dynamic = "force-dynamic";

export default function Page() {
  // First run: a new operator hasn't completed setup yet. Gate server-side so
  // un-onboarded users never receive dashboard HTML (no flash of the console
  // before the wizard mounts). isOnboarded() is a synchronous node:fs read.
  if (!isOnboarded()) return <Onboarding />;

  // Warm the transcript cache as soon as the page is requested so the
  // client's /api/usage and /api/skills fetches resolve fast.
  void ensureLoaded().catch(() => {});

  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 py-6 sm:px-6 sm:py-9">
      <Header />
      <Profile />
      <Terminal />
      <UsagePanel />
      <SkillsRail />
      <SocialBoard />
      <IndustryBoard />
    </main>
  );
}
