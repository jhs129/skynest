// Some MCP clients fall back to conventional root-level OAuth paths
// (/authorize, /token, /register) when they can't resolve endpoints via
// discovery metadata, rather than the /oauth/* paths this server advertises.
// Alias to the real implementation so either convention works.
export { GET } from '@/app/oauth/authorize/route';
