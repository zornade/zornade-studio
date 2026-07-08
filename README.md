# Zornade Studio

[![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg)](https://vitejs.dev/)

A visual editor for building editorial maps and data visualizations (choropleths, points, cartograms, flows, bivariate, time series...) and publishing them as responsive embeds, no code required. Built for newsrooms, data journalists, and anyone who needs to tell a story with a geographic or statistical dataset in a few hours.

**subscribe to the newsletter**:

[![Newsletter](https://img.shields.io/badge/Newsletter-Subscribe-orange?style=for-the-badge&logo=substack)](https://newsletter.zornade.com)

---

## Table of contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Main features](#main-features)
- [Cloud projects and sharing](#cloud-projects-and-sharing)
- [Development and contributing](#development-and-contributing)
- [Author](#author)
- [License](#license)

---

## Overview

Zornade Studio is a "step-by-step" editor (data → structure → visualize → design → publish) that turns a CSV, a geographic file, or an API query into a map or chart ready to be embedded in an article, with correct data attribution and customizable style.

### Supported data sources

- File upload (CSV, GeoJSON, zipped Shapefile, KML/KMZ, Excel)
- Paste tabular data
- Remote URL (public CSV/GeoJSON)
- Overpass API (OpenStreetMap) with Nominatim geocoding to define the area
- Preloaded ISTAT/Zornade DB dataset catalog
- Eurostat (European statistical datasets)

### Visualization types

Choropleth, points/markers, bivariate, cartograms (contiguous/non-contiguous), hexbin, heatmap, flows (origin-destination), charts (bar, line, scatter - via Observable Plot), tables, time series with a time-slider, scrollytelling (step-by-step storytelling with an animated camera), 3D globe.

### Publishing

Every published map generates a static HTML embed (`<iframe>`) hosted on S3-compatible object storage, with a mandatory, non-removable caption and data attribution (OpenStreetMap/ODbL) baked in - see [NOTICE](NOTICE).

---

## Architecture

```
Browser (React SPA, Vite)
     │
     ├── MapLibre GL (map rendering, style derived from PMTiles)
     ├── Observable Plot (non-geographic charts)
     └── Editor state (StudioContext) ── local autosave (localStorage)
              │
              ├── Local file (.zornade.json) ── manual save/open, offline
              │
              └── Supabase (dedicated project, optional) ─────────────┐
                     │                                                  │
                     ├── Per-user auth (email magic link)                │
                     ├── studio_projects (saved editor state)            │
                     └── studio_project_collaborators (sharing)          │
                                                                         │
Netlify Functions (server-side)                                        │
     ├── Legacy shared gate (single password, signed cookie)            │
     └── Embed publishing → S3-compatible object storage ◄──────────────┘
              │
      Supabase Edge Function: invite email delivery (Resend)
```

Two project persistence paths coexist and are both supported:

| Path | When to use it |
|----------|---------------|
| **Local file** (`.zornade.json`, "Save project" button) | Always available, no configuration needed, ideal for backup/portability or self-hosting without Supabase |
| **Cloud (dedicated Supabase project)** | Requires configuration (see below); enables per-user login, opening from any device, and sharing with collaborators (editor/viewer roles) |

### Two authentication layers, independent

1. **Supabase (email magic link)**: the only mechanism enabled by default, including on the official zornade.com/studio deployment - free, open access, anyone can sign up with their own email, no shared password to know.
2. **Legacy gate** (`STUDIO_USER`/`STUDIO_PASS_SHA256`): a single shared password, the historical mechanism, now **disabled by default** (`VITE_STUDIO_LEGACY_LOGIN_ENABLED` unset). Re-enable it explicitly (`VITE_STUDIO_LEGACY_LOGIN_ENABLED=true`) only if you want to restrict access to a small team/single operator (e.g. a private beta); once re-enabled, if both mechanisms end up configured, access requires both in sequence (see `src/auth/combine-auth.ts`).

With the default configuration (Supabase only), access is granted to anyone who completes the magic-link sign-in.

### Project files

| Path | Description |
|----------|-------------|
| `src/studio/` | Editor state (`StudioContext`), types (`types.ts`), preset/newsroom kit catalogs |
| `src/components/` | UI (step-by-step panels, map/chart canvas, project/sharing modals) |
| `src/lib/` | Pure logic: data parsing, geographic joins, classification, export, integrations (Overpass, Nominatim, Eurostat, CKAN...), Supabase CRUD |
| `src/auth/` | Legacy gate + Supabase auth, combined in `combine-auth.ts` |
| `netlify/functions/` | Legacy gate login/logout, generic CKAN/Eurostat/fetch proxy, embed publishing to object storage |
| `supabase/migrations/` | Schema for the dedicated Supabase project (tables, RLS, triggers) |
| `supabase/functions/` | Edge Function for sending invite emails (Resend) |
| `supabase/tests/` | pgTAP suite for schema/RLS/triggers |

---

## Prerequisites

- **Node.js 20+** and npm
- An **S3-compatible object storage provider** (e.g. DigitalOcean Spaces, AWS S3, Cloudflare R2) for publishing embeds
- Optional: your own **Supabase project**, to enable per-user login and cloud projects/sharing
- Optional: a **[Resend](https://resend.com) API key** (or an equivalent email provider), only if you want invite notification emails

---

## Quick start

```bash
git clone https://github.com/zornade/zornade-studio.git
cd zornade-studio

npm install

cp .env.example .env.local
# Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for magic-link sign-in
# (see below). The legacy gate stays disabled until you explicitly enable it.

npm run dev
```

The app is available at `http://localhost:5173`. Without any further configuration it works with: public data catalogs, all visualizations, the full editor, and local file saving. Embed publishing and cloud projects require the configuration described below.

### Production build

```bash
npm run build      # tsc --noEmit && vite build
npm run preview    # serves the build locally
```

---

## Configuration

All variables are documented in [.env.example](.env.example). Summary:

### Legacy gate (disabled by default - only if you want to restrict access)

| Variable | Where | Description |
|-----------|------|-------------|
| `VITE_STUDIO_LEGACY_LOGIN_ENABLED` | Netlify / `.env.local` | Must be `true` to enable the legacy gate. Unset = disabled (default, official deployment behaviour) |
| `STUDIO_USER` / `VITE_STUDIO_USER` | Netlify / `.env.local` | Username for the shared password |
| `STUDIO_PASS_SHA256` / `VITE_STUDIO_PASS_SHA256` | Netlify / `.env.local` | Hex SHA-256 of the password (`printf '%s' 'password' \| sha256sum`) |
| `STUDIO_SESSION_SECRET` | Netlify only | Long random string to sign the session cookie (`openssl rand -hex 32`) |

In production (Netlify Functions) the variables **without** the `VITE_` prefix are read server-side only. In local development without Netlify Functions, use the equivalent variables **with** the `VITE_` prefix in a `.env.local` (never committed).

### Supabase (optional - per-user login, cloud projects, sharing)

| Variable | Description |
|-----------|-------------|
| `VITE_SUPABASE_URL` | URL of **your** dedicated Supabase project |
| `VITE_SUPABASE_ANON_KEY` | Anon/public key (never the service_role key) |

Apply the migrations in `supabase/migrations/` to your project (`supabase db push --linked`) to create the schema (projects/collaborators tables, RLS, triggers). If you also want invite notification emails, deploy `supabase/functions/send-project-invite-email` and set the `RESEND_API_KEY` secret on **your** Supabase project.

> Every deployment of Studio - including the official one on zornade.com - uses its own dedicated Supabase project, never shared between installations: this is exactly what a self-hoster should do too.

### Embed publishing (optional, Netlify Functions only)

| Variable | Description |
|-----------|-------------|
| `SPACES_KEY` / `SPACES_SECRET` | S3-compatible object storage credentials |
| `SPACES_BUCKET` / `SPACES_REGION` | Bucket and region |
| `EMBED_BASE_URL` / `EMBED_GEO_BASE` | Public base URLs for published embeds |

---

## Main features

- **Step-by-step editor**: Data → Structure → Visualize → Design → Publish, with a live preview
- **Local autosave**: work in progress is always recoverable from `localStorage`, regardless of explicit saving
- **Export**: high-resolution PNG, PDF, HTML embed, CSV data
- **Annotations** and **scrollytelling** (step-by-step storytelling with an animated camera on the map)
- **Data classification**: quantile, natural breaks (Jenks), equal-interval, manual, with accessible (CVD-safe) palettes

---

## Cloud projects and sharing

With Supabase configured, the **Projects** button at the top gives access to:

- **My projects / Shared with me**: open, rename, duplicate, delete (owner only) any saved project
- **Share**: invite a collaborator by email with the **editor** (can edit) or **viewer** (read-only) role; if the invitee doesn't have an account yet, the invite stays pending and activates automatically on their first sign-in with the same email
- The file-based flow (`.zornade.json`) always remains available as a backup/export, independent of the cloud

---

## Development and contributing

Contributions welcome - read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR (in short: **always open an issue before writing code**). We follow the [Code of Conduct](CODE_OF_CONDUCT.md). For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run test         # vitest run
```

---

## Author

Developed and maintained by [Zornade](https://zornade.com).

## License

The source code is distributed under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** - see [LICENSE](LICENSE) and [NOTICE](NOTICE) (the latter also covers attribution obligations on outputs/embeds, derived from data licenses like ODbL, not from the AGPL).

A **separate commercial license** is also available for those who cannot/do not want to comply with the AGPL §13 obligations in a proprietary product - see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).
