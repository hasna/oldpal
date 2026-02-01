export async function GET() {
  return new Response('WebSocket endpoint available at /api/ws (pages route).', { status: 426 });
}
