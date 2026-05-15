# Sentinel Robotics — Site

Production build of the Sentinel Robotics CRT-aesthetic landing site + investor deck.

## Deploy

This is a static site. Drop the whole folder on any static host:

- **Cloudflare Pages / Netlify / Vercel** — connect the repo; build command: none; publish directory: `/`
- **GitHub Pages** — push to `main`, enable Pages from the repo settings
- **S3 / nginx / any web server** — upload the folder as-is

No build step, no dependencies. `index.html` is the entry point.

## Files

| File              | Purpose                                                            |
|-------------------|--------------------------------------------------------------------|
| `index.html`      | Site shell — preloader, CRT canvas, TV-frame, deck overlay         |
| `crt.js`          | CRT renderer + boot sequence + home page + investor portal gate    |
| `deck.html`       | Sentinel Pre-Seed Deck V-III (self-contained)                      |
| `assets/`         | TVFrame.png, turret.png, SR-Full.png, SRBrand.png                  |

## Local preview

Open `index.html` with any static server, e.g.:

```sh
python -m http.server 8080
# then open http://localhost:8080/
```

Opening the file directly via `file://` mostly works but some browsers block local font loading.

## Updating the deck

Replace `deck.html` with a new self-contained HTML deck and the iframe in `index.html` picks it up automatically.
