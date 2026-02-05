# Skill: Performance & SEO Audit

## Description
Comprehensive performance optimization and SEO audit skill for the booking system's public-facing pages. Covers Core Web Vitals, Lighthouse automation, image optimization, caching strategies, structured data, and Ukrainian-language SEO.

## Activation
Use this skill when:
- Optimizing page load speed
- Running Lighthouse audits
- Adding SEO meta tags and structured data
- Optimizing images and assets
- Setting up caching strategies
- Improving Core Web Vitals scores

## Core Web Vitals Targets

| Metric | Target | What It Measures |
|--------|--------|-----------------|
| LCP (Largest Contentful Paint) | < 2.5s | Loading performance |
| INP (Interaction to Next Paint) | < 200ms | Interactivity |
| CLS (Cumulative Layout Shift) | < 0.1 | Visual stability |
| FCP (First Contentful Paint) | < 1.8s | Initial render |
| TTFB (Time to First Byte) | < 800ms | Server response |

## Lighthouse Audit Automation

```typescript
// scripts/lighthouse-audit.ts
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const PAGES_TO_AUDIT = [
  { url: '/', name: 'Homepage' },
  { url: '/events', name: 'Events List' },
  { url: '/events/sample-event', name: 'Event Detail' },
  { url: '/booking/form', name: 'Booking Form' },
];

const THRESHOLDS = {
  performance: 90,
  accessibility: 95,
  'best-practices': 90,
  seo: 95,
};

async function runAudit() {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });

  const results = [];

  for (const page of PAGES_TO_AUDIT) {
    const result = await lighthouse(
      `${process.env.BASE_URL}${page.url}`,
      {
        port: chrome.port,
        output: 'json',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      }
    );

    const scores = {
      page: page.name,
      url: page.url,
      performance: Math.round(result.lhr.categories.performance.score * 100),
      accessibility: Math.round(result.lhr.categories.accessibility.score * 100),
      bestPractices: Math.round(result.lhr.categories['best-practices'].score * 100),
      seo: Math.round(result.lhr.categories.seo.score * 100),
      lcp: result.lhr.audits['largest-contentful-paint'].numericValue,
      cls: result.lhr.audits['cumulative-layout-shift'].numericValue,
      fcp: result.lhr.audits['first-contentful-paint'].numericValue,
      ttfb: result.lhr.audits['server-response-time'].numericValue,
    };

    results.push(scores);

    // Check thresholds
    for (const [category, threshold] of Object.entries(THRESHOLDS)) {
      const score = scores[category.replace('-', '')];
      if (score < threshold) {
        console.warn(`⚠️ ${page.name}: ${category} score ${score} < ${threshold}`);
      }
    }
  }

  await chrome.kill();
  return results;
}
```

## SEO Checklist for Booking Pages

### Meta Tags (every page)
```html
<!-- Basic -->
<title>Назва події — Бронювання свят | BrandName</title>
<meta name="description" content="Забронюйте незабутнє свято. {event.title} — {event.date}. Ціна від {event.pricePerPerson} ₴/особа." />
<link rel="canonical" href="https://yourdomain.com/events/{slug}" />
<html lang="uk">

<!-- Open Graph -->
<meta property="og:title" content="{event.title} — Бронювання" />
<meta property="og:description" content="{event.description | truncate(200)}" />
<meta property="og:image" content="{event.images[0].url}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="https://yourdomain.com/events/{slug}" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="uk_UA" />

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{event.title}" />
<meta name="twitter:description" content="{event.description | truncate(200)}" />
<meta name="twitter:image" content="{event.images[0].url}" />

<!-- Mobile -->
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#your-brand-color" />
```

### Structured Data (JSON-LD)
```html
<!-- Event page -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "{event.title}",
  "description": "{event.description}",
  "startDate": "{event.dateStart | ISO8601}",
  "endDate": "{event.dateEnd | ISO8601}",
  "location": {
    "@type": "Place",
    "name": "{event.location}",
    "address": {
      "@type": "PostalAddress",
      "addressCountry": "UA"
    }
  },
  "offers": {
    "@type": "Offer",
    "price": "{event.pricePerPerson}",
    "priceCurrency": "UAH",
    "availability": "{event.status === 'SOLD_OUT' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'}",
    "url": "https://yourdomain.com/events/{slug}"
  },
  "organizer": {
    "@type": "Organization",
    "name": "YourBrandName",
    "url": "https://yourdomain.com"
  },
  "image": "{event.images[0].url}",
  "eventStatus": "https://schema.org/EventScheduled",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode"
}
</script>

<!-- Organization (homepage) -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "YourBrandName",
  "url": "https://yourdomain.com",
  "logo": "https://yourdomain.com/logo.png",
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+380-XX-XXX-XXXX",
    "contactType": "customer service",
    "availableLanguage": "Ukrainian"
  },
  "sameAs": [
    "https://instagram.com/yourbrand",
    "https://t.me/yourbrand"
  ]
}
</script>
```

## Image Optimization

```typescript
// Image optimization pipeline
const imageOptimizationConfig = {
  // Use Next.js Image or similar
  formats: ['webp', 'avif'], // with JPEG fallback
  sizes: {
    thumbnail: { width: 300, height: 200 },
    card: { width: 600, height: 400 },
    hero: { width: 1200, height: 630 },
    full: { width: 1920, height: 1080 },
  },
  quality: 80,
  lazy: true, // loading="lazy" for below-fold
  priority: ['hero'], // loading="eager" for above-fold

  // srcset for responsive
  breakpoints: [320, 640, 768, 1024, 1280, 1920],
};
```

```html
<!-- Optimized image example -->
<picture>
  <source srcset="/images/event-hero.avif" type="image/avif" />
  <source srcset="/images/event-hero.webp" type="image/webp" />
  <img
    src="/images/event-hero.jpg"
    alt="Новорічна вечірка 2025 — святкове оформлення"
    width="1200"
    height="630"
    loading="eager"
    fetchpriority="high"
    decoding="async"
  />
</picture>
```

## Caching Strategy

```typescript
// Cache headers by resource type
const cacheConfig = {
  // Static assets (CSS, JS, images) — long cache with hash
  'static': 'public, max-age=31536000, immutable',

  // HTML pages — short cache, revalidate
  'pages': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',

  // API responses — event list (changes rarely)
  'api-events': 'public, max-age=300, s-maxage=600',

  // API responses — booking (no cache)
  'api-bookings': 'private, no-cache, no-store',

  // API responses — dashboard (short)
  'api-dashboard': 'private, max-age=30',
};
```

## Performance Checklist

### Critical
- [ ] Fonts: preload critical fonts, `font-display: swap`
- [ ] CSS: inline critical CSS, defer non-critical
- [ ] JS: code-split routes, lazy load below-fold components
- [ ] Images: proper sizes, WebP/AVIF, lazy loading
- [ ] TTFB: server response < 800ms
- [ ] No layout shifts from images/ads/dynamic content

### Important
- [ ] Gzip/Brotli compression enabled
- [ ] HTTP/2 or HTTP/3
- [ ] Preconnect to external origins (fonts, analytics, CDN)
- [ ] Service Worker for offline-first (event pages)
- [ ] Bundle size < 200KB (gzipped JS)
- [ ] No unused CSS/JS in bundle

### SEO
- [ ] All pages have unique title + description
- [ ] Structured data (Event, Organization)
- [ ] Open Graph tags for social sharing
- [ ] Sitemap.xml generated
- [ ] robots.txt configured
- [ ] Ukrainian hreflang tag
- [ ] Canonical URLs set
- [ ] 404 page with navigation
- [ ] Breadcrumbs on event pages
- [ ] Internal linking between events

## Monitoring

```typescript
// Web Vitals reporting (client-side)
import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals';

function sendToAnalytics(metric) {
  // Send to your analytics endpoint
  fetch('/api/analytics/vitals', {
    method: 'POST',
    body: JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      page: window.location.pathname,
      timestamp: Date.now(),
    }),
  });
}

onCLS(sendToAnalytics);
onINP(sendToAnalytics);
onLCP(sendToAnalytics);
onFCP(sendToAnalytics);
onTTFB(sendToAnalytics);
```

## PR Report Template

When submitting performance improvements, include:
```markdown
## Performance Report

### Before
| Page | Perf | A11y | SEO | LCP | CLS |
|------|------|------|-----|-----|-----|
| Home | 72   | 88   | 82  | 3.2s| 0.25|

### After
| Page | Perf | A11y | SEO | LCP | CLS |
|------|------|------|-----|-----|-----|
| Home | 95   | 98   | 97  | 1.8s| 0.02|

### Changes Made
- [x] Added WebP images with responsive srcset
- [x] Inlined critical CSS
- [x] Added structured data for events
```
