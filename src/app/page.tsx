import { AboutSection } from '@/components/home/AboutSection';
import { FeaturesGrid } from '@/components/home/FeaturesGrid';
import { HeroSection } from '@/components/home/HeroSection';
import { HowItWorks } from '@/components/home/HowItWorks';

export default function Home() {
  return (
    <div className="space-y-16">
      <HeroSection />
      <FeaturesGrid />
      <AboutSection />
      <HowItWorks />
    </div>
  );
}
