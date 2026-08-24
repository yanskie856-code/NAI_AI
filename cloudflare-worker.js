export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const assetPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const assetUrl = new URL(assetPath, request.url);

    return env.ASSETS.fetch(new Request(assetUrl, request));
  }
};
