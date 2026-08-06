const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zuot-shenqi.aurora-sage-9435.chatgpt.site";

export function GET() {
  const body = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/
Sitemap: ${siteUrl}/sitemap.xml
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
