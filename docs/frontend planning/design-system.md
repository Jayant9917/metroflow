# MetroFlow Frontend — Design System

> **Document:** `frontend-planning/design-system.md`  
> **Status:** LOCKED  
> **Purpose:** Define the shared visual language and interaction rules for MetroFlow V1 frontend experiences.

---

## 1. Core Visual Identity

MetroFlow is dark-first, modern, premium, transit-focused, trustworthy, responsive, and fast. Modernity comes from hierarchy, typography, motion, layering, depth, and polished states—not excessive gradients, glow, glass, or decoration.

### Foundation Tokens

| Token | Value |
|---|---|
| Primary | `#2563EB` |
| Primary Hover | `#1D4ED8` |
| Primary Soft | `#DBEAFE` |
| Background | `#090E17` |
| Surface | `#111827` |
| Surface Elevated | `#182235` |
| Border | `#263244` |
| Text Primary | `#F8FAFC` |
| Text Secondary | `#94A3B8` |
| Text Muted | `#64748B` |
| Success | `#22C55E` |
| Warning | `#F59E0B` |
| Error | `#EF4444` |
| Info | `#38BDF8` |

Green and red are semantic colors, especially for Gate ALLOW/REJECT. They are not normal decorative brand colors.

## 2. Color Treatment

Derived tokens may include subtle primary gradients, interactive highlights, focus rings, selected/hover surfaces, elevated and overlay surfaces, subtle primary/success/error glows, simulator atmosphere, and gate scanning state. They must remain based on the foundation palette.

Use gradients for major CTA emphasis, simulator atmosphere, selected navigation, and subtle depth. Do not apply them to every card, button, heading, or border. Glow is subtle and state-driven.

## 3. Typography

- Primary UI font: **Inter**
- Technical identifiers: **Geist Mono**

Use Inter for navigation, forms, passenger UI, tickets, simulator information, and admin UI. Use Geist Mono selectively for IDs, references, timestamps, technical admin data, and appropriate gate metadata.

| Style | Size / line height / weight |
|---|---|
| Display | 40px / 48px / 700 |
| H1 | 32px / 40px / 700 |
| H2 | 24px / 32px / 600 |
| H3 | 20px / 28px / 600 |
| Body Large | 16px / 24px / 400 |
| Body | 14px / 22px / 400 |
| Small | 12px / 18px / 400 |
| Label | 12px / 16px / 600 |

Use hierarchy rather than excessive borders/cards. Simulator station names may use responsive display typography; normal screens should not make every heading oversized.

## 4. Shape Language

```text
Input 8px · Button 8px · Card 12px · Large card 16px
Dialog 16px · Badge/pill full radius
```

Use restrained rounding. Organize some information with spacing, separators, typography, and surface differences instead of making every container a floating rounded rectangle.

## 5. Spacing

Use a 4px-based scale:

```text
4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80
```

Guidance: use compact inline/form spacing, consistent card padding, generous section/page spacing for passenger screens, a defined desktop content max-width, and mobile page padding. Admin layouts may be denser.

## 6. Depth and Surfaces

```text
Level 0 — application background
Level 1 — normal surface
Level 2 — elevated card/panel
Level 3 — modal/popover
Level 4 — temporary interactive overlay
```

Use subtle borders, restrained shadows, background contrast, and occasional backdrop blur. Glass/blur is reserved for simulator overlays, floating controls, modal overlays, gate status overlays, and navigation above 3D content. Forms and admin tables remain crisp and readable.

## 7. Interaction System

Define default, hover, pressed, focus-visible, selected, loading, disabled, success, and error states. Buttons use subtle highlight/elevation, pressed compression, focus rings, and loading transitions. Interactive cards may change border/highlight, elevation, or transform slightly; avoid exaggerated scaling.

Inputs need strong focus, clear error and disabled states, and smooth border/background transitions.

## 8. Button System

Button variants: Primary, Secondary, Ghost, Destructive, Icon, and Large Simulator CTA. Each defines default, hover, pressed, focus, loading, and disabled behavior.

Primary actions use MetroFlow blue. Red is reserved for genuinely destructive actions. Gate ALLOW/REJECT presentation is separate from normal buttons.

## 9. Form System

Provide consistent text, password, OTP, search, select, station-selector, validation-message, and helper-text patterns. OTP is purpose-built rather than six unrelated generic inputs. Station selection feels like transit route selection, not a database dropdown.

## 10. Card System

Define normal content, interactive, active-ticket, journey, purchase, summary/stat, and QR-ticket cards.

The QR ticket card makes the QR extremely prominent and scan-friendly, with strong contrast, origin → destination, status, and validity. A light/white QR surface is allowed within the dark-first application.

## 11. Status System

Support these visual states:

```text
Ticket:  ISSUED · IN_JOURNEY · COMPLETED · EXPIRED
Journey: ACTIVE · COMPLETED · TIMED_OUT
Payment: READY · CONFIRMING · SUCCESS · FAILED · TAKING_LONGER
Gate:    IDLE · SCANNING · PROCESSING · ALLOW · REJECT
```

Never communicate status by color alone. Combine color, icon, label, and shape/treatment.

## 12. Experience Personalities

| Experience | Personality |
|---|---|
| Passenger | Clean, calm, trustworthy, premium, consumer-facing |
| Ticket | Crisp, scan-focused, premium |
| Gate | Industrial, immediate, high-contrast, machine-like |
| Simulator | Dark, cinematic, immersive, transit-focused |
| Admin | Dense, restrained, operational |

All experiences share the same tokens but intentionally differ in visual intensity. Passenger UI must not look like admin UI.

## 13. Passenger Experience

Use strong hierarchy, generous spacing, clear primary actions, simple navigation, polished cards, and subtle interactive feedback. Mobile-first; desktop may use a restrained sidebar.

## 14. Gate Experience

The Gate screen feels like an AFC machine, not a web form. Use a restrained scanner pulse in `IDLE`, scanning motion in `SCANNING`, focused progress in `PROCESSING`, strong semantic green and physical barrier motion for `ALLOW`, and controlled red feedback with a clear reason for `REJECT`. Do not use aggressive flashing.

## 15. Simulator Experience

Combine 2D information UI, a lightweight 3D environment, and guided cinematic movement. Use dark atmospheric surfaces with subtle blue light and restrained translucent overlays.

Keep current/next station, destination, passed stations, remaining stations, train position, route progress, speed, and journey status visible. Motion communicates arrival, doors, boarding, departure, movement, and destination. No unrestricted first-person movement.

## 16. Admin Experience

Use shared typography and tokens with less decoration, tighter spacing, strong tables, filters, search, status indicators, and clear data hierarchy. Do not turn every table row into a large card.

## 17. Navigation

```text
Passenger desktop → restrained sidebar
Passenger mobile  → bottom navigation
Admin             → persistent sidebar
Simulator         → minimal navigation
Gate              → no normal application navigation
```

Define default, hover, selected, focus, and required notification/status indicator states. Selected navigation may use a subtle blue highlight rather than a solid block.

## 18. Iconography

Primary icon family: **Lucide**, with consistent stroke weight. Icons support text and do not replace important labels. Custom graphics may represent the metro train, gate, route, and QR target. Do not mix unrelated icon families.

## 19. Motion System

```text
Micro:          100–180ms
Standard UI:    180–280ms
Large:          280–450ms
Cinematic:      longer where necessary
```

Define purposeful easing for buttons, card hover, focus, modals, navigation, loading, gate scanning/opening, train arrival, doors, departure, route progress, and destination arrival. Motion communicates cause and effect; not every element needs animation.

## 20. Micro-interactions

Use tasteful button feedback, station selection transitions, route-line drawing, QR-ready pulse, journey progress, scanner pulse, gate opening, status transitions, skeleton shimmer, success confirmation, and subtle number/status changes.

## 21. Loading, Empty, and Error States

Use skeletons for predictable content and spinners for short actions, payment confirmation, and gate processing. Define page, card, table, ticket, simulator-initialization, and gate-processing loading states. Never show a blank page.

Empty states cover no tickets, journeys, purchases, admin results, and active journey, with a concise next action where useful. Errors cover inline forms, page failures, payment, network, gate rejection, simulator timeout, and admin loading. Never expose raw backend errors to passengers.

## 22. Accessibility

Design for WCAG AA contrast where applicable, keyboard navigation, visible focus, semantic status communication, reduced motion, readable QR presentation, touch-friendly controls, and screen-reader-friendly labels.

Support `prefers-reduced-motion`: remove unnecessary transforms, simplify camera transitions, reduce gate pulses, retain meaningful state changes, and never hide information because animation is disabled.

## 23. Responsive Design

- Mobile: passenger-first, bottom navigation, stacked content, touch-friendly controls.
- Tablet: adaptive layouts.
- Desktop: passenger sidebar, richer simulator, admin tables, full gate/kiosk presentation.

Do not simply shrink desktop layouts; responsive behavior is intentional per experience.

## 24. Modern Design Rule

Use sophisticated dark surfaces, subtle gradients, restrained glow, layered depth, purposeful blur, responsive motion, polished interaction states, skeleton loading, responsive typography, and cinematic simulator presentation where they improve the experience.

Avoid excessive glassmorphism, neon, gradients, huge radii, floating cards, purposeless animation, oversized normal-screen typography, heavy shadows, and generic AI-generated landing-page aesthetics. The result must remain credible as a real transit product.

## 25. Design Freeze Rule

After this document is locked:

- Colors come from defined tokens.
- Typography uses defined type tokens.
- Spacing uses the defined scale.
- Components use shared interaction rules.
- Semantic colors retain consistent meaning.
- Motion follows the motion system.
- New pages reuse existing visual patterns.

Small implementation refinements are allowed; a new visual language is not. This document does not create implementation code.
