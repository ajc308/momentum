import { logAudit } from '@/lib/audit-log'
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { refreshPelotonCredential } from '@/lib/peloton';

export async function POST(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const { userId } = await refreshPelotonCredential();
    await logAudit(request, authResult, 'peloton.authenticate', {})
    return NextResponse.json({ connected: true, userId });
  } catch (error) {
    await logAudit(request, authResult, 'peloton.authenticate.failed', {})
    console.error('Peloton auth error:', error);
    const message = error instanceof Error ? error.message : 'Authentication failed';
    console.error('Detailed error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
