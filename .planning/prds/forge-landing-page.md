# PRD: Forge Landing Page

## Problem & Goals

forge-cc has no public-facing website. As a Claude Code plugin with growing adoption, it needs a brand presence that establishes visual identity and creates an atmospheric, memorable first impression. The goal is not feature documentation or conversion optimization -- it's mood-first, minimal, somewhat mysterious.

**Reference:** arscontexta.org -- minimalist centered layout, ASCII animated background, serif + mono typography, philosophical tone, mystical dev tool vibe.

**Success Criteria:**
- Three distinct brand direction mockups deployed as live, interactive pages
- Each direction features unique mouse-reactive effects and visual identity
- All three are accessible at separate routes (`/v1`, `/v2`, `/v3`) for comparison
- User can pick a winner for final polish and deployment to a custom domain

## User Stories

1. **Visitor** lands on the page and immediately feels the brand's personality through visual effects, typography, and negative space -- before reading any text.
2. **Visitor** finds the GitHub repo and install command within one click/interaction from the main view.
3. **Developer** copies the `npm i -g forge-cc` install command directly from the page.

## Technical Approach

**Stack:** Next.js 15 (App Router) + Tailwind CSS v4, deployed to Vercel
**Repo:** Subfolder `site/` within the forge-cc repo (keeps brand assets close to the product)
**Effects:** WebGL shaders (Direction 1), Canvas 2D (Direction 2), SVG (Direction 3) -- each self-contained
**Fonts:** Variable fonts loaded via `next/font` (Cormorant Garamond, Fraunces, Instrument Serif, IBM Plex Mono, JetBrains Mono, Space Mono)
**Accessibility:** All effects respect `prefers-reduced-motion`. WCAG AA contrast on all text.
**Mobile:** Each direction includes a mobile fallback (static visuals, no cursor effects, touch-friendly).

**Key Constraints:**
- 60fps target on M1 MacBook Air (Chrome)
- WebGL fallback for Direction 1 if GPU unavailable
- No external dependencies beyond Next.js/Tailwind/fonts
- Each direction is a separate route with shared layout shell

## Scope

### In Scope
- Next.js project scaffold in `site/` with Tailwind, font loading, shared layout
- Three complete brand mockups as interactive pages
- Mouse-reactive effects (WebGL shader, particle system, SVG blob)
- Install command copy-to-clipboard interaction
- GitHub/npm/docs footer links
- `prefers-reduced-motion` support
- Mobile-responsive layouts
- Vercel deployment config

### Out of Scope
- Documentation pages / feature deep-dives
- Blog or changelog
- Analytics integration
- Custom domain DNS setup (just Vercel preview URLs)
- SEO optimization beyond basics
- Dark/light mode toggle (each direction has a fixed color scheme)

### Sacred Files
- All files outside `site/` -- this project does not touch forge-cc source code

## Milestones

### Milestone 1: Project Scaffold & Shared Infrastructure
**Goal:** Next.js app in `site/` with Tailwind, fonts, shared layout, and deploy pipeline
**Issues:**
- [ ] Initialize Next.js 15 app in `site/` with App Router, TypeScript, Tailwind CSS v4
- [ ] Configure font loading (Cormorant Garamond, Fraunces, Instrument Serif, IBM Plex Mono, JetBrains Mono, Space Mono) via next/font/google
- [ ] Create shared layout shell with `<head>` metadata, favicon placeholder, and footer links component
- [ ] Build reusable InstallPill component (displays `npm i -g forge-cc`, click-to-copy with brief feedback)
- [ ] Add `prefers-reduced-motion` detection hook (`useReducedMotion`)
- [ ] Set up Vercel deployment (vercel.json or auto-detect) and verify preview deploy works
- [ ] Create route stubs for `/v1`, `/v2`, `/v3` with placeholder content

### Milestone 2: Brand Mockups (3 directions, parallel agents)
**dependsOn:** 1
**Goal:** Three complete, interactive brand direction pages deployed and comparable

**Direction 1 -- Alchemical Forge (`/v1`):**
- [ ] Build WebGL ASCII canvas renderer -- glyph texture atlas, grid-based fragment shader with `u_time`, `u_mouse`, `u_heat` uniforms
- [ ] Implement mouse-as-heat-source effect -- characters brighten to amber, density shifts (`\u2591` to `\u2592` to `\u2593`), heat distortion wave
- [ ] Create centered content overlay -- "forge" in Cormorant Garamond 72px, tagline in IBM Plex Mono 14px, breathing negative space
- [ ] Add WebGL fallback -- static pre-rendered ASCII image with CSS brightness animation if GPU unavailable
- [ ] Style footer links and InstallPill with Alchemical palette (charcoal bg, parchment text, amber accents)
- [ ] Mobile layout -- static ASCII image, no shader, centered content stack

**Direction 2 -- Stratigraphic Descent (`/v2`):**
- [ ] Build Canvas 2D particle system -- 200-300 particles with three behavior states (Brownian chaos, orbital paths, parallel streams)
- [ ] Implement scroll-driven state transitions -- particle positions interpolated between chaos/orbit/stream based on scroll progress per section
- [ ] Create 4-section layout (hero + Triage + Spec + Go) with scroll-snap, Fraunces headings, JetBrains Mono body
- [ ] Add mouse gravitational interaction -- repulsion in Triage, attraction+orbit in Spec, acceleration boost in Go
- [ ] Implement continuous background color transition (warm black to slate blue to deep indigo) driven by scroll position
- [ ] Style section dividers, footer, and InstallPill with Stratigraphic palette
- [ ] Mobile layout -- reduced particle count (150), touch-scroll, no cursor effects

**Direction 3 -- Negative Space (`/v3`):**
- [ ] Build generative SVG blob -- 8-12 radial control points with independent sine oscillations, cubic bezier path generation
- [ ] Implement blob breathing animation -- 2-3% scale oscillation over 6s cycle, continuous
- [ ] Add cursor interaction -- blob control points displaced away from cursor (flinch), custom crosshair cursor with trail
- [ ] Create asymmetric layout -- blob right 60%, "forge" in Instrument Serif italic left 30%, generous whitespace
- [ ] Build hover-to-strike effect on InstallPill -- blob compresses momentarily then rebounds
- [ ] Style with Negative Space palette (warm white bg, oxide red accent, near-black text)
- [ ] Mobile layout -- blob above text (stacked), no cursor effects, smaller blob

### Milestone 3: Polish & Deploy Winner
**dependsOn:** 2
**Goal:** User picks winning direction, final polish applied, production deploy
**Issues:**
- [ ] Present all 3 directions for user review at Vercel preview URLs
- [ ] Apply feedback and polish to chosen direction (timing tweaks, copy refinements, responsive edge cases)
- [ ] Move winning direction to root route (`/`)
- [ ] Add meta tags (Open Graph, Twitter Card) with appropriate preview image
- [ ] Final performance audit -- Lighthouse score, 60fps verification, mobile testing
- [ ] Production deploy to Vercel
