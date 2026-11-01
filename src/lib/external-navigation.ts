/** Leave the console for a provider-hosted page (checkout, billing portal). */
export function goToExternal(url: string): void {
  window.location.assign(url);
}
