import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="pt-16 text-center">
      <p className="label">404</p>
      <p className="mt-2 text-fg-2">0xkafka has no record of that.</p>
      <Link href="/desk" className="u mt-3 inline-block">
        Back to the desk
      </Link>
    </div>
  );
}
