'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function loginAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const password = formData.get('password');

  if (
    typeof password !== 'string' ||
    password !== process.env.APP_PASSWORD
  ) {
    return { error: '密码错误' };
  }

  const secret = process.env.APP_SECRET ?? '';
  const jar = await cookies();
  jar.set('session', secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });

  redirect('/ledger');
}
