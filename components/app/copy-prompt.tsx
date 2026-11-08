'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** One prompt to paste into any coding agent, with a copy button. */
export function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="text-caption font-medium text-fg-3">Paste into Claude Code, Codex, Cursor, OpenCode or any agent that can fetch a URL</span>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy prompt'}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-words px-4 py-4 font-sans text-body leading-relaxed text-fg">{text}</pre>
    </div>
  );
}
