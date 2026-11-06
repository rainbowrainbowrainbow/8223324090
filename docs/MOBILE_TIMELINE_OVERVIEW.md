# Park phone timeline overview

## Scope and interaction

The product owner selected the "Overview + details" option for the Park holiday
timeline on 2026-11-06. The phone overview uses the existing booking label and
canonical booking modal. It adds a two-line presentation (label, time range and
status when space permits) rather than a second detail renderer or data source.
Other block content remains in the DOM for desktop and room presentations.

On coarse-pointer phones, gestures beginning on a holiday booking pan the native
scrollport in both axes. Touch cannot arm booking drag/resize or Afisha drag in
this overview. Users edit through the existing details/actions. Mouse drag/resize
and their atomic save contracts are unchanged. Sensitive controls and linked
identities remain owned by the existing modules.

## Rotation and layout

Phone classification uses a coarse pointer, a shortest viewport side up to 600 px
and a longest side up to 1024 px. Only the Park timeline receives the layout
class. Time-cell widths are 44/64/92 px for 15/30/60-minute zoom respectively,
independent of orientation; resource headers stay 96 px. The existing coalesced
resize handler therefore sees no time-geometry change on rotation, retains the
existing booking nodes and does not call the data-render/fetch path. Date changes,
normal refresh and live updates retain the existing behavior.

The holiday overview has one bounded native two-axis scrollport. Existing sticky
resource labels and time headers remain its navigation anchors. Landscape phone
layout keeps the sidebar off canvas, preserves its toggle/overlay/Escape owner,
and wraps the compact date/action toolbar when needed. HR, education and desktop
layout do not acquire the Park phone overview behavior.

## Verification

The registered `mobile-timeline-overview-browser-smoke.js` is called from the
existing Park navigation browser gate. It uses actual page markup, touch input
and the canonical booking modal with synthetic API responses. Its default gate
covers creator and animator; `MOBILE_TIMELINE_FULL=true` also covers admin and
both themes. Each context exercises portrait, landscape and return to portrait.

Assertions cover native vertical and horizontal swipes starting on an actual
booking hit target, sticky resource labels, canonical modal opening and closing,
landscape sidebar opening/overlay closing, zero accidental API mutations, stable
booking node identity, no extra line/booking reads and no loading-state transition
on rotation. Scroll inertia is allowed to settle before the independent tap test.

Additional unit regressions verify phone geometry/context boundaries and that
touch cannot arm drag/resize while mouse interaction remains available. Existing
timeline protected-surface hashes are unchanged and must continue to pass.

These fixtures emulate Android Chromium. They do not claim physical Android
hardware, an installed PWA, or an authenticated production employee session.
