// Controls whether the public marketing/instructional pages (/, /faq, /docs)
// render their normal content or a bare sign-in prompt. A privately-deployed
// fork (e.g. an internal instance) doesn't want a discoverable page explaining
// how to connect to it — set PUBLIC_HOMEPAGE=false to hide that content behind
// the same sign-in used to access the MCP server.
export function isPublicHomepageEnabled(): boolean {
  return process.env.PUBLIC_HOMEPAGE !== 'false';
}
