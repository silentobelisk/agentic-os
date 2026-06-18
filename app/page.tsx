import Header from "@/components/Header";
import Profile from "@/components/Profile";
import Terminal from "@/components/Terminal";
import UsagePanel from "@/components/UsagePanel";
import SkillsRail from "@/components/SkillsRail";
import SocialBoard from "@/components/SocialBoard";
import IndustryBoard from "@/components/IndustryBoard";
import { ensureLoaded } from "@/lib/transcripts";

export default function Page() {
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
