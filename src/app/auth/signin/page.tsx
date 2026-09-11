import { SignInPrompt } from '@/components/auth/SignInPrompt';

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl } = await searchParams;
  return <SignInPrompt redirectTo={callbackUrl ?? '/'} />;
}
