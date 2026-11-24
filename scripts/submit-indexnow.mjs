import { indexNowKey } from './indexnow-key.mjs';

const origin = 'https://gregale.dev';
const publicRoute =
  /^\/(?:status|will-it-run|pricing|docs(?:\/[a-z0-9_-]+){0,2}|research(?:\/[a-z0-9_-]+)?)?$/;

async function main(paths) {
  if (paths.length === 0 || paths.some((path) => !publicRoute.test(path))) {
    throw new Error('Pass changed public paths, for example /docs/deploy-fastapi or /.');
  }
  const urlList = [...new Set(paths)].map((path) => origin + path);
  if (urlList.length > 10_000)
    throw new Error('IndexNow accepts up to 10,000 URLs per submission.');

  const key = indexNowKey(process.env.INDEXNOW_KEY);
  const keyLocation = `${origin}/${key}.txt`;
  const keyFile = await fetch(keyLocation, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!keyFile.ok || (await keyFile.text()).trim() !== key) {
    throw new Error(
      'The matching IndexNow key file must be live on gregale.dev before submitting.'
    );
  }

  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(origin).hostname, key, keyLocation, urlList }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow returned HTTP ${response.status}.`);
  }
  const status = response.status === 202 ? 'key verification pending' : 'accepted';
  console.log(`IndexNow ${status} for ${urlList.length} URL(s).`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
