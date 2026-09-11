import { AboutSection } from '@/components/home/AboutSection';
import { FeaturesGrid } from '@/components/home/FeaturesGrid';
import { HeroSection } from '@/components/home/HeroSection';
import { HowItWorks } from '@/components/home/HowItWorks';
import { SignInPrompt } from '@/components/auth/SignInPrompt';
import { isPublicHomepageEnabled } from '@/lib/config/instance-mode';

export default function Home() {
  if (!isPublicHomepageEnabled()) {
    return <SignInPrompt description="This is a private Skynest instance." />;
  }

  return (
    <div className="space-y-16">
      <HeroSection />
      <FeaturesGrid />
      <AboutSection />
      <HowItWorks />
    </div>
  );
}
