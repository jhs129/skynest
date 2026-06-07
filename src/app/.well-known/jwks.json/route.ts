import { NextResponse } from 'next/server';
import { getJwks } from '@/lib/oauth/keys';

export async function GET() {
  return NextResponse.json(await getJwks());
}
