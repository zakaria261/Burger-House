import { handleState } from '@/lib/api';
import { sqliteStore } from '@/lib/sqlite';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleState(request, sqliteStore);
export const POST = (request: Request) => handleState(request, sqliteStore);
