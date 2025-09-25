# volby static proxy demo

This project deploys a static front-end alongside a Netlify serverless function
that proxies requests to external APIs. The proxy adds permissive CORS headers
and avoids mixed-content restrictions by fetching remote data on the server
side.

## Local development

Install the Netlify CLI if you want to run the function locally:

```bash
npm install -g netlify-cli
```

Then run the development server, which serves the static assets from `public/`
and mounts the proxy function at `/.netlify/functions/proxy`:

```bash
netlify dev
```

Visit <http://localhost:8888> and use the form to fetch remote JSON via the
proxy.

## Deployment

1. Push this repository to GitHub.
2. Create a new site on Netlify and connect it to the repository.
3. When prompted for build settings, set:
   - **Build command:** (leave empty)
   - **Publish directory:** `public`
4. Deploy the site. Netlify will automatically build the static assets and
   expose the proxy function at `/.netlify/functions/proxy`.

The static JavaScript code issues requests to `/api?url=…`. The redirect defined
in `netlify.toml` forwards those calls to the proxy function so your browser no
longer connects directly to the external domain.

## Using the proxy

Send a GET request to `/.netlify/functions/proxy` (or simply `/api`) with the
query parameter `url` set to the external resource you want to fetch. Example:

```bash
curl 'https://your-site.netlify.app/api?url=https://api.example.com/data'
```

The proxy streams the upstream response back to the browser while injecting the
`Access-Control-Allow-Origin: *` header so client-side code served from a static
site can consume the data safely.
