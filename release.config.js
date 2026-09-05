export default {
  branches: [
    { name: 'prod', channel: 'latest' },
    { name: 'staging', prerelease: 'beta', channel: 'beta' },
  ],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/npm',
    '@semantic-release/github',
  ],
};
