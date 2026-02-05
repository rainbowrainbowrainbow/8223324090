import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const db = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding database...');

  // ── Admin Manager ───────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin123!', 12);

  const admin = await db.manager.upsert({
    where: { email: 'admin@park-booking.com' },
    update: {},
    create: {
      name: 'Адміністратор',
      email: 'admin@park-booking.com',
      phone: '+380501234567',
      telegramChatId: '-1001805304620',
      role: 'ADMIN',
      passwordHash: adminPassword,
      isActive: true,
    },
  });
  console.log(`  ✅ Admin: ${admin.email}`);

  // ── Manager ─────────────────────────────────────────────────────
  const managerPassword = await bcrypt.hash('Manager1!', 12);

  const manager = await db.manager.upsert({
    where: { email: 'manager@park-booking.com' },
    update: {},
    create: {
      name: 'Менеджер Олена',
      email: 'manager@park-booking.com',
      phone: '+380507654321',
      role: 'MANAGER',
      passwordHash: managerPassword,
      isActive: true,
    },
  });
  console.log(`  ✅ Manager: ${manager.email}`);

  // ── Sample Events ───────────────────────────────────────────────
  const events = [
    {
      title: 'Новорічна вечірка 2025',
      slug: 'new-year-party-2025',
      description: 'Незабутня новорічна вечірка у парку Закревського!',
      type: 'HOLIDAY' as const,
      dateStart: new Date('2025-12-31T18:00:00Z'),
      dateEnd: new Date('2026-01-01T03:00:00Z'),
      location: 'Парк Закревського, Київ',
      locationLat: 50.5195,
      locationLng: 30.6137,
      capacityMin: 20,
      capacityMax: 100,
      pricePerPerson: 1500,
      basePrice: 5000,
      depositPercent: 30,
      status: 'PUBLISHED' as const,
      tags: ['новий-рік', 'вечірка', 'парк'],
      managerId: admin.id,
    },
    {
      title: 'Дитячий день народження',
      slug: 'kids-birthday-standard',
      description: 'Аніматори, розваги та торт для вашої дитини!',
      type: 'BIRTHDAY' as const,
      dateStart: new Date('2025-06-15T14:00:00Z'),
      dateEnd: new Date('2025-06-15T18:00:00Z'),
      location: 'Парк Закревського, зона відпочинку',
      capacityMin: 5,
      capacityMax: 30,
      pricePerPerson: 800,
      basePrice: 3000,
      depositPercent: 50,
      status: 'PUBLISHED' as const,
      tags: ['день-народження', 'діти', 'аніматори'],
      managerId: manager.id,
    },
    {
      title: 'Корпоративний тімбілдінг',
      slug: 'corporate-teambuilding',
      description: 'Професійний тімбілдінг для вашої команди.',
      type: 'CORPORATE' as const,
      dateStart: new Date('2025-09-20T10:00:00Z'),
      dateEnd: new Date('2025-09-20T17:00:00Z'),
      location: 'Парк Закревського, конференц-зона',
      capacityMin: 10,
      capacityMax: 50,
      pricePerPerson: 2000,
      basePrice: 10000,
      depositPercent: 30,
      status: 'DRAFT' as const,
      tags: ['корпоратив', 'тімбілдінг'],
      managerId: admin.id,
    },
  ];

  for (const eventData of events) {
    const event = await db.event.upsert({
      where: { slug: eventData.slug },
      update: {},
      create: eventData,
    });
    console.log(`  ✅ Event: ${event.title} (${event.status})`);
  }

  // ── Promo Code ──────────────────────────────────────────────────
  const promo = await db.promoCode.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: {
      code: 'WELCOME10',
      discountPercent: 10,
      maxUses: 100,
      validFrom: new Date('2025-01-01'),
      validUntil: new Date('2025-12-31'),
      isActive: true,
    },
  });
  console.log(`  ✅ Promo: ${promo.code} (-${promo.discountPercent}%)`);

  // ── Sample Client ───────────────────────────────────────────────
  const client = await db.client.upsert({
    where: { phone: '+380991234567' },
    update: {},
    create: {
      fullName: 'Іванов Іван',
      phone: '+380991234567',
      email: 'ivan@example.com',
      source: 'WEBSITE',
    },
  });
  console.log(`  ✅ Client: ${client.fullName}`);

  console.log('\n✅ Seed completed!');
}

seed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
