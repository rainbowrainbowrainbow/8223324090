-- v20.6.0 + v20.7.0: Page statuses, Leads, Sales Scripts, Booking source

-- 6.1: Page statuses for sidebar badges
CREATE TABLE IF NOT EXISTS page_statuses (
  id SERIAL PRIMARY KEY,
  page_path VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'ready',
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO page_statuses (page_path, status) VALUES
  ('/', 'ready'),
  ('/center', 'in_tests'),
  ('/tasks', 'ready'),
  ('/art', 'in_tests'),
  ('/programs', 'ready'),
  ('/customers', 'in_tests'),
  ('/staff', 'testing'),
  ('/warehouse', 'testing'),
  ('/designs', 'testing'),
  ('/hr', 'testing'),
  ('/training', 'building'),
  ('/demo', 'updated'),
  ('/settings', 'ready'),
  ('/finance', 'ready'),
  ('/analytics', 'ready')
ON CONFLICT DO NOTHING;

-- 7.1: Leads table for hot lead tracking
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  client_name VARCHAR(200),
  phone VARCHAR(50),
  telegram_id BIGINT,
  program_id INT,
  event_date DATE,
  children_count INT,
  child_age INT,
  status VARCHAR(30) DEFAULT 'new',
  assigned_to INT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  last_contact_at TIMESTAMP,
  booked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

-- 7.2: Booking source tracking
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source VARCHAR(50);

-- 7.4: Sales scripts for managers
CREATE TABLE IF NOT EXISTS sales_scripts (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100),
  trigger_phrase VARCHAR(200),
  response_text TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO sales_scripts (category, trigger_phrase, response_text, sort_order) VALUES
  ('Заперечення', 'Клієнт: "Дорого"', 'Розумію вас. Якщо порахувати на 10 дітей — це 180 грн на дитину. За 2 години з аніматором і костюмами. В кіно виходить дорожче, а там немає ні анімації ні сценарію.', 1),
  ('Заперечення', 'Клієнт: "Я подумаю"', 'Звичайно! Щоб допомогти вам — скажіть, що для вас найважливіше: ціна, дата, програма або щось інше?', 2),
  ('Заперечення', 'Клієнт: "Ми ще не вирішили дату"', 'Зрозуміло! Хочу попередити — популярні суботи у нас займаються за 2-3 тижні. Якщо маєте приблизний місяць — можу подивитись що є і зарезервувати попередньо.', 3),
  ('Закриття', 'Альтернативне питання', 'Вам зручніше субота чи неділя?', 4),
  ('Закриття', 'Фіксація дати', 'Відмінно! Записую вас на [дату]. Надішлю підтвердження в Telegram. Передоплата 300 грн для фіксації.', 5),
  ('Апсейл', 'Торт', 'До речі, багато батьків додають торт від нашого партнера. Діти дуже раді. Це ще +350 грн але свято стає завершеним. Хочете включу?', 6),
  ('Апсейл', 'Фотосесія', 'Ще є варіант з фотосесією — 30 хвилин до квесту. Залишаться фото на память. +500 грн. Часто беруть.', 7)
ON CONFLICT DO NOTHING;
