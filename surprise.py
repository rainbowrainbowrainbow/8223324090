import os
import time
import random

# Simple utility to clear the screen

def clear_screen():
    """Clear the terminal screen unless NO_CLEAR env var is set."""
    if os.environ.get('NO_CLEAR'):
        return
    os.system('cls' if os.name == 'nt' else 'clear')


class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    GRAY = '\033[90m'
    GOLD = '\033[38;5;220m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


# --- Анімації ---

def animate_text(text, delay=0.03):
    for ch in text:
        print(ch, end='', flush=True)
        time.sleep(delay)
    print()


def attack_animation():
    frames = ['-->', '==>', '===>', '>>>']
    for f in frames:
        print(f"{Colors.YELLOW}{f}{Colors.RESET}")
        time.sleep(0.05)

# Дія персонажа - прості пози для різних дій
HERO_ACTION_FRAMES = {
    'attack': [
        ['  O  ', ' /|> ', ' / \\ '],
        ['  O  ', '/ |> ', '/ \\ ']
    ],
    'skill': [
        [' \O/ ', '  |  ', ' / \\ '],
        ['  O  ', ' /|\\ ', ' / \\ ']
    ],
    'drink': [
        ['  O  ', ' /|\\ ', ' / \\ '],
        [' _O_ ', '  |  ', ' / \\ ']
    ]
}

def hero_animation(action):
    frames = HERO_ACTION_FRAMES.get(action, [])
    for fr in frames:
        clear_screen()
        for line in fr:
            print(Colors.CYAN + line + Colors.RESET)
        time.sleep(0.1)


SKILL_ANIMATIONS = {
    'fireball': [' ( ) ', ' (o) ', '( O )', ' /\ ', ''],
    'ice_arrow': ['  *  ', ' /| ', '/ |\\', '  | '],
    'berserk': ['!!!', '!!!', '!!!'],
    'drain_life': [' <+> ', ' <*> ', ' <+> '],
    'risky_blast': ['  *  ', ' *** ', '*****'],
    'ice_wall': ['[===]', '[###]', '[===]'],
    'lightning_chain': [' ~ ', '~~~', ' ~ '],
    'buff_def': ['(+)', '(++)', '(+++)'],
}


def play_skill_animation(name):
    frames = SKILL_ANIMATIONS.get(name, [])
    for fr in frames:
        print(fr)
        time.sleep(0.1)


def intro_animation():
    """Display a short intro with a running hero."""
    title = [
        f"{Colors.BOLD}{Colors.CYAN}Котячий Світ{Colors.RESET}",
        ""
    ]
    for line in title:
        animate_text(line, 0.05)
    hero = ASCII_ART.get("hero_base", [])
    for pos in range(20):
        clear_screen()
        for line in hero:
            print(" " * pos + line)
        time.sleep(0.05)


def fireworks_animation():
    """Simple celebratory fireworks when the hero wins."""
    patterns = [
        "   .",
        "  ...",
        " .....",
        ".......",
        " .....",
        "  ...",
        "   ."
    ]
    for _ in range(3):
        for p in patterns:
            clear_screen()
            print(f"{Colors.YELLOW}{p}{Colors.RESET}")
            time.sleep(0.1)


# --- Класи ---

class Item:
    def __init__(self, name, description, value, item_type="Item"):
        self.name = name
        self.description = description
        self.value = value
        self.item_type = item_type

class Weapon(Item):
    def __init__(self, name, description, value, attack_bonus):
        super().__init__(name, description, value, "Weapon")
        self.attack_bonus = attack_bonus

class Armor(Item):
    def __init__(self, name, description, value, defense_bonus):
        super().__init__(name, description, value, "Armor")
        self.defense_bonus = defense_bonus

class Loot(Item):
    def __init__(self, name, description, value):
        super().__init__(name, description, value, "Loot")

class Skill:
    def __init__(self, name, mana_cost, power, effect, description,
                 advantage="", disadvantage=""):
        self.name = name
        self.mana_cost = mana_cost
        self.power = power
        self.effect = effect
        self.description = description
        self.advantage = advantage
        self.disadvantage = disadvantage


class Passive:
    def __init__(self, name, rarity, effect, description):
        self.name = name
        self.rarity = rarity
        self.effect = effect
        self.description = description


class Buff:
    """Temporary modifier affecting attack and defense."""
    def __init__(self, attack=0, defense=0, turns=1):
        self.attack = attack
        self.defense = defense
        self.turns = turns

class Entity:
    def __init__(self, name, hp, mana, base_attack, base_defense, art):
        self.name = name
        self.max_hp = hp
        self.hp = hp
        self.max_mana = mana
        self.mana = mana
        self.base_attack = base_attack
        self.base_defense = base_defense
        self.art = art

    def get_total_attack(self):
        return self.base_attack

    def get_total_defense(self):
        return self.base_defense

    def take_damage(self, damage):
        dealt = max(0, damage - self.get_total_defense())
        self.hp = max(0, self.hp - dealt)
        return dealt

    def is_alive(self):
        return self.hp > 0

class Player(Entity):
    def __init__(self, name, weapon, armor):
        super().__init__(name, 100, 50, 10, 5, [])
        self.level = 1
        self.xp = 0
        self.xp_to_next_level = 100
        self.gold = 50
        self.potions = 3
        self.inventory = []
        self.skills = {'1': SKILL_POOL['power_strike'], '2': SKILL_POOL['fireball']}
        self.passives = []
        self.weapon = weapon
        self.armor = armor
        self.buffs = []
        self.revived = False

    def has_passive(self, effect):
        return any(p.effect == effect for p in self.passives)

    def passive_turn_effects(self):
        if self.has_passive('regen'):
            self.hp = min(self.max_hp, self.hp + 2)
        if self.has_passive('mana_regen'):
            self.mana = min(self.max_mana, self.mana + 2)

    def get_total_attack(self):
        total = self.base_attack + (self.weapon.attack_bonus if self.weapon else 0)
        total += sum(b.attack for b in self.buffs)
        return total

    def get_total_defense(self):
        total = self.base_defense + (self.armor.defense_bonus if self.armor else 0)
        total += sum(b.defense for b in self.buffs)
        return total

    def tick_buffs(self):
        expired = []
        for buff in self.buffs:
            buff.turns -= 1
            if buff.turns <= 0:
                expired.append(buff)
        for e in expired:
            self.buffs.remove(e)

    def add_to_inventory(self, item, quantity=1):
        for _ in range(quantity):
            self.inventory.append(item)
        animate_text(f"{Colors.GREEN}Отримано: {item.name} x{quantity}{Colors.RESET}")

    def gain_xp(self, amount):
        bonus = int(amount * 0.2) if self.has_passive('xp_boost') else 0
        self.xp += amount + bonus
        animate_text(f"{Colors.YELLOW}Ви отримали {amount + bonus} досвіду!{Colors.RESET}")
        time.sleep(1)
        if self.xp >= self.xp_to_next_level:
            self.level_up()

    def level_up(self):
        self.level += 1
        self.xp = 0
        self.xp_to_next_level = int(self.xp_to_next_level * 1.5)
        self.max_hp += 20
        self.max_mana += 10
        self.base_attack += 3
        self.base_defense += 2
        self.hp = self.max_hp
        self.mana = self.max_mana

        clear_screen()
        animate_text(f"{Colors.GREEN}{Colors.BOLD}РІВЕНЬ ПІДВИЩЕНО! Ви тепер {self.level} рівня!{Colors.RESET}")
        choose_new_skill(self)
        input("\nНатисніть Enter, щоб продовжити...")

    def take_damage(self, damage):
        if self.has_passive('dodge') and random.random() < 0.25:
            animate_text('Ухилення!')
            return 0
        dealt = max(0, damage - self.get_total_defense())
        self.hp = max(0, self.hp - dealt)
        if self.hp <= self.max_hp * 0.25:
            animate_text('Вас хитає від болю!')
        elif self.hp <= self.max_hp * 0.6:
            animate_text('Ви відчуваєте рану.')
        return dealt

class Monster(Entity):
    def __init__(self, name, hp, attack, defense, xp_reward, art, drops):
        super().__init__(name, hp, 0, attack, defense, art)
        self.xp_reward = xp_reward
        self.drops = drops


# --- Дані ---

ASCII_ART = {
    'hero_base': [' /\\_/\\ ', '( o.o )', ' > ^ < '],
    'goblin': [' o-o ', 'o-o-o', '  o  '],
    'spider': ['(o.o)', '/\\^/\\', '\\/v\\/'],
    'skeleton': [' .-. ', '|=| |', '|_|_|'],
    'orc': [' | | ', '|^O^|', '|-^-|'],
    'dragon': [' /\\_/\\ ', '( o.o )', ' > ^ < ']
}

# Build hero art dynamically based on equipment
def get_hero_art(player):
    art = ASCII_ART['hero_base'][:]
    head = art[0]
    body = art[1]
    if player.armor:
        if 'Шолом' in player.armor.name:
            head = head.replace('o.o', '^.^')
        if 'Плащ' in player.armor.name:
            body = body.replace('o.o', 'o^o')
    if player.weapon:
        body = body[:-1] + '>'
    return [head, body, art[2]]

ITEMS = {
    'claw_gloves': Weapon('Кігті Тигрової Лапи', 'Гострі котячі кігті.', 5, 5),
    'kitten_hood': Armor('Шолом Рудого Мурчика', 'Теплий котячий шолом.', 5, 5),
    'whisker': Loot('Вус Кота', 'Пухнастий сувенір.', 3),
    'silk_ball': Loot('Клубок Пряжі', 'М\'який та цінний.', 5),
    'cat_bone': Loot('Котяча Кістка', 'Стара кісточка.', 2),
    'tiger_fang': Loot('Ікло Тигра', 'Вражаючий трофей.', 10),
    'claw_blade': Weapon('Лезо Леопарда', 'Сяюча зброя.', 50, 15),
    'princess_cloak': Armor('Плащ Персидської Принцеси', 'Елегантний захист.', 60, 15),
    'potion': Item('Зілля Здоров\'я', 'Відновлює 50 HP.', 25)
}

# Усі потенційні навички, з яких можна обирати
SKILL_POOL = {
    'power_strike': Skill('Потужний Удар', 15, 1.5, 'damage',
                         'Атака з 1.5x силою.'),
    'fireball': Skill('Вогняна Куля', 20, 30, 'magic_damage',
                     'Завдає 30 магічної шкоди.'),
    'heal': Skill('Лікування', 25, 40, 'heal',
                 'Відновлює 40 HP.'),
    'ice_arrow': Skill('Крижана Стріла', 18, 15, 'slow',
                       'Завдає 15 шкоди та може сповільнити ворога.'),
    'double_strike': Skill('Подвійний Удар', 30, 0.7, 'multi_hit',
                          'Дві швидкі атаки з 0.7x силою кожна.'),
    'magic_shield': Skill('Магічний Щит', 20, 0, 'buff_def',
                         'Збільшує захист на 5 пунктів на 3 ходи.'),
    'berserk': Skill('Берсерк', 10, 0, 'berserk',
                     'Посилює атаку, але послаблює захист на 3 ходи.',
                     advantage='Атака +7', disadvantage='Захист -5'),
    'drain_life': Skill('Поглинання Життя', 20, 20, 'drain',
                        'Завдає 20 шкоди та лікує, але коштує додаткові HP.',
                        advantage='Відновлює здоров\'я',
                        disadvantage='-10 HP при застосуванні'),
    'risky_blast': Skill('Ризикований Вибух', 25, 40, 'risky_blast',
                        'Могутній удар зі шансом отримати шкоду.',
                        advantage='Велика шкода',
                        disadvantage='50% шанс отримати 15 шкоди'),
    'ice_wall': Skill('Крижана Стіна', 15, 0, 'ice_wall',
                     'Тимчасово збільшує захист, але знижує атаку.',
                     advantage='Захист +10', disadvantage='Атака -5'),
    'lightning_chain': Skill('Ланцюг Блискавок', 20, 25, 'lightning_chain',
                            'Б\'є ворога та знижує ваш захист на ход.',
                            advantage='Миттєва шкода',
                            disadvantage='Захист -2 на наступний хід')
}

# Пасивні навички з рідкістю та незвичайними ефектами
PASSIVE_POOL = {
    'quick_learner': Passive('Швидкий Учень', 'common', 'xp_boost',
                             'Отримуєте на 20% більше досвіду'),
    'treasure_hunter': Passive('Шукач Скарбів', 'common', 'gold_boost',
                               'Додає 20% золота після бою'),
    'regen': Passive('Регенерація', 'uncommon', 'regen',
                    'Що хід відновлює 2 HP'),
    'mana_trickle': Passive('Потік Мани', 'uncommon', 'mana_regen',
                           'Що хід відновлює 2 MP'),
    'frost_aura': Passive('Крижана Аура', 'rare', 'frost_aura',
                         'Перший хід ворог має атаку -2'),
    'retaliation': Passive('Відплата', 'rare', 'retaliation',
                          'Повертає 20% отриманої шкоди'),
    'shadow_step': Passive('Тіньовий Крок', 'epic', 'dodge',
                          '25% шанс ухилитись від атаки'),
    'phoenix_heart': Passive('Серце Фенікса', 'legendary', 'revive',
                            'Раз за бій воскресає з 30% HP')
}

RARITY_WEIGHT = {
    'common': 5,
    'uncommon': 4,
    'rare': 3,
    'epic': 2,
    'legendary': 1
}

CRIT_CHANCE = 0.15


# --- Функції ---

def draw_health_bar(current, maximum, length=20, color=Colors.GREEN):
    if maximum == 0:
        return f"{color}[{'-' * length}]{Colors.RESET}"
    percent = current / maximum
    filled_length = int(length * percent)
    bar = '█' * filled_length + '-' * (length - filled_length)
    return f"{color}[{bar}]{Colors.RESET}"


def display_hud(player, monster):
    clear_screen()
    player.art = get_hero_art(player)
    for line in monster.art:
        print(Colors.MAGENTA + line + Colors.RESET)
    player_hp_bar = draw_health_bar(player.hp, player.max_hp)
    player_mana_bar = draw_health_bar(player.mana, player.max_mana, 15, Colors.BLUE)
    print(f"{Colors.BOLD}{player.name} (Рівень: {player.level}) | Золото: {player.gold} {Colors.GOLD}⛁{Colors.RESET}")
    print(f"HP: {player.hp}/{player.max_hp} {player_hp_bar}")
    print(f"MP: {player.mana}/{player.max_mana} {player_mana_bar}")
    if player.hp <= player.max_hp * 0.25:
        status = f"{Colors.RED}Критичні поранення!{Colors.RESET}"
    elif player.hp <= player.max_hp * 0.6:
        status = f"{Colors.YELLOW}Поранення.{Colors.RESET}"
    else:
        status = f"{Colors.GREEN}Почувається добре.{Colors.RESET}"
    print(status)
    weapon_name = player.weapon.name if player.weapon else 'Руки'
    armor_name = player.armor.name if player.armor else 'Одяг'
    weapon_bonus = player.weapon.attack_bonus if player.weapon else 0
    armor_bonus = player.armor.defense_bonus if player.armor else 0
    print(f"Зброя: {weapon_name} (+{weapon_bonus}) | Броня: {armor_name} (+{armor_bonus})")
    print("\n" + " " * 20 + "VS" + "\n")
    monster_hp_bar = draw_health_bar(monster.hp, monster.max_hp, 25, Colors.RED)
    print(f"{Colors.BOLD}{monster.name}{Colors.RESET}")
    print(f"HP: {monster.hp}/{monster.max_hp} {monster_hp_bar}\n")
    for i in range(max(len(player.art), len(monster.art))):
        player_line = player.art[i] if i < len(player.art) else '   '
        monster_line = monster.art[i] if i < len(monster.art) else '     '
        print(f"   {player_line}                {monster_line}")
    print(f"У лапах: {weapon_name} | На коті: {armor_name}")
    print('-' * 50)


def manage_inventory(player):
    while True:
        clear_screen()
        print('--- Ваш Інвентар ---')
        if not player.inventory:
            print('Ваш рюкзак порожній.')
        else:
            for i, item in enumerate(player.inventory):
                print(f"{i+1}. {item.name} - {item.description}")
        print('\n--- Екіпіровка ---')
        print(f"Зброя: {player.weapon.name if player.weapon else 'Немає'}")
        print(f"Броня: {player.armor.name if player.armor else 'Немає'}")
        print("\nВведіть номер предмету, щоб екіпірувати, або 'exit' для виходу.")
        choice = input('> ')
        if choice.lower() == 'exit':
            break
        try:
            item_index = int(choice) - 1
            if 0 <= item_index < len(player.inventory):
                item_to_equip = player.inventory[item_index]
                if isinstance(item_to_equip, Weapon):
                    if player.weapon:
                        player.inventory.append(player.weapon)
                    player.weapon = player.inventory.pop(item_index)
                    print(f"Ви екіпірували {item_to_equip.name}.")
                elif isinstance(item_to_equip, Armor):
                    if player.armor:
                        player.inventory.append(player.armor)
                    player.armor = player.inventory.pop(item_index)
                    print(f"Ви екіпірували {item_to_equip.name}.")
                else:
                    print('Цей предмет не можна екіпірувати.')
                time.sleep(1)
        except (ValueError, IndexError):
            print('Невірний вибір.')


def visit_shop(player):
    shop_inventory = {'1': ITEMS['claw_blade'], '2': ITEMS['princess_cloak'], '3': ITEMS['potion']}
    while True:
        clear_screen()
        print("--- Крамниця 'Муркотикий Базар' ---")
        print("Крамар Мурчик: 'Мяу! Чим цікавитеся?'")
        print(f"Ваше золото: {player.gold} {Colors.GOLD}⛁{Colors.RESET}")
        print('\n1. Купити\n2. Продати\n3. Вийти')
        choice = input('> ')
        if choice == '1':
            print('\n--- Товари на продаж ---')
            for key, item in shop_inventory.items():
                print(f"{key}. {item.name} ({int(item.value * 2)} {Colors.GOLD}⛁{Colors.RESET})")
            buy_choice = input('> ')
            if buy_choice in shop_inventory:
                item = shop_inventory[buy_choice]
                cost = int(item.value * 2)
                if player.gold >= cost:
                    player.gold -= cost
                    if item.name == "Зілля Здоров'я":
                        player.potions += 1
                    else:
                        player.add_to_inventory(item)
                    print(f"Ви купили {item.name}!")
                else:
                    print('Недостатньо золота!')
                time.sleep(1)
        elif choice == '2':
            if not player.inventory:
                print('У вас немає нічого на продаж.')
                time.sleep(1)
                continue
            print('\n--- Ваші предмети на продаж ---')
            for i, item in enumerate(player.inventory):
                print(f"{i+1}. {item.name} (Ціна: {item.value} {Colors.GOLD}⛁{Colors.RESET})")
            sell_choice = input('> ')
            try:
                item_index = int(sell_choice) - 1
                if 0 <= item_index < len(player.inventory):
                    item_to_sell = player.inventory.pop(item_index)
                    player.gold += item_to_sell.value
                    print(f"Ви продали {item_to_sell.name} за {item_to_sell.value} золота.")
                time.sleep(1)
            except (ValueError, IndexError):
                print('Невірний вибір.')
        elif choice == '3':
            print("Гром: 'Бувайте, заходьте ще!'")
            time.sleep(1)
            break


def show_skill_card(skill):
    """Display a short animated card describing a skill."""
    width = max(len(skill.name), len(skill.description), len(skill.advantage)+2,
                 len(skill.disadvantage)+2) + 4
    border = '+' + '-' * width + '+'
    lines = [
        f"| {skill.name.center(width)} |",
        f"| {skill.description.ljust(width)} |",
        f"| +{skill.advantage.ljust(width-1)}|",
        f"| -{skill.disadvantage.ljust(width-1)}|"
    ]
    frames = [border] + lines + [border]
    for _ in range(2):
        for line in frames:
            print(line)
        time.sleep(0.3)
        clear_screen()
    for line in frames:
        print(line)


def show_passive_card(passive):
    width = max(len(passive.name), len(passive.description) + len(passive.rarity) + 3) + 4
    border = '+' + '-' * width + '+'
    lines = [
        f"| {passive.name.center(width)} |",
        f"| [{passive.rarity.upper()}] {passive.description.ljust(width - len(passive.rarity) - 3)} |"
    ]
    frames = [border] + lines + [border]
    for line in frames:
        print(line)


def choose_new_skill(player):
    owned_active = {s.name for s in player.skills.values()}
    owned_passive = {p.name for p in player.passives}
    available_active = sorted([s for s in SKILL_POOL.values() if s.name not in owned_active], key=lambda s: s.name)
    available_passive = sorted([p for p in PASSIVE_POOL.values() if p.name not in owned_passive], key=lambda p: p.name)

    options = []
    if available_passive:
        options.extend(available_passive[:2])
    if available_active:
        options.append(available_active[0])
    if len(options) < 3:
        more = available_active[1:] + available_passive[2:]
        options.extend(more[:3 - len(options)])
    print('Оберіть нову навичку або пасив:')
    for i, opt in enumerate(options, 1):
        if isinstance(opt, Skill):
            print(f"{i}. [Актив] {opt.name}")
            show_skill_card(opt)
        else:
            print(f"{i}. [Пасив] {opt.name} ({opt.rarity})")
            show_passive_card(opt)
    choice = input('> ')
    try:
        idx = int(choice) - 1
        chosen = options[idx]
        if isinstance(chosen, Skill):
            key = str(len(player.skills) + 1)
            player.skills[key] = chosen
        else:
            player.passives.append(chosen)
        animate_text(f"Ви отримали {chosen.name}!")
    except (ValueError, IndexError):
        animate_text('Навичку не вибрано.')


def display_glossary(monsters):
    clear_screen()
    print('=== ГЛОСАРІЙ ===\n')
    print('-- Предмети --')
    for item in ITEMS.values():
        print(f"{item.name}: {item.description}")
    print('\n-- Навички --')
    for skill in SKILL_POOL.values():
        print(f"{skill.name}: {skill.description}")
    print('\n-- Пасивні Навички --')
    for pas in PASSIVE_POOL.values():
        print(f"{pas.name} [{pas.rarity}]: {pas.description}")
    print('\n-- Монстри --')
    for m in monsters:
        print(f"{m.name} (HP: {m.max_hp}, ATK: {m.base_attack}, DEF: {m.base_defense})")
    input('\nНатисніть Enter, щоб повернутись...')


def combat_loop(player, monster):
    player.revived = False
    first_turn = True
    while player.is_alive() and monster.is_alive():
        if first_turn and player.has_passive('frost_aura'):
            monster.base_attack = max(0, monster.base_attack - 2)
            animate_text('Крижана аура послаблює ворога!')
            first_turn = False
        player.tick_buffs()
        player.passive_turn_effects()
        display_hud(player, monster)
        print('1. Атакувати | 2. Навички | 3. Зілля | 4. Інвентар | 8. ???')
        choice = input('> ')
        if choice == '1':
            crit = random.random() < CRIT_CHANCE
            base = player.get_total_attack()
            dmg = base * 2 if crit else base
            damage_dealt = monster.take_damage(int(dmg))
            hero_animation('attack')
            animate_text('Свист клинка!')
            attack_animation()
            if crit:
                animate_text(f"Критичний удар! -{damage_dealt}")
            else:
                animate_text(f"Ви завдали {damage_dealt} шкоди!")
        elif choice == '2':
            print('Оберіть навичку:')
            for key, skill in player.skills.items():
                print(f"{key}. {skill.name} ({skill.mana_cost} MP)")
            skill_choice = input('> ')
            if skill_choice in player.skills:
                skill = player.skills[skill_choice]
                if player.mana >= skill.mana_cost:
                    player.mana -= skill.mana_cost
                    hero_animation('skill')
                    animate_text('Сяйво магії!')
                    if skill.effect == 'heal':
                        healed = min(skill.power, player.max_hp - player.hp)
                        player.hp += healed
                        animate_text(f"Ви використали {skill.name} і відновили {healed} HP!")
                    elif skill.effect == 'buff_def':
                        player.buffs.append(Buff(defense=5, turns=3))
                        animate_text('Захист підвищено!')
                    elif skill.effect == 'berserk':
                        player.buffs.append(Buff(attack=7, defense=-5, turns=3))
                        animate_text('Ви впадаєте в сказ!')
                    elif skill.effect == 'drain':
                        damage_dealt = monster.take_damage(skill.power)
                        player.hp = max(0, player.hp - 10)
                        player.hp = min(player.max_hp, player.hp + damage_dealt)
                        play_skill_animation(skill.effect)
                        animate_text(f"{skill.name}! -{damage_dealt} HP ворогу")
                    elif skill.effect == 'risky_blast':
                        damage_dealt = monster.take_damage(skill.power)
                        if random.random() < 0.5:
                            player.take_damage(15)
                            animate_text('Ви також постраждали!')
                        play_skill_animation(skill.effect)
                        animate_text(f"{skill.name}! -{damage_dealt}")
                    elif skill.effect == 'ice_wall':
                        player.buffs.append(Buff(defense=10, attack=-5, turns=2))
                        animate_text('Перед вами виросла крижана стіна!')
                    elif skill.effect == 'lightning_chain':
                        damage_dealt = monster.take_damage(skill.power)
                        player.buffs.append(Buff(defense=-2, turns=1))
                        play_skill_animation(skill.effect)
                        animate_text(f"{skill.name}! -{damage_dealt}")
                    elif skill.effect == 'damage':
                        damage_dealt = monster.take_damage(int(player.get_total_attack() * skill.power))
                        attack_animation()
                        animate_text(f"{skill.name}! -{damage_dealt}")
                    elif skill.effect == 'magic_damage':
                        damage_dealt = monster.take_damage(skill.power)
                        play_skill_animation('fireball')
                        animate_text(f"{skill.name}! -{damage_dealt}")
                    elif skill.effect == 'multi_hit':
                        dmg1 = monster.take_damage(int(player.get_total_attack() * skill.power))
                        dmg2 = monster.take_damage(int(player.get_total_attack() * skill.power))
                        attack_animation()
                        animate_text(f"{skill.name}! -{dmg1+dmg2}")
                    else:
                        damage_dealt = monster.take_damage(skill.power)
                        play_skill_animation(skill.effect)
                        animate_text(f"{skill.name}! -{damage_dealt}")
                else:
                    print('Недостатньо мани!')
            else:
                print('Невірна навичка.')
        elif choice == '3':
            if player.potions > 0:
                player.potions -= 1
                healed = min(50, player.max_hp - player.hp)
                player.hp += healed
                hero_animation('drink')
                animate_text('Хлюпання зілля!')
                animate_text(f"Ви використали зілля і відновили {healed} HP!")
            else:
                print('У вас немає зілля!')
        elif choice == '4':
            manage_inventory(player)
            continue
        elif choice == '8':
            monster.hp = 0
            animate_text('???')
            continue
        else:
            print('Невідома дія.')
            time.sleep(1)
            continue

        time.sleep(1)
        if monster.is_alive():
            critm = random.random() < CRIT_CHANCE
            base = monster.base_attack * (2 if critm else 1)
            damage_taken = player.take_damage(base)
            if critm:
                animate_text(f"{monster.name} наносить критичний удар {damage_taken}!")
            else:
                animate_text(f"{monster.name} атакує і завдає {damage_taken} шкоди!")
            if player.has_passive('retaliation') and damage_taken > 0:
                retaliation = int(damage_taken * 0.2)
                monster.hp = max(0, monster.hp - retaliation)
                animate_text(f"Відплата {retaliation} шкоди!")
            if player.hp <= 0 and player.has_passive('revive') and not player.revived:
                player.hp = int(player.max_hp * 0.3)
                player.revived = True
                animate_text('Серце Фенікса воскресило вас!')
            time.sleep(1)

    if player.is_alive():
        animate_text(f"Ви перемогли {monster.name}!")
        player.gain_xp(monster.xp_reward)
        gold_dropped = random.randint(monster.xp_reward // 10, monster.xp_reward // 5)
        if player.has_passive('gold_boost'):
            gold_dropped = int(gold_dropped * 1.2)
        player.gold += gold_dropped
        animate_text(f"Ви знайшли {gold_dropped} ⛁")
        for drop in monster.drops:
            if random.random() < drop['chance']:
                player.add_to_inventory(ITEMS[drop['item']], random.randint(drop['quantity'][0], drop['quantity'][1]))
        input('\nНатисніть Enter...')
        return True
    else:
        return False


def main():
    clear_screen()
    intro_animation()
    time.sleep(0.5)
    player_name = input("Введіть ім'я вашого героя: ")
    if not player_name:
        player_name = 'Герой'
    player = Player(player_name, ITEMS['claw_gloves'], ITEMS['kitten_hood'])

    monsters_to_fight = [
        Monster('Гоблін', 50, 10, 2, 50, ASCII_ART['goblin'], [{'item': 'whisker', 'chance': 0.7, 'quantity': (1,2)}]),
        Monster('Павук', 70, 15, 4, 75, ASCII_ART['spider'], [{'item': 'silk_ball', 'chance': 0.6, 'quantity': (1,1)}]),
        Monster('Скелет', 90, 18, 5, 100, ASCII_ART['skeleton'], [{'item': 'cat_bone', 'chance': 0.8, 'quantity': (1,3)}]),
        Monster('Орк', 150, 25, 10, 150, ASCII_ART['orc'], [{'item': 'tiger_fang', 'chance': 0.5, 'quantity': (1,1)}])
    ]
    dragon = Monster('Дракон', 500, 40, 20, 1000, ASCII_ART['dragon'], [])

    current_monster_index = 0
    while current_monster_index < len(monsters_to_fight):
        monster = monsters_to_fight[current_monster_index]
        clear_screen()
        print('Перед вами роздоріжжя. Куди поведе вас доля?')
        print(f'1. Битися з монстром ({monster.name})')
        print('2. Відвідати магазин')
        print('3. Перевірити інвентар')
        print('4. Глосарій')
        print('5. Вийти з гри')
        choice = input('> ')
        if choice == '1':
            if combat_loop(player, monster):
                current_monster_index += 1
            else:
                print('Гра завершена.')
                return
        elif choice == '2':
            visit_shop(player)
        elif choice == '3':
            manage_inventory(player)
        elif choice == '4':
            display_glossary(monsters_to_fight + [dragon])
        else:
            print('Ви вирішили відпочити. Подорож завершено.')
            return

    clear_screen()
    print('Ви пройшли всі випробування і дісталися лігва фінального боса!')
    print('Готуйтеся до битви з Драконом!')
    input('Натисніть Enter, щоб почати бій...')
    if combat_loop(player, dragon):
        animate_text(f"{Colors.GOLD}{Colors.BOLD}Вітаємо, {player.name}! Ви перемогли Дракона і стали легендою!{Colors.RESET}")
        time.sleep(0.5)
        fireworks_animation()
    else:
        print('Гра завершена.')


if __name__ == '__main__':
    main()
