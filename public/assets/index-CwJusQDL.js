// Compatibility bridge for the v3.5.0 cached HTML shell.
// Do not remove: existing Safari service workers may still request this hash.
const scope = "/rikkyo-uk-vocab/";
const html = await fetch(`${scope}?compat=${Date.now()}`, { cache: "no-store" }).then((response) => {
  if (!response.ok) throw new Error(`COMPAT_SHELL_FETCH_${response.status}`);
  return response.text();
});
const source = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
if (!source || source.endsWith("/assets/index-CwJusQDL.js")) throw new Error("COMPAT_CURRENT_ENTRY_NOT_FOUND");
await import(`${source}?compat=3.5.4`);
