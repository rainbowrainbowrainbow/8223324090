'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.CatalogDiscountCalculator = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    const BPS_DENOMINATOR = 10000n;
    const HALF_BPS = 5000n;

    function discountRateBps(discount, options = {}) {
        const value = Number(discount?.rate_bps ?? discount?.rateBps ?? 0);
        const valid = Number.isInteger(value) && value >= 0 && value <= 10000;
        if (!valid) {
            if (options.strict) {
                const error = new Error('catalog_discount_invalid');
                error.code = 'catalog_discount_invalid';
                throw error;
            }
            return 0;
        }
        return value;
    }

    function discountEligibilityMode(discount) {
        return String(discount?.eligibility_mode ?? discount?.eligibilityMode ?? 'explicit')
            .trim()
            .toLowerCase() || 'explicit';
    }

    function itemClubDirection(item) {
        const rule = item?.quantityRule || item?.quantity_rule || item?.sale_config || {};
        return String(rule.club_direction ?? rule.clubDirection ?? '').trim();
    }

    function discountAppliesToItem(discount, { item, firstDirection } = {}) {
        const mode = discountEligibilityMode(discount);
        if (mode === 'explicit') return true;
        if (mode === 'second_club_direction') {
            const direction = itemClubDirection(item);
            return Boolean(direction && firstDirection && direction !== firstDirection);
        }
        return false;
    }

    function normalizeDiscountList(discounts) {
        if (!discounts) return [];
        if (discounts instanceof Map) return [...discounts.values()];
        return Array.isArray(discounts) ? [...discounts] : [];
    }

    function selectLineDiscount(discounts, context = {}, options = {}) {
        return normalizeDiscountList(discounts)
            .filter(discount => {
                discountRateBps(discount, options);
                return discountAppliesToItem(discount, context);
            })
            .sort((left, right) => discountRateBps(right, options) - discountRateBps(left, options))[0] || null;
    }

    function itemPriceMinor(item) {
        if (item?.priceMinor != null) return BigInt(item.priceMinor);
        if (item?.price_minor != null) return BigInt(item.price_minor);
        if (item?.price_uah != null) return BigInt(item.price_uah) * 100n;
        return 0n;
    }

    function quantityRule(item) {
        const source = item?.quantityRule || item?.quantity_rule || item?.sale_config || {};
        const minimumMillis = Number(source.minimum_quantity_millis ?? source.minimumQuantityMillis ?? 1000);
        const stepMillis = Number(source.quantity_step_millis ?? source.quantityStepMillis ?? 1000);
        return {
            minimumMillis: Number.isSafeInteger(minimumMillis) && minimumMillis > 0 ? minimumMillis : 1000,
            stepMillis: Number.isSafeInteger(stepMillis) && stepMillis > 0 ? stepMillis : 1000
        };
    }

    function roundDiscountedUnitMinor(originalUnitMinor, rateBps) {
        const original = BigInt(originalUnitMinor);
        const rate = BigInt(rateBps);
        return (original * (BPS_DENOMINATOR - rate) + HALF_BPS) / BPS_DENOMINATOR;
    }

    function quoteCatalogLines(lines, catalog, discounts, options = {}) {
        const productFor = itemCode => catalog instanceof Map
            ? catalog.get(itemCode)
            : catalog?.[itemCode];
        const firstDirection = lines
            .map(line => itemClubDirection(productFor(line.itemCode)))
            .find(Boolean) || null;

        return lines.map((line, index) => {
            const item = productFor(line.itemCode);
            if (!item) {
                const error = new Error('catalog_item_unavailable');
                error.code = 'catalog_item_unavailable';
                throw error;
            }
            const quantityMillis = Number(line.quantityMillis ?? line.quantity_millis ?? 1000);
            if (options.validateQuantity) {
                const rule = quantityRule(item);
                if (!Number.isSafeInteger(quantityMillis)
                    || quantityMillis < rule.minimumMillis
                    || quantityMillis % rule.stepMillis !== 0) {
                    const error = new Error('catalog_quantity_invalid');
                    error.code = 'catalog_quantity_invalid';
                    error.details = {
                        itemCode: line.itemCode,
                        minimumQuantityMillis: rule.minimumMillis,
                        quantityStepMillis: rule.stepMillis
                    };
                    throw error;
                }
            }
            const discount = selectLineDiscount(discounts, { item, firstDirection }, options);
            const originalUnitMinor = itemPriceMinor(item);
            const rateBps = discountRateBps(discount, options);
            const finalUnitMinor = roundDiscountedUnitMinor(originalUnitMinor, rateBps);
            const quantityMinorFactor = BigInt(quantityMillis);
            const originalTotalMinor = originalUnitMinor * quantityMinorFactor / 1000n;
            const totalMinor = finalUnitMinor * quantityMinorFactor / 1000n;
            return {
                index: index + 1,
                item,
                product: item,
                quantityMillis: BigInt(quantityMillis),
                originalUnitMinor,
                discountMinor: originalUnitMinor - finalUnitMinor,
                finalUnitMinor,
                originalTotalMinor,
                totalDiscountMinor: originalTotalMinor - totalMinor,
                totalMinor,
                discount
            };
        });
    }

    return {
        discountRateBps,
        discountEligibilityMode,
        itemClubDirection,
        discountAppliesToItem,
        selectLineDiscount,
        itemPriceMinor,
        quantityRule,
        roundDiscountedUnitMinor,
        quoteCatalogLines
    };
});
