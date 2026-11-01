import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import type { Plugin } from 'vite';
import { buildApiReference, summarize, type ApiGroup } from './build';

const ENTRY = 'virtual:api-reference';
const GROUP = `${ENTRY}/group/`;
const SEARCH = `${ENTRY}/search`;
const RESOLVED = '\0';

/**
 * Serves the API reference from `api/openapi.yaml` as virtual modules, so the
 * 130k-line spec is read at build time and never shipped. The entry carries
 * only group names and counts; each group's operations, and the cross-group
 * search list, are their own chunks and load when a page asks for them.
 */
export function apiReference(specPath = 'api/openapi.yaml'): Plugin {
  const file = resolve(specPath);
  let cached: ApiGroup[] | undefined;
  const groups = () => (cached ??= buildApiReference(load(readFileSync(file, 'utf8'))));

  return {
    name: 'gregale-api-reference',
    resolveId(id) {
      return id === ENTRY || id.startsWith(`${ENTRY}/`) ? RESOLVED + id : undefined;
    },
    load(id) {
      if (!id.startsWith(RESOLVED + ENTRY)) return undefined;
      this.addWatchFile(file);
      const name = id.slice(RESOLVED.length);
      if (name === ENTRY) {
        const index = groups().map(({ id, title, description, operations }) => ({
          id,
          title,
          description,
          count: operations.length,
        }));
        const loaders = groups()
          .map(({ id }) => `  ${JSON.stringify(id)}: () => import(${JSON.stringify(GROUP + id)}),`)
          .join('\n');
        return [
          `export const groups = ${JSON.stringify(index)};`,
          `const loaders = {\n${loaders}\n};`,
          'export function loadGroup(id) {',
          '  const load = Object.hasOwn(loaders, id) ? loaders[id] : undefined;',
          '  return load ? load().then((m) => m.default) : Promise.resolve(undefined);',
          '}',
          `export function loadSearch() { return import(${JSON.stringify(SEARCH)}).then((m) => m.default); }`,
        ].join('\n');
      }
      if (name === SEARCH) return `export default ${JSON.stringify(summarize(groups()))};`;
      if (name.startsWith(GROUP)) {
        const group = groups().find((g) => g.id === name.slice(GROUP.length));
        return `export default ${JSON.stringify(group ?? null)};`;
      }
      return undefined;
    },
    handleHotUpdate({ file: changed, server }) {
      if (changed !== file) return;
      cached = undefined;
      for (const module of server.moduleGraph.idToModuleMap.values()) {
        if (module.id?.startsWith(RESOLVED + ENTRY)) server.moduleGraph.invalidateModule(module);
      }
    },
  };
}
