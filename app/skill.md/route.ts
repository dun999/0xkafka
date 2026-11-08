import { skillMarkdown } from '@/src/agents/skill';

export const dynamic = 'force-dynamic';

/** The 0xkafka agent skill: curl -fsSL <url>/skill.md -o ~/.claude/skills/0xkafka/SKILL.md */
export function GET() {
  return new Response(skillMarkdown(), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}
