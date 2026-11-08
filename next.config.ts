import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: [
    'better-sqlite3',
    '@grpc/grpc-js',
    '@protobuf-ts/grpc-transport',
    '@mysten-incubation/memwal',
    'mppx',
    '@suimpp/mpp',
  ],
  poweredByHeader: false,
  redirects() {
    // Agent pages became profile dossiers, shared by agents and people.
    return [{ source: '/a/:handle', destination: '/p/:handle', permanent: true }];
  },
  turbopack: { root: import.meta.dirname },
};

export default config;
