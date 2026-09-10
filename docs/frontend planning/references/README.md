# MetroFlow Frontend — Visual References

> **Document:** `frontend-planning/references/README.md`  
> **Status:** LOCKED  
> **Purpose:** Define the visual-reference direction used when creating the MetroFlow design system.

---

## 1. Overall Product Direction

MetroFlow should feel like a modern transit product rather than a developer dashboard.

Reference qualities:

- Clean, modern, trustworthy, and transit-focused
- Dark-mode capable
- Strong information hierarchy and clear status communication
- Restrained effects and purposeful motion

MetroFlow develops its own identity; references are not copied directly.

## 2. Passenger Application References

Study TfL Go, Citymapper, Google Maps transit, modern airline/train ticket apps, Apple Wallet passes, and Uber-style journey interfaces.

Focus on station selection, origin/destination presentation, journey cards, route visualization, active-trip status, mobile navigation, digital-ticket hierarchy, and loading/empty states.

## 3. QR Ticket References

Study Apple Wallet passes, airline boarding passes, modern railway/metro QR tickets, and Delhi Metro digital QR tickets.

Extract ideas for QR prominence, route hierarchy, status, validity, fare information, and scan-friendly contrast. Do not reproduce another ticket design exactly.

## 4. Payment References

Study Razorpay Checkout, Stripe-style payment status UX, and modern fintech confirmation screens.

Focus on payment handoff, confirming payment, success, failure, delayed confirmation, and retry presentation. MetroFlow should distinguish:

```text
Paying → Confirming → Confirmed
```

Provider completion and backend confirmation are separate stages.

## 5. Gate Experience References

Study metro AFC gates, airport e-gates, access-control kiosks, and contactless payment terminals.

Focus on large scan targets, high visibility, minimal text, immediate feedback, ALLOW/REJECT communication, physical-machine feel, and barrier-opening motion.

The gate must not look like a text input, submit button, or API response. Operator configuration remains secondary and hidden.

## 6. Simulator References

Study Google Maps transit progress, Citymapper journey presentation, metro route maps, Flighty-style progress interfaces, and lightweight cinematic 3D transport experiences.

Focus on current/next/passed stations, destination, route progress, arrival/departure transitions, station signage, train movement, camera transitions, and useful motion.

MetroFlow uses:

```text
2D information UI + lightweight 3D station/train environment
+ guided cinematic transitions
```

It is not a full game, first-person WASD experience, or realistic train simulator.

## 7. Admin References

Study Linear, Vercel dashboards, Stripe Dashboard, and Retool-style operational interfaces.

Focus on sidebar navigation, tables, filters, search, status badges, dense information, detail inspection, and loading/empty/error states. Admin shares MetroFlow branding but prioritizes operational clarity.

## 8. Auth References

Study Linear, Vercel, Stripe, and modern fintech authentication interfaces.

Focus on centered layouts, field hierarchy, password/OTP switching, OTP input, validation, and password recovery. Avoid excessive illustrations and marketing content.

## 9. Motion References

Review gate scan pulses, success/reject transitions, barrier opening, train arrival/departure, door transitions, station progress, and subtle page transitions.

Motion must communicate state. Avoid decoration-only animation.

## 10. Reference Collection Checklist

Organize useful screenshots/examples under:

```text
references/
├── passenger/
├── auth/
├── tickets/
├── payment/
├── gate/
├── simulator/
├── admin/
└── motion/
```

For each reference, briefly note:

- What we like
- What MetroFlow can learn
- What MetroFlow should not copy

A small number of strong references is better than a large inspiration folder.

## 11. Reference Rule

References provide direction only. They do not override `requirements.md`, `pages.md`, `user-flows.md`, `wireframes/README.md`, or locked backend architecture.

Final colors, typography, spacing, components, motion rules, and visual tokens will be decided in `design-system.md`.
