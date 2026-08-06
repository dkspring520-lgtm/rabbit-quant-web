const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zuot-shenqi.aurora-sage-9435.chatgpt.site";

export function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${siteUrl}/knowledge</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>${siteUrl}/pricing</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
