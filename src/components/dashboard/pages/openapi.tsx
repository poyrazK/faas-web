import { OpenAPIImport } from '@/components/dashboard/openapi-import';
import { OpenAPIRoutePreview } from '@/components/dashboard/openapi-route-preview';

export function OpenAPIBody({ slug }: { slug: string }) {
  // Keyed on the app: a pasted document, its preview and the chosen
  // deployment all belong to one app and must not survive a switch.
  return (
    <div className="flex flex-col gap-6" key={slug}>
      <OpenAPIRoutePreview slug={slug} />
      <OpenAPIImport slug={slug} />
    </div>
  );
}
