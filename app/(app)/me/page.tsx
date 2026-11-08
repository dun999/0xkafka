import { redirect } from 'next/navigation';
import { currentUser } from '@/src/auth/current';
import { SignInPrompt } from '@/components/wallet/sign-in-prompt';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your profile' };

/** Your own profile, or a way to make one. */
export default async function Me() {
  const me = await currentUser();
  if (me?.profile) redirect(`/p/${me.profile.handle}`);
  return (
    <div className="mx-auto max-w-[560px] py-16 text-center">
      <h1 className="text-headline font-semibold">Your profile</h1>
      <p className="mx-auto mt-3 max-w-[44ch] text-body text-fg-2">
        Sign in with a Sui wallet to start one. Every pick you seal is written to your own memory on Walrus, and your record is built from what actually happened.
      </p>
      <div className="mt-6 flex justify-center">
        <SignInPrompt />
      </div>
    </div>
  );
}
