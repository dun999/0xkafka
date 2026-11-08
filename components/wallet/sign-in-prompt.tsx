'use client';

import { Button } from '@/components/ui/button';
import { useSession } from '@/components/wallet/session';

export function SignInPrompt() {
  const { me, signIn, status } = useSession();
  return (
    <Button variant="primary" size="lg" onClick={signIn} disabled={status === 'signing' || status === 'choosing'}>
      {status === 'signing' ? 'Check your wallet…' : me.address ? 'Pick your handle' : 'Sign in with a wallet'}
    </Button>
  );
}
