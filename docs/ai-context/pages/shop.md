# Page: Shop

## Route / Location

- Route: `/shop`
- Static file: `shop.html`
- Page controller: `js/shop-page.js`
- Backend routes: `routes/shop.js`, `routes/gamification.js`
- Related navigation: static route, not a primary sidebar item in the inspected NAV_ITEMS.

## Purpose

Shop is the gamification store/profile equipment surface.

## Primary Entities

- Shop item
- Inventory item
- Coin balance
- Profile equipment

## Visible UI

- Shop/inventory/equip controls.

## Available User Actions

- Browse/buy/equip items where allowed by game economy.

## Data Sources

- `routes/shop.js`
- `routes/gamification.js`

## Related Files

- `shop.html`
- `js/shop-page.js`
- `routes/shop.js`

## Assistant Context

On Shop, interpret questions through game economy and profile equipment.
