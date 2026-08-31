/**
 * Preview apps are minted per pull request as `pr-{N}-{parent-slug}`
 * (githubd mints the slug; content/docs/preview-environments.md documents
 * it). The API's app row carries no preview flag, so the slug is the tell.
 */
export const isPreviewSlug = (slug: string) => /^pr-\d+-./.test(slug);
