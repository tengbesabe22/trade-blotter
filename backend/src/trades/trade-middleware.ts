import { bodyLimit } from 'hono/body-limit';

export const tradeBodyLimit = bodyLimit({
  maxSize: 4096, // 4 KiB.
  onError: (c) =>
    c.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Trade request is too large.' }, 413),
});
