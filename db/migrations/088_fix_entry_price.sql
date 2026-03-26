-- Fix entry price: 5 → 10 UAH
UPDATE graduation_services SET price_per_child = 10 WHERE name = 'Вхід' AND price_per_child < 10;
