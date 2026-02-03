import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users } from '../src/db/schema/users';
import { hashPassword } from '../src/lib/auth/password';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is not set');
  process.exit(1);
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

async function seedDefaultUser() {
  const email = 'andrei@hasna.com';
  const password = 'clszXC+7CzV2U3MFrDG1UweLq8mAbJax';

  console.log('Seeding default user...');

  try {
    const hashedPassword = await hashPassword(password);

    await db.insert(users).values({
      email,
      name: 'Andrei Hasna',
      passwordHash: hashedPassword,
      role: 'admin',
      emailVerified: true,
    }).onConflictDoNothing();

    console.log('Default user seeded successfully:');
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}`);
    console.log(`  Role: admin`);
  } catch (error) {
    console.error('Error seeding user:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seedDefaultUser();
