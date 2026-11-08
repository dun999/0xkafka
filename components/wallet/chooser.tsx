'use client';

import { ConnectModal } from '@mysten/dapp-kit-react/ui';
import { useEffect, useRef } from 'react';
import { getKit } from './kit';

/**
 * The wallet chooser. Loaded only in the browser (next/dynamic, ssr: false).
 * Calls `onConnected` with the address once a wallet connects while it's open,
 * and `onDismiss` if the person closes it without connecting.
 */
export default function WalletChooser({ open, onConnected, onDismiss }: { open: boolean; onConnected: (address: string) => void; onDismiss: () => void }) {
  const kit = getKit();
  const ref = useRef<HTMLElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!open) return;
    done.current = false;
    const c = kit.stores.$connection.get();
    if (c.isConnected && c.account) {
      done.current = true;
      onConnected(c.account.address);
      return;
    }
    return kit.stores.$connection.subscribe((conn) => {
      if (!done.current && conn.isConnected && conn.account) {
        done.current = true;
        onConnected(conn.account.address);
      }
    });
  }, [open, kit, onConnected]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const closed = () => {
      if (!done.current) onDismiss();
    };
    el.addEventListener('closed', closed);
    return () => el.removeEventListener('closed', closed);
  }, [onDismiss]);

  return <ConnectModal ref={ref as never} instance={kit} open={open} />;
}
