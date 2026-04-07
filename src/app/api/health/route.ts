import { NextResponse } from 'next/server';

export async function GET() {
  const hasApiKey = !!process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'not set';

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: {
      hasApiKey,
      model,
    },
  });
}
