# MetroFlow Frontend — Asset Inventory

> **Document:** `frontend-planning/assets/README.md`  
> **Status:** LOCKED  
> **Purpose:** Define the V1 visual assets, sourcing rules, formats, and performance expectations for MetroFlow.

---

## 1. Asset Principles

Assets support the product rather than decorate it unnecessarily. Prefer lightweight, reusable vectors, code-drawn graphics, optimized 3D models, and a consistent visual language. Avoid unnecessary stock imagery, huge files, inconsistent icon packs, unlicensed/copyrighted assets, copied transit branding, and oversized models that harm web performance.

## 2. Branding

Required inventory:

```text
[ ] Primary logo       [ ] Compact mark
[ ] Dark-background version  [ ] Light-background version where needed
[ ] Favicon            [ ] Application icon
[ ] Social/Open Graph preview
```

Prefer SVG for logos and marks. Use PNG/WebP only where raster output is necessary. Do not create unnecessary variants.

## 3. Icons

Use **Lucide** as the primary family for Home, Ticket, Train, Route, User, Settings, Search, arrows, Clock, Check, Warning, Error, Log Out, Payment, Filter, Menu, and Close. Custom graphics are limited to cases Lucide cannot represent adequately:

```text
[ ] Metro train symbol  [ ] AFC gate symbol
[ ] QR scan target      [ ] Route/station marker
```

Do not mix unrelated icon libraries.

## 4. Typography Assets

Use **Inter** for primary UI and **Geist Mono** for technical identifiers. Prefer framework/package/font-provider integration over manually committed font files. No decorative fonts in V1.

## 5. QR Assets

QR codes are generated dynamically with `qrcode.react` or an equivalent lightweight React solution. They must be high-contrast, scalable, scanner-readable, and have a clear quiet zone. No decorative overlay may cover QR modules. A light QR surface is allowed within the dark UI. Do not create static QR image assets.

## 6. Passenger Application Assets

Use very few raster assets. Prefer icons, CSS/SVG route graphics, typography, component styling, gradients, and motion.

Optional:

```text
[ ] Empty-ticket illustration  [ ] Empty-journey illustration
[ ] Generic error illustration [ ] Success graphic
```

Illustrations must not block implementation; polished empty states can use typography and icons alone.

## 7. Metro Route Graphics

Prefer data-driven SVG, CSS, React, or Canvas/WebGL only where necessary. Support route line, station nodes, passed/current/upcoming states, destination, and train-position marker. Do not use a static map screenshot for the interactive route.

## 8. Gate Assets

Potential assets:

```text
[ ] QR scanner target  [ ] AFC gate/barrier graphic
[ ] Entry/exit indicators  [ ] Success/reject visuals
```

Prefer CSS/SVG for scanner pulse, scan line, status rings, indicators, and simple barrier visualization. Any 3D gate must remain lightweight and must not copy a specific manufacturer.

## 9. Simulator 3D Asset Inventory

MetroFlow uses lightweight 3D with 2D overlays and guided cinematic movement. Potential assets:

```text
[ ] Train exterior       [ ] Simplified train interior
[ ] Platform/station     [ ] AFC entry/exit gate
[ ] Platform signage     [ ] Dynamic station-name boards
[ ] Train doors          [ ] Basic seating/interior objects
[ ] Floor/wall materials [ ] Lighting/environment setup
```

Prefer `.glb` and `.gltf`, with `.glb` preferred for simple web distribution. Keep models modular, for example `train.glb`, `station-platform.glb`, and `afc-gate.glb`, rather than one enormous scene.

## 10. Simulator Animation Assets

Required possibilities include train arrival/stop/departure, doors opening/closing, gate opening/closing, and guided boarding camera movement. Animations may be embedded in GLB files, programmatic, or handled by the 3D runtime. Do not use videos for state-responsive interactions.

## 11. Simulator Environment

V1 does not require photorealistic stations, crowds, passengers, complex physics, railway signalling, open-world environments, first-person WASD assets, high-poly interiors, or live city scenery. Target a recognizable metro environment, polished motion, good lighting, and clear station identity.

## 12. Station Identity

Render station names dynamically as text, such as Rajiv Chowk, Central Secretariat, AIIMS, and Hauz Khas. Do not create separate images for station names; station boards must support dynamic content.

## 13. Materials & Textures

Potential materials cover train exterior/interior, platform floor, station wall, metal gate, glass, and signage. Use small optimized textures, reusable materials, and procedural/material colors for simple surfaces. Avoid unnecessary 4K/8K textures.

## 14. Lighting

Support a dark cinematic environment, readable platforms, restrained MetroFlow-blue influence, believable train/platform lighting, and strong contrast without hiding information. Use simple or baked lighting where appropriate and remain compatible with normal web hardware.

## 15. 3D Performance Budget

Prefer low/medium-poly models, remove invisible geometry, compress textures, reuse materials, minimize draw calls, lazy-load simulator assets, and apply supported model compression. Never load simulator assets on normal passenger/admin pages. Provide loading feedback during initialization.

## 16. 3D Fallback

The journey must remain understandable without advanced 3D. Use route visualization, station progress, a train icon, 2D motion, and current/next station information. Backend journey behavior must never depend on a 3D asset loading successfully.

## 17. Payment Assets

Use only official Razorpay branding when provider branding is required. Do not redraw logos inaccurately or make provider branding more prominent than MetroFlow.

## 18. Admin Assets

Admin needs almost no decorative assets: Lucide icons, useful charts, status badges, tables, and typography. Avoid background artwork, large images, illustrations, and unnecessary 3D.

## 19. Loading & Skeleton Assets

Do not create loading GIFs. Use skeleton blocks, progress indicators, CSS animation, spinners, and a simulator loading overlay consistent with `design-system.md`.

## 20. Motion Assets

Prefer CSS transitions, Web Animations, a justified React animation library, or the selected 3D runtime. Do not use pre-rendered videos for normal transitions or add a dependency only for a trivial hover effect.

## 21. Asset Licensing

Every external asset must permit use in this portfolio/project. Record source, author, license, attribution requirement, and modification permission for each model, illustration, icon, or texture. Do not use unclear, improperly redistributed, or extracted proprietary transit assets.

## 22. Reference Assets vs Product Assets

Files under `frontend-planning/references/` are design references, not automatically shippable assets. Product assets belong in the application asset structure during implementation.

## 23. Suggested Implementation Asset Structure

Guidance for later implementation only:

```text
apps/web/public/
├── brand/       ├── logo.svg
│                └── mark.svg
├── images/
├── models/      ├── train/
│                ├── station/
│                └── gate/
├── textures/
└── social/
```

The actual structure may be adjusted during implementation without changing architecture.

## 24. Asset Acquisition Priority

```text
Priority 1 — logo/temporary mark, icons, fonts, QR rendering, route graphics
Priority 2 — scanner target, gate/barrier representation
Priority 3 — train, platform/station, gate, materials, animation
Priority 4 — optional illustrations, social preview, environmental polish
```

Do not wait for every asset before coding. Implementation can begin while Priority 2/3 assets are refined.

## 25. Asset Freeze Rule

This document defines V1 asset direction but does not require every asset before implementation. Equivalent assets may be substituted, model quality adjusted for performance, optional illustrations removed, and temporary placeholders used during development.

Do not change MetroFlow identity, the icon family, simulator scope, gate direction, data-driven route approach, or licensing requirements without revisiting the relevant locked planning document.

No assets are downloaded or created by this planning document.
