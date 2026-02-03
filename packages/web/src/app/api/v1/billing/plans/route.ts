import { db } from '@/db';
import { subscriptionPlans } from '@/db/schema';
import { successResponse, errorResponse } from '@/lib/api/response';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const plans = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true))
      .orderBy(subscriptionPlans.priceMonthly);

    return successResponse(plans);
  } catch (error) {
    return errorResponse(error);
  }
}
