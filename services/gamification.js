/**
 * services/gamification.js — Gamification engine (v22.2.0)
 *
 * Achievement checking, coin management, inventory, leveling, shop purchases.
 * Integrates with existing user_points, user_achievements, user_streaks.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Gamification');

// XP rewards for various actions
const XP_REWARDS = {
    task_complete: 10,
    booking_create: 5,
    achievement_unlock: 25,
    daily_login: 3,
    streak_bonus: 5
};

/**
 * Ensure user has a gamification profile. Creates one if missing.
 */
async function ensureProfile(username) {
    const { rows } = await pool.query(
        `INSERT INTO user_profiles_ext (username)
         VALUES ($1)
         ON CONFLICT (username) DO NOTHING
         RETURNING *`,
        [username]
    );
    if (rows.length > 0) return rows[0];

    const existing = await pool.query(
        'SELECT * FROM user_profiles_ext WHERE username = $1',
        [username]
    );
    return existing.rows[0];
}

/**
 * Ensure user has a coin balance record.
 */
async function ensureCurrency(username) {
    await pool.query(
        `INSERT INTO game_currency (username, coins)
         VALUES ($1, 0)
         ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
         RETURNING *`,
        [username]
    );
}

/**
 * Get full profile data for a user (profile + coins + achievements + inventory + equipped).
 */
async function getProfile(username) {
    await ensureProfile(username);
    await ensureCurrency(username);

    const [profile, currency, achievements, inventory, equipped, streaks] = await Promise.all([
        pool.query('SELECT * FROM user_profiles_ext WHERE username = $1', [username]),
        pool.query('SELECT * FROM game_currency WHERE username = $1', [username]),
        pool.query(
            `SELECT ua.*, ac.name, ac.description, ac.icon, ac.type, ac.category, ac.rarity, ac.is_secret
             FROM user_achievements ua
             LEFT JOIN achievement_catalog ac ON ua.achievement_key = ac.key
             WHERE ua.username = $1
             ORDER BY ua.unlocked_at DESC`,
            [username]
        ),
        pool.query(
            `SELECT ui.*, ci.name, ci.description, ci.icon, ci.type, ci.rarity, ci.image_url
             FROM user_inventory ui
             JOIN character_items ci ON ui.item_id = ci.id
             WHERE ui.username = $1
             ORDER BY ui.acquired_at DESC`,
            [username]
        ),
        pool.query(
            `SELECT ue.slot, ue.item_id, ci.name, ci.icon, ci.type, ci.rarity, ci.image_url
             FROM user_equipped ue
             JOIN character_items ci ON ue.item_id = ci.id
             WHERE ue.username = $1`,
            [username]
        ),
        pool.query('SELECT * FROM user_streaks WHERE username = $1', [username])
    ]);

    const level = await getCurrentLevel(profile.rows[0]?.xp || 0);

    return {
        profile: profile.rows[0],
        currency: currency.rows[0],
        achievements: achievements.rows,
        inventory: inventory.rows,
        equipped: equipped.rows,
        streaks: streaks.rows[0] || { current_streak: 0, longest_streak: 0 },
        level,
        achievementCount: achievements.rows.length
    };
}

/**
 * Get level info from XP amount.
 */
async function getCurrentLevel(xp) {
    const { rows } = await pool.query(
        `SELECT * FROM level_thresholds
         WHERE xp_required <= $1
         ORDER BY level DESC
         LIMIT 1`,
        [xp || 0]
    );
    const current = rows[0] || { level: 1, xp_required: 0, title: 'Новачок' };

    const next = await pool.query(
        'SELECT * FROM level_thresholds WHERE level = $1',
        [current.level + 1]
    );

    return {
        level: current.level,
        title: current.title,
        xp: xp || 0,
        xpForCurrent: current.xp_required,
        xpForNext: next.rows[0]?.xp_required || null,
        nextTitle: next.rows[0]?.title || null,
        isMaxLevel: next.rows.length === 0
    };
}

/**
 * Award coins to a user.
 */
async function awardCoins(username, amount, reason, sourceType = 'admin', sourceId = null) {
    if (amount <= 0) return;

    await ensureCurrency(username);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `UPDATE game_currency
             SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW()
             WHERE username = $2`,
            [amount, username]
        );

        await client.query(
            `INSERT INTO coin_transactions (username, amount, type, reason, source_type, source_id)
             VALUES ($1, $2, 'earn', $3, $4, $5)`,
            [username, amount, reason, sourceType, sourceId]
        );

        await client.query('COMMIT');
        log.info(`Awarded ${amount} coins to ${username}: ${reason}`);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Award coins error', err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Spend coins (for shop purchases).
 */
async function spendCoins(username, amount, reason, sourceType = 'shop', sourceId = null) {
    if (amount <= 0) return false;

    await ensureCurrency(username);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT coins FROM game_currency WHERE username = $1 FOR UPDATE',
            [username]
        );

        if (!rows[0] || rows[0].coins < amount) {
            await client.query('ROLLBACK');
            return false;
        }

        await client.query(
            `UPDATE game_currency
             SET coins = coins - $1, total_spent = total_spent + $1, updated_at = NOW()
             WHERE username = $2`,
            [amount, username]
        );

        await client.query(
            `INSERT INTO coin_transactions (username, amount, type, reason, source_type, source_id)
             VALUES ($1, $2, 'spend', $3, $4, $5)`,
            [username, -amount, reason, sourceType, sourceId]
        );

        await client.query('COMMIT');
        log.info(`${username} spent ${amount} coins: ${reason}`);
        return true;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Spend coins error', err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Award XP and check for level up.
 */
async function awardXP(username, amount) {
    if (amount <= 0) return null;

    await ensureProfile(username);

    const oldProfile = await pool.query(
        'SELECT xp, level FROM user_profiles_ext WHERE username = $1',
        [username]
    );
    const oldXP = oldProfile.rows[0]?.xp || 0;
    const newXP = oldXP + amount;

    const newLevel = await getCurrentLevel(newXP);

    await pool.query(
        `UPDATE user_profiles_ext
         SET xp = $1, level = $2, title = $3, updated_at = NOW()
         WHERE username = $4`,
        [newXP, newLevel.level, newLevel.title, username]
    );

    const oldLevel = oldProfile.rows[0]?.level || 1;
    if (newLevel.level > oldLevel) {
        log.info(`${username} leveled up: ${oldLevel} → ${newLevel.level} (${newLevel.title})`);
        return { leveledUp: true, oldLevel, newLevel: newLevel.level, title: newLevel.title };
    }

    return { leveledUp: false };
}

/**
 * Check and unlock achievements for a user.
 * Called after task completion, booking creation, etc.
 */
async function checkAchievements(username, context = {}) {
    const unlocked = [];

    // Get all active achievements user hasn't unlocked yet
    const { rows: pending } = await pool.query(
        `SELECT ac.* FROM achievement_catalog ac
         WHERE ac.is_active = true
         AND ac.key NOT IN (
             SELECT achievement_key FROM user_achievements WHERE username = $1
         )`,
        [username]
    );

    for (const ach of pending) {
        let shouldUnlock = false;

        switch (ach.condition_type) {
            case 'task_count': {
                const { rows } = await pool.query(
                    "SELECT COUNT(*) FROM tasks WHERE assignee = $1 AND status = 'done'",
                    [username]
                );
                shouldUnlock = parseInt(rows[0].count) >= ach.condition_value;
                break;
            }
            case 'booking_count': {
                const { rows } = await pool.query(
                    'SELECT COUNT(*) FROM bookings WHERE created_by = $1',
                    [username]
                );
                shouldUnlock = parseInt(rows[0].count) >= ach.condition_value;
                break;
            }
            case 'streak': {
                const { rows } = await pool.query(
                    'SELECT current_streak, longest_streak FROM user_streaks WHERE username = $1',
                    [username]
                );
                const longest = rows[0]?.longest_streak || 0;
                shouldUnlock = longest >= ach.condition_value;
                break;
            }
            case 'manual': {
                // Manual achievements are unlocked explicitly via API
                if (context.manualKey === ach.key) {
                    shouldUnlock = true;
                }
                break;
            }
        }

        if (shouldUnlock) {
            await unlockAchievement(username, ach);
            unlocked.push(ach);
        }
    }

    return unlocked;
}

/**
 * Unlock a specific achievement for a user.
 */
async function unlockAchievement(username, achievement) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Insert into user_achievements
        await client.query(
            `INSERT INTO user_achievements (username, achievement_key, achievement_id, progress, max_progress, coins_awarded, xp_awarded, unlocked_at)
             VALUES ($1, $2, $3, $4, $4, $5, $6, NOW())
             ON CONFLICT (username, achievement_key) DO NOTHING`,
            [username, achievement.key, achievement.id, achievement.condition_value,
             achievement.reward_type === 'coins' ? achievement.reward_value : 0,
             XP_REWARDS.achievement_unlock]
        );

        // Award coins if reward type is coins
        if (achievement.reward_type === 'coins' && achievement.reward_value > 0) {
            await ensureCurrency(username);
            await client.query(
                `UPDATE game_currency
                 SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW()
                 WHERE username = $2`,
                [achievement.reward_value, username]
            );
            await client.query(
                `INSERT INTO coin_transactions (username, amount, type, reason, source_type, source_id)
                 VALUES ($1, $2, 'earn', $3, 'achievement', $4)`,
                [username, achievement.reward_value, `Ачивка: ${achievement.name}`, achievement.id]
            );
        }

        // Award item if reward type is item
        if (achievement.reward_type === 'item' && achievement.reward_item_id) {
            await client.query(
                `INSERT INTO user_inventory (username, item_id, acquired_via)
                 VALUES ($1, $2, 'achievement')
                 ON CONFLICT (username, item_id) DO NOTHING`,
                [username, achievement.reward_item_id]
            );
        }

        await client.query('COMMIT');
        log.info(`${username} unlocked achievement: ${achievement.name} (${achievement.rarity})`);

        // Award XP (outside transaction — non-critical)
        await awardXP(username, XP_REWARDS.achievement_unlock).catch(() => {});

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Unlock achievement error', err);
    } finally {
        client.release();
    }
}

/**
 * Purchase an item from the shop.
 */
async function purchaseShopItem(username, shopItemId) {
    const { rows: items } = await pool.query(
        `SELECT si.*, ci.id as char_item_id
         FROM shop_items si
         LEFT JOIN character_items ci ON si.item_id = ci.id
         WHERE si.id = $1 AND si.is_active = true`,
        [shopItemId]
    );

    if (items.length === 0) {
        return { success: false, error: 'Товар не знайдено' };
    }

    const item = items[0];

    // Check stock
    if (item.stock === 0) {
        return { success: false, error: 'Товар закінчився' };
    }

    // Check if user already owns this digital item
    if (item.char_item_id) {
        const { rows: owned } = await pool.query(
            'SELECT id FROM user_inventory WHERE username = $1 AND item_id = $2',
            [username, item.char_item_id]
        );
        if (owned.length > 0) {
            return { success: false, error: 'Ви вже маєте цей предмет' };
        }
    }

    // Spend coins
    const spent = await spendCoins(username, item.price_coins, `Покупка: ${item.name}`, 'shop', shopItemId);
    if (!spent) {
        return { success: false, error: 'Недостатньо монет' };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Add to inventory if digital item
        if (item.char_item_id) {
            await client.query(
                `INSERT INTO user_inventory (username, item_id, acquired_via)
                 VALUES ($1, $2, 'shop')
                 ON CONFLICT (username, item_id) DO NOTHING`,
                [username, item.char_item_id]
            );
        }

        // Record purchase
        const status = item.type === 'real' ? 'pending_pickup' : 'completed';
        await client.query(
            `INSERT INTO shop_purchases (username, shop_item_id, coins_paid, status)
             VALUES ($1, $2, $3, $4)`,
            [username, shopItemId, item.price_coins, status]
        );

        // Decrease stock if limited
        if (item.stock > 0) {
            await client.query(
                'UPDATE shop_items SET stock = stock - 1 WHERE id = $1',
                [shopItemId]
            );
        }

        await client.query('COMMIT');
        log.info(`${username} purchased: ${item.name} for ${item.price_coins} coins`);

        return { success: true, item: item.name, status };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Purchase error', err);
        return { success: false, error: 'Помилка покупки' };
    } finally {
        client.release();
    }
}

/**
 * Equip an item to a character slot.
 */
async function equipItem(username, itemId) {
    // Verify user owns the item
    const { rows: owned } = await pool.query(
        `SELECT ui.*, ci.type as slot_type
         FROM user_inventory ui
         JOIN character_items ci ON ui.item_id = ci.id
         WHERE ui.username = $1 AND ui.item_id = $2`,
        [username, itemId]
    );

    if (owned.length === 0) {
        return { success: false, error: 'Предмет не знайдено в інвентарі' };
    }

    const slot = owned[0].slot_type;

    await pool.query(
        `INSERT INTO user_equipped (username, slot, item_id, equipped_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (username, slot) DO UPDATE SET item_id = $3, equipped_at = NOW()`,
        [username, slot, itemId]
    );

    return { success: true, slot };
}

/**
 * Unequip an item from a slot.
 */
async function unequipSlot(username, slot) {
    await pool.query(
        'DELETE FROM user_equipped WHERE username = $1 AND slot = $2',
        [username, slot]
    );
    return { success: true };
}

/**
 * Get leaderboard (top users by coins/xp/achievements).
 */
async function getLeaderboard(sortBy = 'xp', limit = 20) {
    let query;
    switch (sortBy) {
        case 'coins':
            query = `SELECT gc.username, gc.coins, gc.total_earned,
                        upe.level, upe.title, upe.avatar_url, upe.display_name,
                        (SELECT COUNT(*) FROM user_achievements ua WHERE ua.username = gc.username) as achievement_count
                     FROM game_currency gc
                     LEFT JOIN user_profiles_ext upe ON gc.username = upe.username
                     ORDER BY gc.coins DESC
                     LIMIT $1`;
            break;
        case 'achievements':
            query = `SELECT ua.username, COUNT(*) as achievement_count,
                        upe.level, upe.title, upe.avatar_url, upe.display_name,
                        COALESCE(gc.coins, 0) as coins
                     FROM user_achievements ua
                     LEFT JOIN user_profiles_ext upe ON ua.username = upe.username
                     LEFT JOIN game_currency gc ON ua.username = gc.username
                     GROUP BY ua.username, upe.level, upe.title, upe.avatar_url, upe.display_name, gc.coins
                     ORDER BY achievement_count DESC
                     LIMIT $1`;
            break;
        default: // xp
            query = `SELECT upe.username, upe.xp, upe.level, upe.title, upe.avatar_url, upe.display_name,
                        COALESCE(gc.coins, 0) as coins,
                        (SELECT COUNT(*) FROM user_achievements ua WHERE ua.username = upe.username) as achievement_count
                     FROM user_profiles_ext upe
                     LEFT JOIN game_currency gc ON upe.username = gc.username
                     ORDER BY upe.xp DESC
                     LIMIT $1`;
    }

    const { rows } = await pool.query(query, [Math.min(limit, 50)]);
    return rows;
}

/**
 * Get achievement catalog (all available achievements).
 */
async function getAchievementCatalog(username = null) {
    const { rows } = await pool.query(
        `SELECT ac.*,
            CASE WHEN ua.id IS NOT NULL THEN true ELSE false END as unlocked,
            ua.unlocked_at
         FROM achievement_catalog ac
         LEFT JOIN user_achievements ua ON ac.key = ua.achievement_key AND ua.username = $1
         WHERE ac.is_active = true AND (ac.is_secret = false OR ua.id IS NOT NULL)
         ORDER BY ac.sort_order, ac.rarity DESC`,
        [username]
    );
    return rows;
}

/**
 * Get shop catalog.
 */
async function getShopCatalog(username = null) {
    let query = `SELECT si.*,
        ci.rarity as item_rarity, ci.type as item_type
        FROM shop_items si
        LEFT JOIN character_items ci ON si.item_id = ci.id
        WHERE si.is_active = true AND (si.stock != 0 OR si.stock = -1)
        ORDER BY si.is_featured DESC, si.sort_order, si.price_coins`;

    const { rows } = await pool.query(query);

    // If username provided, mark owned items
    if (username) {
        const { rows: owned } = await pool.query(
            'SELECT item_id FROM user_inventory WHERE username = $1',
            [username]
        );
        const ownedSet = new Set(owned.map(r => r.item_id));
        for (const item of rows) {
            item.owned = item.item_id ? ownedSet.has(item.item_id) : false;
        }
    }

    return rows;
}

/**
 * Get coin transaction history.
 */
async function getCoinHistory(username, limit = 50, offset = 0) {
    const [transactions, countResult] = await Promise.all([
        pool.query(
            `SELECT * FROM coin_transactions
             WHERE username = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [username, Math.min(limit, 100), offset]
        ),
        pool.query(
            'SELECT COUNT(*) FROM coin_transactions WHERE username = $1',
            [username]
        )
    ]);

    return {
        transactions: transactions.rows,
        total: parseInt(countResult.rows[0].count)
    };
}

/**
 * Update user profile (bio, hobbies, display_name).
 */
async function updateProfile(username, data) {
    await ensureProfile(username);

    const allowed = ['display_name', 'bio', 'hobbies', 'avatar_url', 'is_public'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
        if (data[key] !== undefined) {
            updates.push(`${key} = $${idx}`);
            values.push(data[key]);
            idx++;
        }
    }

    if (updates.length === 0) return;

    updates.push(`updated_at = NOW()`);
    values.push(username);

    await pool.query(
        `UPDATE user_profiles_ext SET ${updates.join(', ')} WHERE username = $${idx}`,
        values
    );
}

/**
 * Gift coins to another user.
 */
async function giftCoins(fromUser, toUser, amount) {
    if (amount <= 0 || amount > 1000) {
        return { success: false, error: 'Невірна сума (1-1000)' };
    }

    const spent = await spendCoins(fromUser, amount, `Подарунок для ${toUser}`, 'gift', null);
    if (!spent) {
        return { success: false, error: 'Недостатньо монет' };
    }

    await ensureCurrency(toUser);
    await pool.query(
        `UPDATE game_currency SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW()
         WHERE username = $2`,
        [amount, toUser]
    );
    await pool.query(
        `INSERT INTO coin_transactions (username, amount, type, reason, source_type)
         VALUES ($1, $2, 'gift_in', $3, 'gift')`,
        [toUser, amount, `Подарунок від ${fromUser}`]
    );

    return { success: true };
}

/**
 * Hook: called when a task is completed.
 * Awards coins + XP + checks achievements.
 */
async function onTaskComplete(username, task) {
    try {
        await ensureProfile(username);
        await ensureCurrency(username);

        // Award coins based on task priority
        const coinReward = task.priority === 'high' ? 15 : task.priority === 'medium' ? 10 : 5;
        await awardCoins(username, coinReward, `Завдання: ${task.title || 'задача'}`, 'task', task.id);

        // Award XP
        await awardXP(username, XP_REWARDS.task_complete);

        // Check achievements
        const unlocked = await checkAchievements(username);

        return { coins: coinReward, xp: XP_REWARDS.task_complete, achievements: unlocked };
    } catch (err) {
        log.error('onTaskComplete error', err);
        return null;
    }
}

/**
 * Hook: called when a booking is created.
 */
async function onBookingCreate(username) {
    try {
        await ensureProfile(username);
        await ensureCurrency(username);

        await awardCoins(username, 5, 'Нове бронювання', 'task');
        await awardXP(username, XP_REWARDS.booking_create);
        const unlocked = await checkAchievements(username);

        return { coins: 5, xp: XP_REWARDS.booking_create, achievements: unlocked };
    } catch (err) {
        log.error('onBookingCreate error', err);
        return null;
    }
}

module.exports = {
    ensureProfile,
    ensureCurrency,
    getProfile,
    getCurrentLevel,
    awardCoins,
    spendCoins,
    awardXP,
    checkAchievements,
    unlockAchievement,
    purchaseShopItem,
    equipItem,
    unequipSlot,
    getLeaderboard,
    getAchievementCatalog,
    getShopCatalog,
    getCoinHistory,
    updateProfile,
    giftCoins,
    onTaskComplete,
    onBookingCreate
};
