import { COMPARE_LINKS, FooterAnchor, type FooterLink } from '@/components/landing/footer';

/**
 * Links from every docs page to the product, pricing and comparison pages.
 *
 * The docs are the most crawled part of the site, and before this footer they
 * linked to none of these pages, so search engines reached them only from the
 * landing page and articles.
 */
export const DOCS_FOOTER_GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Pricing', href: '/pricing', publicRoute: '/pricing' },
      { label: 'Features', href: '/features', publicRoute: '/features' },
      { label: 'Solutions', href: '/solutions', publicRoute: '/solutions' },
      { label: 'Templates', href: '/templates', publicRoute: '/templates' },
      { label: 'Will it run?', href: '/will-it-run', publicRoute: '/will-it-run' },
      { label: 'Articles', href: '/articles', publicRoute: '/articles' },
    ],
  },
  {
    title: 'Pricing compared',
    links: [
      {
        label: 'Scale-to-zero pricing',
        href: '/articles/scale-to-zero-pricing-compared',
        article: 'scale-to-zero-pricing-compared',
      },
      {
        label: 'Free backend hosting tiers',
        href: '/articles/free-backend-hosting-tiers-compared',
        article: 'free-backend-hosting-tiers-compared',
      },
      {
        label: 'Managed Postgres pricing',
        href: '/articles/managed-postgres-pricing-compared',
        article: 'managed-postgres-pricing-compared',
      },
      {
        label: 'WebSockets on scale to zero',
        href: '/articles/websockets-scale-to-zero-platforms-compared',
        article: 'websockets-scale-to-zero-platforms-compared',
      },
      {
        label: 'Render vs Railway vs Fly.io',
        href: '/articles/render-vs-railway-vs-flyio',
        article: 'render-vs-railway-vs-flyio',
      },
    ],
  },
  { title: 'Compare', links: COMPARE_LINKS },
];

export function DocsFooter() {
  return (
    <footer className="docs-footer">
      <div className="docs-footer-inner">
        {DOCS_FOOTER_GROUPS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.links.map((link) => (
                <li key={link.href}>
                  <FooterAnchor link={link} />
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
